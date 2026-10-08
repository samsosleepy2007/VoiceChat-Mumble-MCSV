"""Exercise the actual wheel imports and compare its framework API to source."""
import base64
import csv
import hashlib
import importlib
import inspect
import io
from pathlib import Path
import sys
import tempfile
import types
import typing
import zipfile

ROOT = Path(__file__).resolve().parents[1]
for name in ['endstone', 'endstone.command', 'endstone.form', 'endstone.plugin', 'endstone.event']:
    sys.modules[name] = types.ModuleType(name)
for module, names in {
    'endstone': ['Player'], 'endstone.command': ['Command', 'CommandSender'],
    'endstone.form': ['ActionForm'], 'endstone.plugin': ['Plugin'],
    'endstone.event': ['PlayerJoinEvent', 'PlayerQuitEvent'],
}.items():
    for name in names:
        setattr(sys.modules[module], name, type(name, (), {}))
sys.modules['endstone.event'].event_handler = lambda fn: fn

def exercise(path):
    for name in list(sys.modules):
        if name.startswith('endstone_mumble_host'):
            del sys.modules[name]
    sys.path.insert(0, str(path))
    try:
        package = importlib.import_module('endstone_mumble_host')
        modules = [importlib.import_module('endstone_mumble_host.' + name)
                   for name in ['plugin', 'host', 'listener', 'model', 'local_state']]
        cls = package.MumbleHost
        api = {name: str(inspect.signature(fn)) for name, fn in vars(cls).items() if inspect.isfunction(fn)}
        for module in modules:
            for obj in vars(module).values():
                if inspect.isclass(obj) and obj.__module__ == module.__name__:
                    typing.get_type_hints(obj)
                    for fn in vars(obj).values():
                        if inspect.isfunction(fn):
                            typing.get_type_hints(fn)
        bridge = cls()
        bridge._default_range = 30
        bridge._default_attenuation_level = 3
        bridge._bindings = {'a': {'range': 60}}
        model = modules[3]
        normal = model.PlayerState('A', 'a', 'a', 'Overworld', 0, 64, 0, 0, 0, True)
        phone = model.PlayerState('A', 'a', 'a', 'Overworld', 0, 64, 0, 0, 0, True, True)
        assert phone.changed_from(normal, .05, 1) and normal.changed_from(phone, .05, 1)
        assert bridge._state_message('a', normal)['voiceRange'] == 60
        assert bridge._state_message('a', phone)['voiceRange'] == 4
        assert bridge._bindings['a']['range'] == 60
        # A stored operator range is clamped once the player loses operator.
        bridge._max_range = 60
        bridge._bindings = {'a': {'range': 1000}}
        op = types.SimpleNamespace(xuid='a', unique_id='a', is_op=True)
        assert bridge._range_limit(op) == 1000
        assert bridge._state_message('a', normal)['voiceRange'] == 1000
        op.is_op = False
        assert bridge._range_limit(op) == 60
        assert bridge._state_message('a', normal)['voiceRange'] == 60
        assert bridge._bindings['a']['range'] == 1000
        host_module = modules[1]
        runtime = host_module.MumbleRuntimeHost.__new__(host_module.MumbleRuntimeHost)
        with tempfile.TemporaryDirectory() as blobs:
            blob = Path(blobs) / 'layer.tar'
            blob.write_bytes(b'layer')
            good = 'sha256:' + hashlib.sha256(b'layer').hexdigest()
            assert runtime._file_digest(blob) == good
            runtime._download_blob('token', good, blob)
            assert blob.exists()
            try:
                runtime._download_blob('token', 'md5:x', blob)
                raise AssertionError('unsupported digest accepted')
            except RuntimeError:
                pass
        assert bridge._voice_enabled_for(types.SimpleNamespace(scoreboard_tags=['vcmumble.call.mic', 'vcmumble.mic.off']))
        assert not bridge._voice_enabled_for(types.SimpleNamespace(scoreboard_tags=['vcmumble.mic.off']))
        events = []
        listener = modules[2].MumbleHostListener(types.SimpleNamespace(handle_player_join=lambda p: events.append(p), handle_player_quit=lambda p: events.append(p)))
        listener.on_player_join(types.SimpleNamespace(player='join'))
        listener.on_player_quit(types.SimpleNamespace(player='quit'))
        assert events == ['join', 'quit']
        return api, cls.commands, cls.permissions, cls.version
    finally:
        sys.path.pop(0)

expected = exercise(ROOT / 'src')
import json
release = json.loads((ROOT / 'web/join/lib/release.json').read_text())
version = release['plugin']['version']
wheel = ROOT / 'obfuscator/plugin' / release['plugin']['file']
assert hashlib.sha256(wheel.read_bytes()).hexdigest() == release['plugin']['sha256']
with zipfile.ZipFile(wheel) as archive, tempfile.TemporaryDirectory() as temp:
    assert archive.testzip() is None
    for name, digest, size in csv.reader(io.StringIO(archive.read(f'endstone_mumble_host-{version}.dist-info/RECORD').decode())):
        if not digest:
            continue
        data = archive.read(name)
        assert len(data) == int(size)
        assert digest == 'sha256=' + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
    assert b'mumble_host = endstone_mumble_host:MumbleHost' in archive.read(f'endstone_mumble_host-{version}.dist-info/entry_points.txt')
    for name in archive.namelist():
        if name.endswith('.py'):
            data = archive.read(name)
            compile(data, name, 'exec')
            assert b'class MumbleHost' not in data
            assert b'https://registry-1.docker.io' not in data
    archive.extractall(temp)
    assert exercise(Path(temp)) == expected
print('PASS: wheel RECORD, entry point, all module imports, type hints, API signatures, voice/call routing and event callbacks')
