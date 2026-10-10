"""Mic and talking state travel through scoreboard scores, not churned tags."""
import ast
from pathlib import Path
from types import SimpleNamespace

root = Path(__file__).resolve().parents[1]
source = ast.parse((root / 'src/endstone_mumble_host/plugin.py').read_text())
cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'MumbleHost')
wanted = {
    '_voice_enabled_for', '_sync_talking_score', '_bridge_objective', '_read_bridge_score',
    '_write_bridge_score', '_clear_legacy_bridge_tags', '_remove_player_tag',
}
methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
constants = [n for n in source.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
             and n.targets[0].id in {'MIC_SCORE', 'TALK_SCORE', 'ENDSTONE_SEEN_SCORE', 'LEGACY_BRIDGE_TAGS'}]


class Score:
    def __init__(self, store, key):
        self._store, self._key = store, key
        self.writes = 0

    @property
    def is_score_set(self):
        return self._key in self._store

    @property
    def value(self):
        return self._store[self._key]

    @value.setter
    def value(self, v):
        self._store[self._key] = v
        writes[self._key[0]] = writes.get(self._key[0], 0) + 1


class Objective:
    def __init__(self, name):
        self.name = name

    def get_score(self, player):
        return Score(scores, (self.name, player.name))


class Scoreboard:
    def __init__(self):
        self.objectives = {}

    def get_objective(self, name):
        return self.objectives.get(name)

    def add_objective(self, name, criteria):
        self.objectives[name] = Objective(name)
        return self.objectives[name]


scores, writes, logs = {}, {}, []
ns = {'Player': object, 'Any': object, 'time': __import__('time'),
      'Criteria': SimpleNamespace(Type=SimpleNamespace(DUMMY='dummy'))}
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
                          *constants, ast.ClassDef(name='Bridge', bases=[], keywords=[], body=methods, decorator_list=[])],
                    type_ignores=[])
exec(compile(ast.fix_missing_locations(module), '<bridge>', 'exec'), ns)
bridge = ns['Bridge']()
bridge.server = SimpleNamespace(scoreboard=Scoreboard())
bridge.logger = SimpleNamespace(info=logs.append, warning=logs.append)
bridge._talk_log_at = {}
bridge._state_sink = SimpleNamespace(talkers=frozenset())


class FakePlayer:
    def __init__(self, name, tags):
        self.name = name
        self.scoreboard_tags = list(tags)

    def remove_scoreboard_tag(self, tag):
        if tag in self.scoreboard_tags:
            self.scoreboard_tags.remove(tag)


# The bug: both legacy tags stuck on the player. Before the addon publishes a score
# the old tag fallback (OFF wins) still applies...
p = FakePlayer('Sam', ['vcmumble.mic.off', 'vcmumble.mic.on'])
assert not bridge._voice_enabled_for(p)
# ...but once the addon has published a score, the corrupted tags are ignored.
bridge.server.scoreboard.add_objective('vcmumble_mic', 'dummy')
scores[('vcmumble_mic', 'Sam')] = 1
assert bridge._voice_enabled_for(p)
scores[('vcmumble_mic', 'Sam')] = 0
assert not bridge._voice_enabled_for(p)
# Phone-call mic still wins.
assert bridge._voice_enabled_for(FakePlayer('Sam', ['vcmumble.call.mic']))

# Talking score follows the voice server and is written only on change.
bridge._state_sink = SimpleNamespace(talkers=frozenset({'Sam'}))
bridge._sync_talking_score(p, True)
assert scores[('vcmumble_talk', 'Sam')] == 1 and scores[('vcmumble_ep', 'Sam')] == 1
before = dict(writes)
bridge._sync_talking_score(p, True)
assert writes == before, 'no score writes when nothing changed'
bridge._state_sink = SimpleNamespace(talkers=frozenset())
bridge._sync_talking_score(p, False)
assert scores[('vcmumble_talk', 'Sam')] == 0 and scores[('vcmumble_ep', 'Sam')] == 0
assert 'vcmumble.talking' not in p.scoreboard_tags

# Legacy tags are cleaned up on join, including duplicates.
stuck = FakePlayer('Cozy', ['vcmumble.mic.on', 'vcmumble.mic.on', 'vcmumble.mic.off', 'vcmumble.ep.off', 'vcmumble.ep.off', 'vcmumble.vr.30'])
bridge._clear_legacy_bridge_tags(stuck)
assert stuck.scoreboard_tags == ['vcmumble.vr.30']
assert not any('LEGACY_TAG_STUCK' in str(line) for line in logs)

print('PASS: mic state reads the score over corrupted legacy tags, talking/echo scores write only on change, and legacy tags are cleared on join.')
