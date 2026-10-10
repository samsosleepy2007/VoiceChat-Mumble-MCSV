"""Fire-and-forget notice to the website when voice starts without a valid license.

The website (which holds the Discord webhook and all secrets) turns this into an alert.
This module never raises into the caller and never blocks server start: the POST runs on a
daemon thread with a short timeout and every error is swallowed. A copy of the plugin that
strips this out simply sends nothing.

It also keeps a small roster of who has joined this server (name, xuid, op) so an unlicensed
report can tell the owner who is on a pirated copy and who has admin there, and it drops a
marker file when the server runs unlicensed so the website can refuse a later reinstall.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.request

# Set at build time (tools/build_plugin_wheel.py); must equal the website's PLUGIN_REPORT_SECRET.
REPORT_URL = "https://sleepyvoice-join.vercel.app/api/plugin-report"
REPORT_KEY = ""  # replaced during the protected build

ROSTER_LIMIT = 200          # most recent joiners we keep on disk
ROSTER_SEND_LIMIT = 40      # most recent joiners we put in a report
ONLINE_SEND_LIMIT = 20


def _server_key(env: dict) -> str:
    # Both sides hash the 8-hex pelican identifier (P_SERVER_UUID prefix) so the marker path
    # matches what the website computes from plan.server.identifier.
    uuid = str(env.get("P_SERVER_UUID", "")).strip().lower()
    return uuid[:8] if len(uuid) >= 8 and all(c in "0123456789abcdef" for c in uuid[:8]) else ""


def marker_relpath(server_key: str) -> str | None:
    """Obscure but deterministic path (relative to the server volume root) for the
    unlicensed-history marker. Returns None when the key is not a valid 8-hex id."""
    if not server_key or len(server_key) != 8 or any(c not in "0123456789abcdef" for c in server_key):
        return None
    digest = hashlib.sha256(("sleepy-mark:" + server_key).encode()).hexdigest()
    return digest[:16] + "/." + digest[16:32]


def _volume_root() -> str:
    # Endstone runs from the server volume root, which the website sees as '/'.
    return os.getcwd()


def write_marker(reason: str, env: dict | None = None) -> None:
    try:
        source = os.environ if env is None else env
        rel = marker_relpath(_server_key(dict(source)))
        if not rel:
            return
        path = os.path.join(_volume_root(), rel)
        if os.path.exists(path):
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"reason": str(reason)[:40], "first_seen": int(time.time())}, handle)
    except Exception:
        pass


def _roster_file(data_folder) -> str:
    return os.path.join(str(data_folder), "roster.json")


def record_join(data_folder, name: str, xuid: str, op: bool) -> None:
    """Remember that a player joined (most-recent-first, capped). Never raises."""
    try:
        path = _roster_file(data_folder)
        roster: list[dict] = []
        try:
            with open(path, encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, list):
                roster = [e for e in loaded if isinstance(e, dict)]
        except Exception:
            roster = []
        key = str(xuid or "") or str(name or "")
        roster = [e for e in roster if (str(e.get("xuid") or "") or str(e.get("name") or "")) != key]
        roster.insert(0, {"name": str(name)[:32], "xuid": str(xuid)[:32], "op": bool(op), "at": int(time.time())})
        roster = roster[:ROSTER_LIMIT]
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(roster, handle)
        os.replace(tmp, path)
    except Exception:
        pass


def load_roster(data_folder, limit: int = ROSTER_SEND_LIMIT) -> list[dict]:
    try:
        with open(_roster_file(data_folder), encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, list):
            return [e for e in loaded if isinstance(e, dict)][:limit]
    except Exception:
        pass
    return []


def _trim_players(players):
    def one(entry):
        return {
            "name": str(entry.get("name", ""))[:32],
            "xuid": str(entry.get("xuid", ""))[:32],
            "op": bool(entry.get("op", False)),
        }
    online = [one(e) for e in (players.get("online") or [])][:ONLINE_SEND_LIMIT]
    roster = [one(e) for e in (players.get("roster") or [])][:ROSTER_SEND_LIMIT]
    return online, roster


def _send(reason: str, version: str, env: dict, players: dict | None = None) -> None:
    uuid = str(env.get("P_SERVER_UUID", "")).strip()
    if not uuid or not REPORT_KEY:
        return
    ts = str(int(time.time()))
    signature = hmac.new(REPORT_KEY.encode(), (uuid + "\n" + ts).encode(), hashlib.sha256).digest()
    body = {
        "uuid": uuid,
        "ip": str(env.get("SERVER_IP", "")).strip()[:64],
        "port": str(env.get("SERVER_PORT", "")).strip()[:8],
        "ts": ts,
        "v": version,
        "reason": str(reason)[:40],
        "sig": base64.b64encode(signature).decode(),
    }
    if players:
        online, roster = _trim_players(players)
        if online:
            body["online"] = online
        if roster:
            body["roster"] = roster
    payload = json.dumps(body).encode()
    request = urllib.request.Request(
        REPORT_URL, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except Exception:
        pass


def report_unlicensed(reason: str, version: str, env: dict | None = None, players: dict | None = None) -> None:
    try:
        source = os.environ if env is None else env
        threading.Thread(
            target=_send, args=(reason, version, dict(source), players), name="MumbleReport", daemon=True
        ).start()
    except BaseException:
        pass
