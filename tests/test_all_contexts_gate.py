"""Regression checks for fail-closed Mic OFF on every native routing context.

Run with: python3 tests/test_all_contexts_gate.py
This test builds a representative Mumble 1.6 processMsg fragment and runs
the actual patcher; a future native upstream change must fail the patcher
rather than silently shipping an unguarded packet path.
"""
from __future__ import annotations

import ast
import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from patch_mumble_linux import patch_server_routing

plugin = (ROOT / "src/endstone_mumble_host/plugin.py").read_text(encoding="utf-8")
feed = (ROOT / "mumble-patch/VCStateFeed.cpp").read_text(encoding="utf-8")
native = (ROOT / "mumble-patch/VCProximity.cpp").read_text(encoding="utf-8")
header = (ROOT / "mumble-patch/VCProximity.h").read_text(encoding="utf-8")
patcher = (ROOT / "tools/patch_mumble_linux.py").read_text(encoding="utf-8")

# Validate actual Python structure, not only strings.
ast.parse(plugin)
assert 'if "vcmumble.mic.off" in tags:' in plugin
assert 'return "vcmumble.mic.on" in tags' in plugin
assert '"type": "player_leave"' in plugin
assert "STATE_INVALID" in plugin
assert "RANGE_BEGIN" in plugin and "publish_ms=" in plugin
assert "writer.shutdown(wait=True, cancel_futures=False)" in plugin
assert 'toBool(false)' in feed and 'voiceEnabled")).toBool(true)' not in feed
assert "bool voiceEnabled = false;" in native
assert "bool canSpeak(const QString &speakerName)" in native
assert "bool canSpeak(const QString &speakerName);" in header
assert "if (!isEnabled()) return false;" in native
assert "if (!isEnabled()) return 0.0F;" in native
assert "VC_PROXIMITY_ALL_CONTEXTS" in patcher

# Fixture covers channel audio, linked-channel audio, and a whisper-like
# alternate path. All must be gated before the first receiver is added.
fixture = """#include "Server.h"
void Server::processMsg(User *u, Mumble::Protocol::AudioData &audioData) {
    if (pDst) {
        auto gain1 = m_channelListenerManager.getListenerVolumeAdjustment(pDst->uiSession, c->iId);
        buffer.addReceiver(*u, *pDst, Mumble::Protocol::AudioContext::NORMAL, audioData.containsPositionalData);
    }
    if (pDst) {
        auto gain2 = m_channelListenerManager.getListenerVolumeAdjustment(pDst->uiSession, l->iId);
        buffer.addReceiver(*u, *pDst,
            Mumble::Protocol::AudioContext::NORMAL,
            audioData.containsPositionalData);
    }
    buffer.addReceiver(*u, *pDst, Mumble::Protocol::AudioContext::WHISPER, false);
}
ZoneNamedN("sendout");
"""
with tempfile.TemporaryDirectory() as temporary:
    server_cpp = Path(temporary) / "Server.cpp"
    server_cpp.write_text(fixture, encoding="utf-8")
    patch_server_routing(Path(temporary))
    patched = server_cpp.read_text(encoding="utf-8")
    guard = "if (!VCProximity::canSpeak(u->qsName)) return;"
    assert patched.count(guard) == 1
    assert patched.count("VC_PROXIMITY_ALL_CONTEXTS") == 1
    assert patched.index(guard) < patched.index("buffer.addReceiver(")
    assert "VC_PROXIMITY_REGULAR_ATTENUATION" in patched
    assert "VC_PROXIMITY_LINKED_ATTENUATION" in patched
    assert "VC_PROXIMITY_REGULAR_LISTENER" in patched
    assert "VC_PROXIMITY_LINKED_LISTENER" in patched

print("All-context Mic OFF and range diagnostics regression: OK")
