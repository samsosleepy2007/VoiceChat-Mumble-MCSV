from __future__ import annotations

import ast
import importlib.util
import json
import socket
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "src/endstone_mumble_host/plugin.py"
HOST = ROOT / "src/endstone_mumble_host/host.py"
STATE = ROOT / "src/endstone_mumble_host/local_state.py"
CONFIG = ROOT / "src/endstone_mumble_host/config.toml"
PYPROJECT = ROOT / "pyproject.toml"

plugin = PLUGIN.read_text(encoding="utf-8")
host = HOST.read_text(encoding="utf-8")
config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))

assert project["project"]["version"] == "0.5.2"
assert "class MumbleHost(Plugin):" in plugin
assert 'version = "0.5.2"' in plugin
assert "BridgeRelay" not in plugin
assert "bridge_relay" not in plugin
assert '"vcmumble.mic.on"' in plugin
assert '"vcmumble.mic.off"' in plugin
assert "vcmumble.vr.request." in plugin
assert "vcmumble.vr.ack." in plugin
assert '"voiceRange"' in plugin
assert '"voiceEnabled"' in plugin
assert '"attenuationLevel"' in plugin
assert '"vcmumble.call.active."' in plugin
assert '"call_state"' in plugin
assert '"call_end"' in plugin
assert "ThreadPoolExecutor" in plugin
assert "os.replace(temporary, path)" in plugin
assert config["tracking"]["interval_ticks"] == 4
assert config["tracking"]["heartbeat_seconds"] == 2

# Test the actual mute decision function without requiring the Endstone runtime.
ast_root = ast.parse(plugin)
host_class = next(node for node in ast_root.body if isinstance(node, ast.ClassDef) and node.name == "MumbleHost")
mute_method = next(node for node in host_class.body if isinstance(node, ast.FunctionDef) and node.name == "_voice_enabled_for")
mute_method.decorator_list = []
mute_namespace = {"Player": object}
exec(compile(ast.Module(body=[mute_method], type_ignores=[]), str(PLUGIN), "exec"), mute_namespace)
mute_decision = mute_namespace["_voice_enabled_for"]


class TaggedPlayer:
    def __init__(self, tags: list[str]):
        self.scoreboard_tags = tags


assert mute_decision(TaggedPlayer(["vcmumble.mic.on"])) is True
assert mute_decision(TaggedPlayer(["vcmumble.mic.off"])) is False
assert mute_decision(TaggedPlayer(["vcmumble.mic.on", "vcmumble.mic.off"])) is False
assert mute_decision(TaggedPlayer([])) is False

assert config["voice"]["default_attenuation_level"] == 3
assert config["voice"]["default_range"] == 30
assert config["voice"]["max_range"] == 60
assert config["local_state"]["host"] == "127.0.0.1"
assert config["local_state"]["port"] == 47855
assert config["mumble"]["port"] == 18655
assert 'resources.files("endstone_mumble_host")' in host

spec = importlib.util.spec_from_file_location("mumblehost_local_state_test", STATE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
LocalStateSink = module.LocalStateSink


class DummyLogger:
    def warning(self, *_args, **_kwargs):
        pass


receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
receiver.bind(("127.0.0.1", 0))
receiver.settimeout(2.0)
port = int(receiver.getsockname()[1])

sink = LocalStateSink(DummyLogger(), port=port, max_queue=128)
sink.start()
payload = {
    "type": "player_state",
    "name": "Tester",
    "mumbleName": "Tester",
    "dimension": "Overworld",
    "x": 1.0,
    "y": 64.0,
    "z": 2.0,
    "voiceRange": 30,
    "voiceEnabled": True,
    "attenuationLevel": 3,
}
assert sink.send(payload)
data, peer = receiver.recvfrom(65535)
assert peer[0] == "127.0.0.1"
assert json.loads(data.decode("utf-8")) == payload
sink.stop()
receiver.close()

print("MumbleHost unified v0.5.2 call-routing contract: OK")
