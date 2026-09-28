from __future__ import annotations

import json
import queue
import socket
import threading
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
        self._last_error = ""

    @property
    def last_error(self) -> str:
        return self._last_error

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
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

    def _run(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
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
            sock.close()
