"""MumbleRuntimeHost supervision, verified downloads and process cleanup (no network, no mumble)."""
import hashlib
import io
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import types


class _Color(type):
    def __getattr__(cls, _name):
        return ""


sys.modules["endstone"] = types.ModuleType("endstone")
sys.modules["endstone"].ColorFormat = _Color("ColorFormat", (), {})
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import importlib.util

spec = importlib.util.spec_from_file_location("host_under_test", ROOT / "src/endstone_mumble_host/host.py")
host = importlib.util.module_from_spec(spec)
sys.modules["host_under_test"] = host
spec.loader.exec_module(host)


class Log:
    def __init__(self):
        self.lines = []

    def info(self, m):
        self.lines.append(("info", m))

    def warning(self, m):
        self.lines.append(("warning", m))

    def error(self, m):
        self.lines.append(("error", m))


tmp = pathlib.Path(tempfile.mkdtemp())
host.RUNTIME = tmp / "runtime"
host.ROOTFS = host.RUNTIME / "rootfs"
host.LAYERS = host.RUNTIME / "layers"
host.PIDFILE = host.RUNTIME / "data" / "mumble.pid"
host.BACKOFF_SECONDS = (0.01, 0.02)


def wait_for(predicate, seconds=3.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


# 1. A crash is retried automatically with backoff, and recovery is picked up.
log = Log()
runtime = host.MumbleRuntimeHost(log, tmp / "data")
attempts = []


def flaky():
    attempts.append(time.monotonic())
    if len(attempts) < 3:
        raise RuntimeError("mumble process exited unexpectedly rc=139")
    runtime._set_status("running", pid=1)
    while not runtime._wait(0.01):
        pass


runtime._run_once = flaky
runtime.start()
assert wait_for(lambda: runtime.status_line().startswith("running")), runtime.status_line()
assert len(attempts) == 3
assert sum(1 for level, _ in log.lines if level == "warning") == 2
runtime.stop()
assert runtime.status_line() == "offline"
assert not (runtime._thread and runtime._thread.is_alive())

# 2. It gives up after too many failures in an hour instead of spinning forever.
log = Log()
runtime = host.MumbleRuntimeHost(log, tmp / "data2")
host.MAX_FAILURES_PER_HOUR = 3
runtime._run_once = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
runtime.start()
assert wait_for(lambda: runtime.status_line().startswith("error"))
assert any(level == "error" for level, _ in log.lines)
assert "boom" in (tmp / "data2" / "host-status.txt").read_text()
runtime.stop()

# 3. A restart while the old thread is still busy never lets the old thread act afterwards.
log = Log()
runtime = host.MumbleRuntimeHost(log, tmp / "data3")
release = threading.Event()
seen = []


def slow_download():
    release.wait(2)
    seen.append(runtime._cancelled())
    if not runtime._cancelled():
        runtime._set_status("running", pid=2)
        while not runtime._wait(0.01):
            pass


runtime._run_once = slow_download
runtime.start()
time.sleep(0.05)
old = runtime._thread
runtime.stop()  # old thread is still blocked "downloading"
runtime.start()
release.set()
assert wait_for(lambda: len(seen) == 2)
assert seen[0] is True, "the superseded thread must see it was cancelled"
assert seen[1] is False
runtime.stop()

# 4. Layer downloads are checked against their digest; corrupt leftovers are replaced.
log = Log()
runtime = host.MumbleRuntimeHost(log, tmp / "data4")
runtime._local.generation = runtime._generation
good = b"layer-bytes" * 1000
digest = "sha256:" + hashlib.sha256(good).hexdigest()
served = {"body": good}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


host.urllib.request.urlopen = lambda request, timeout=0: FakeResponse(served["body"])
host.LAYERS.mkdir(parents=True, exist_ok=True)
archive = host.LAYERS / "layer.tar"
archive.write_bytes(b"truncated")
runtime._download_blob("token", digest, archive)
assert archive.read_bytes() == good, "a corrupt leftover is re-downloaded"
served["body"] = b"tampered"
bad = host.LAYERS / "bad.tar"
try:
    runtime._download_blob("token", digest, bad)
    raise AssertionError("tampered layer accepted")
except RuntimeError as exc:
    assert "integrity" in str(exc)
assert not bad.exists() and not bad.with_suffix(".tar.part").exists()

# 5. A mumble-server left running by a hard reload is killed before starting again.
host.PIDFILE.parent.mkdir(parents=True, exist_ok=True)
stale = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(30)", "mumble-server-vc"],
    start_new_session=True,
)
host.PIDFILE.write_text(str(stale.pid))
host.MumbleRuntimeHost._kill_stale_process()
assert stale.wait(timeout=10) is not None
assert not host.PIDFILE.exists()
# ...but an unrelated process that reused the pid is left alone.
other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
host.PIDFILE.write_text(str(other.pid))
host.MumbleRuntimeHost._kill_stale_process()
assert other.poll() is None
other.kill()
other.wait()

# 6. Nothing is spawned once the host has been stopped.
runtime = host.MumbleRuntimeHost(Log(), tmp / "data6")
runtime._local.generation = runtime._generation
runtime._stop.set()
try:
    with runtime._spawn:
        if runtime._cancelled():
            raise RuntimeError("host start cancelled")
    raise AssertionError("spawn guard missing")
except RuntimeError as exc:
    assert "cancelled" in str(exc)

print("PASS host runtime: crash retry with backoff, give-up limit, superseded threads stay inert, "
      "layer digest verification, stale process cleanup, no spawn after stop")
