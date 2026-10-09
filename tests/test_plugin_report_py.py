"""The plugin's report module: builds a signed payload, fires only when told, never raises."""
import base64
import hashlib
import hmac
import importlib.util
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("report_under_test", ROOT / "src/endstone_mumble_host/report.py")
report = importlib.util.module_from_spec(spec)
sys.modules["report_under_test"] = report
spec.loader.exec_module(report)

report.REPORT_KEY = "unit-test-key"
UUID = "5fb3cecf-9cb9-428b-9053-9fb65a47b5df"

captured = {}


def fake_urlopen(request, timeout=0):
    captured["url"] = request.full_url
    captured["body"] = json.loads(request.data)

    class R:
        def close(self):
            pass

    return R()


report.urllib.request.urlopen = fake_urlopen

# 1. A normal report carries the right fields and a valid HMAC over "uuid\nts".
report._send("missing", "0.6.3", {"P_SERVER_UUID": UUID, "SERVER_IP": "1.2.3.4", "SERVER_PORT": "10459"})
body = captured["body"]
assert captured["url"] == report.REPORT_URL
assert body["uuid"] == UUID and body["ip"] == "1.2.3.4" and body["port"] == "10459"
assert body["reason"] == "missing" and body["v"] == "0.6.3"
expected = base64.b64encode(hmac.new(b"unit-test-key", (UUID + "\n" + body["ts"]).encode(), hashlib.sha256).digest()).decode()
assert body["sig"] == expected, "HMAC must match what the website verifies"

# 2. No server UUID, or no baked key → send nothing (fail-safe, no exception).
captured.clear()
report._send("missing", "0.6.3", {})
assert captured == {}, "no UUID → no report"
saved, report.REPORT_KEY = report.REPORT_KEY, ""
report._send("missing", "0.6.3", {"P_SERVER_UUID": UUID})
assert captured == {}, "no baked key → no report"
report.REPORT_KEY = saved

# 3. A failing network never propagates out of report_unlicensed, and it runs off the caller's thread.
def boom(*a, **k):
    raise RuntimeError("network down")


report.urllib.request.urlopen = boom
report.report_unlicensed("missing", "0.6.3", {"P_SERVER_UUID": UUID, "SERVER_IP": "1.2.3.4", "SERVER_PORT": "1"})
time.sleep(0.2)  # let the daemon thread run and swallow the error
print("PASS report.py: signed payload matches website HMAC, fires only with uuid+key, network failure is swallowed")
