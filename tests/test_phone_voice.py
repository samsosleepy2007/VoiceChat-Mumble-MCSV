"""Exercise production bridge methods without an Endstone runtime."""
import ast
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
root = Path(__file__).resolve().parents[1]
source = ast.parse((root / 'src/endstone_mumble_host/plugin.py').read_text())
cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'MumbleHost')
methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in {'_state_message', '_voice_enabled_for', '_effective_range'}]
ns = {'Player': object, 'PlayerState': object, 'Any': object}
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), ast.ClassDef(name='Bridge', bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])), '<bridge>', 'exec'), ns)
bridge = ns['Bridge'](); bridge._default_range = 30; bridge._default_attenuation_level = 3
bridge._bindings = {'a': {'range': 60}}; bridge._max_range = 60; bridge._range_limits = {}
spec = importlib.util.spec_from_file_location('phone_model', root / 'src/endstone_mumble_host/model.py')
model = importlib.util.module_from_spec(spec);sys.modules[spec.name] = model;spec.loader.exec_module(model)
normal = model.PlayerState('A', 'a', 'a', 'Overworld', 0,64,0,0,0,True)
phone = model.PlayerState('A', 'a', 'a', 'Overworld', 0,64,0,0,0,True,True)
assert phone.changed_from(normal, .05, 1)
assert normal.changed_from(phone, .05, 1)
assert bridge._state_message('a', normal)['voiceRange'] == 60
assert bridge._state_message('a', phone)['voiceRange'] == 4
assert bridge._bindings['a']['range'] == 60
assert bridge._voice_enabled_for(SimpleNamespace(scoreboard_tags=['vcmumble.call.mic','vcmumble.mic.off']))
assert not bridge._voice_enabled_for(SimpleNamespace(scoreboard_tags=['vcmumble.mic.off']))
print('PASS: phone override enables Mic, constrains feed to 4, preserves binding, and publishes stationary entry/exit.')
