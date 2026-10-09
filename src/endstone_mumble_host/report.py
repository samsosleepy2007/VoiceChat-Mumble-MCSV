"""Fire-and-forget notice to the website when voice starts without a valid license.

The website (which holds the Discord webhook and all secrets) turns this into an alert.
This module never raises into the caller and never blocks server start: the POST runs on a
daemon thread with a short timeout and every error is swallowed. It only reports; it never
touches files. A copy of the plugin that strips this out simply sends nothing.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import urllib.request

# Set at build time (tools/build_plugin_wheel.py); must equal the website's PLUGIN_REPORT_SECRET.
REPORT_URL = "https://sleepyvoice-join.vercel.app/api/plugin-report"
REPORT_KEY = ""  # replaced during the protected build


def _send(reason: str, version: str, env: dict) -> None:
    uuid = str(env.get("P_SERVER_UUID", "")).strip()
    if not uuid or not REPORT_KEY:
        return
    ts = str(int(__import__("time").time()))
    signature = hmac.new(REPORT_KEY.encode(), (uuid + "\n" + ts).encode(), hashlib.sha256).digest()
    payload = json.dumps({
        "uuid": uuid,
        "ip": str(env.get("SERVER_IP", "")).strip()[:64],
        "port": str(env.get("SERVER_PORT", "")).strip()[:8],
        "ts": ts,
        "v": version,
        "reason": str(reason)[:40],
        "sig": base64.b64encode(signature).decode(),
    }).encode()
    request = urllib.request.Request(
        REPORT_URL, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except Exception:
        pass


def report_unlicensed(reason: str, version: str, env: dict | None = None) -> None:
    try:
        source = os.environ if env is None else env
        threading.Thread(
            target=_send, args=(reason, version, dict(source)), name="MumbleReport", daemon=True
        ).start()
    except BaseException:
        pass
