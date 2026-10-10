"""The plugin's roster store, marker path, and report payload (items 2 + 3)."""
import base64
import hashlib
import hmac
import importlib.util
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("report_rm", ROOT / "src/endstone_mumble_host/report.py")
report = importlib.util.module_from_spec(spec)
sys.modules["report_rm"] = report
spec.loader.exec_module(report)

# Marker path is deterministic from the 8-hex pelican id and matches the website (see JS cross-check).
assert report.marker_relpath("5fb3cecf") == "1c9974abb225d34b/.2168d84de503ae11"
assert report.marker_relpath("") is None and report.marker_relpath("ZZ") is None
assert report._server_key({"P_SERVER_UUID": "5FB3CECF-9cb9-428b"}) == "5fb3cecf"

with tempfile.TemporaryDirectory() as data:
    # Roster keeps most-recent-first, dedupes by xuid, records the OP flag, and caps its size.
    report.record_join(data, "Sam4014XD", "25354", True)
    report.record_join(data, "CozyWord9512", "25355", False)
    report.record_join(data, "Sam4014XD", "25354", False)  # rejoin: moves to front, op now false
    roster = report.load_roster(data)
    assert [e["xuid"] for e in roster] == ["25354", "25355"], "dedup + most-recent-first"
    assert roster[0]["name"] == "Sam4014XD" and roster[0]["op"] is False
    for i in range(report.ROSTER_LIMIT + 20):
        report.record_join(data, "P%d" % i, str(10000 + i), False)
    assert len(report.load_roster(data, report.ROSTER_LIMIT + 999)) == report.ROSTER_LIMIT, "capped on disk"

# The report payload includes trimmed online + roster arrays and still signs only uuid\nts.
report.REPORT_KEY = "unit-test-key"
UUID = "5fb3cecf-9cb9-428b-9053-9fb65a47b5df"
captured = {}


def fake_urlopen(request, timeout=0):
    captured["body"] = json.loads(request.data)

    class R:
        def close(self):
            pass

    return R()


report.urllib.request.urlopen = fake_urlopen
players = {
    "online": [{"name": "Sam", "xuid": "1", "op": True, "extra": "drop"}],
    "roster": [{"name": "x" * 99, "xuid": "y" * 99, "op": False}] * (report.ROSTER_SEND_LIMIT + 10),
}
report._send("missing", "0.6.5", {"P_SERVER_UUID": UUID, "SERVER_IP": "1.2.3.4", "SERVER_PORT": "10459"}, players)
body = captured["body"]
expected = base64.b64encode(hmac.new(b"unit-test-key", (UUID + "\n" + body["ts"]).encode(), hashlib.sha256).digest()).decode()
assert body["sig"] == expected, "HMAC still covers only uuid\\nts"
assert body["online"] == [{"name": "Sam", "xuid": "1", "op": True}], "online trimmed to name/xuid/op"
assert len(body["roster"]) == report.ROSTER_SEND_LIMIT, "roster capped in the payload"
assert len(body["roster"][0]["name"]) <= 32 and len(body["roster"][0]["xuid"]) <= 32, "fields length-capped"

# No players → no player keys (keeps old reports small).
captured.clear()
report._send("missing", "0.6.5", {"P_SERVER_UUID": UUID}, None)
assert "online" not in captured["body"] and "roster" not in captured["body"]

print("PASS roster/marker: deterministic marker path, roster dedup/cap, report payload trims and caps players, HMAC unchanged")
