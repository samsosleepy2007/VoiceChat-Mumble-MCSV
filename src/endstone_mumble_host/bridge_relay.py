from __future__ import annotations

import hashlib
import hmac
import json
import pathlib
import socket
import threading
import time
import tomllib
from typing import Any


DEFAULT_CONFIG = pathlib.Path("/home/container/plugins/vc_mumble/config.toml")
STATE_HOST = "127.0.0.1"
STATE_PORT = 47855
MAX_FRAME_BYTES = 262_144


class BridgeRelay:
    def __init__(self, data_folder: pathlib.Path, logger) -> None:
        self._data_folder = data_folder
        self._logger = logger
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._socket: socket.socket | None = None
        self._state_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._buffer = bytearray()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="MumbleHostBridgeRelay",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        current = self._socket
        if current is not None:
            try:
                current.close()
            except OSError:
                pass
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)
        self._thread = None
        self._socket = None
        try:
            self._state_socket.close()
        except OSError:
            pass

    def _write_status(self, text: str) -> None:
        try:
            (self._data_folder / "bridge-status.txt").write_text(
                text + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._run_connection()
            except Exception as exc:
                if not self._stop.is_set():
                    self._write_status(
                        f"disconnected error={type(exc).__name__}: {exc}"
                    )
                    self._send_state({"type": "bridge_disconnected"})
            if self._stop.wait(2.0):
                return

    def _load_bridge_config(self) -> tuple[str, int, str]:
        with DEFAULT_CONFIG.open("rb") as handle:
            config = tomllib.load(handle)

        bridge = config.get("bridge", {})
        if not isinstance(bridge, dict):
            raise RuntimeError("VC Mumble bridge config is invalid")
        if not bool(bridge.get("enabled", True)):
            raise RuntimeError("VC Mumble bridge is disabled")

        host = str(bridge.get("host", "127.0.0.1")).strip()
        if host in {"", "0.0.0.0", "::"}:
            host = "127.0.0.1"

        port = int(bridge.get("port", 27220))
        secret = str(bridge.get("secret", "")).strip()

        if not secret:
            raise RuntimeError("VC Mumble bridge secret is empty")
        if not (1 <= port <= 65535):
            raise RuntimeError("VC Mumble bridge port is invalid")

        return host, port, secret

    def _run_connection(self) -> None:
        host, port, secret = self._load_bridge_config()
        sock = socket.create_connection((host, port), timeout=5)
        self._socket = sock
        self._buffer.clear()
        sock.settimeout(1.0)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

        self._send_line(
            sock,
            {
                "type": "hello",
                "role": "vc_mumble_server",
                "protocol": 1,
                "app": "MCSV MumbleHost",
                "appVersion": "0.3.0",
            },
        )

        authenticated = False
        deadline = time.monotonic() + 10.0

        while not self._stop.is_set() and not authenticated:
            if time.monotonic() >= deadline:
                raise RuntimeError("bridge authentication timed out")

            message = self._read_message(sock)
            if message is None:
                continue

            message_type = str(message.get("type", ""))
            if message_type == "auth_challenge":
                nonce = str(message.get("nonce", ""))
                if not nonce:
                    raise RuntimeError("bridge challenge nonce is empty")
                digest = hmac.new(
                    secret.encode("utf-8"),
                    f"vc-mumble-v1:{nonce}".encode("utf-8"),
                    hashlib.sha256,
                ).hexdigest()
                self._send_line(
                    sock,
                    {"type": "auth_response", "hmac": digest},
                )
            elif message_type == "hello_ok":
                authenticated = True
                self._send_state({"type": "sync_begin"})
                self._send_line(sock, {"type": "request_snapshot"})
                self._write_status(f"connected peer={host}:{port}")
                self._logger.info(
                    f"VC proximity bridge authenticated at {host}:{port}"
                )
            elif message_type == "hello_error":
                raise RuntimeError(
                    f"bridge rejected authentication: {message.get('reason', '')}"
                )

        while not self._stop.is_set():
            message = self._read_message(sock)
            if message is None:
                continue

            message_type = str(message.get("type", ""))
            if message_type in {
                "sync_begin",
                "sync_end",
                "player_state",
                "player_leave",
                "heartbeat",
            }:
                self._send_state(message)

        try:
            sock.close()
        finally:
            self._socket = None

    def _read_message(self, sock: socket.socket) -> dict[str, Any] | None:
        while b"\n" not in self._buffer:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                return None

            if not chunk:
                raise ConnectionError("VC Mumble bridge closed")

            self._buffer.extend(chunk)
            if len(self._buffer) > MAX_FRAME_BYTES:
                self._buffer.clear()
                raise RuntimeError("bridge frame buffer exceeded limit")

        line, _, rest = self._buffer.partition(b"\n")
        self._buffer = bytearray(rest)

        if len(line) > MAX_FRAME_BYTES:
            raise RuntimeError("bridge frame exceeded limit")

        try:
            value = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

        return value if isinstance(value, dict) else None

    @staticmethod
    def _send_line(sock: socket.socket, payload: dict[str, Any]) -> None:
        encoded = (
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
            + "\n"
        ).encode("utf-8")
        sock.sendall(encoded)

    def _send_state(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(
            payload,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")

        if len(encoded) > MAX_FRAME_BYTES:
            return

        self._state_socket.sendto(encoded, (STATE_HOST, STATE_PORT))
