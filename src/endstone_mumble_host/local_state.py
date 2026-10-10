from __future__ import annotations

import json
import queue
import socket
import threading
import time
from typing import Any


class LocalStateSink:
    def __init__(
        self,
        logger: Any,
        *,
        host: str = "127.0.0.1",
        port: int = 47855,
        max_queue: int = 4096,
    ) -> None:
        self._logger = logger
        self._host = host
        self._port = int(port)
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(
            maxsize=max(128, int(max_queue))
        )
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._reader: threading.Thread | None = None
        self._sock: socket.socket | None = None
        self._last_error = ""
        # Names the voice server reports as sending audio right now.
        self._talkers: frozenset[str] = frozenset()
        self._talkers_at = 0.0

    @property
    def talkers(self) -> frozenset[str]:
        # The server repeats the list every 2 s; drop it if that stops (server down).
        if time.monotonic() - self._talkers_at > 5.0:
            return frozenset()
        return self._talkers

    @property
    def last_error(self) -> str:
        return self._last_error

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        # Bind before the first send so the voice server can reply to this socket.
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((self._host, 0))
        sock.settimeout(0.5)
        self._sock = sock
        self._reader = threading.Thread(
            target=self._read,
            args=(sock,),
            name="MumbleHost-Talking",
            daemon=True,
        )
        self._reader.start()
        self._thread = threading.Thread(
            target=self._run,
            name="MumbleHost-LocalState",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            self._queue.put_nowait({"type": "__stop__"})
        except queue.Full:
            pass
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)
        self._thread = None
        reader = self._reader
        if reader is not None and reader.is_alive():
            reader.join(timeout=2)
        self._reader = None
        self._talkers = frozenset()

    def send(self, payload: dict[str, Any]) -> bool:
        item = dict(payload)
        try:
            self._queue.put_nowait(item)
            return True
        except queue.Full:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._queue.put_nowait(item)
                return True
            except queue.Full:
                return False

    def _read(self, sock: socket.socket) -> None:
        while not self._stop.is_set():
            try:
                data, _ = sock.recvfrom(65536)
            except socket.timeout:
                continue
            except OSError:
                if self._stop.is_set():
                    return
                continue
            try:
                message = json.loads(data.decode("utf-8"))
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("type") == "talking":
                names = message.get("names")
                if isinstance(names, list):
                    self._talkers = frozenset(str(n) for n in names)
                    self._talkers_at = time.monotonic()

    def _run(self) -> None:
        sock = self._sock
        if sock is None:
            return
        try:
            while not self._stop.is_set():
                try:
                    payload = self._queue.get(timeout=0.5)
                except queue.Empty:
                    continue
                if payload.get("type") == "__stop__":
                    continue
                try:
                    data = json.dumps(
                        payload,
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode("utf-8")
                    sock.sendto(data, (self._host, self._port))
                    self._last_error = ""
                except Exception as exc:
                    self._last_error = f"{type(exc).__name__}: {exc}"
                    self._logger.warning(
                        f"Local proximity state error: {self._last_error}"
                    )
        finally:
            self._stop.set()
            sock.close()
            self._sock = None
