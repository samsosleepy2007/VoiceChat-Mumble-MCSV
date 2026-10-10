import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
const scores = new Map(); // objective -> value for the one test player
const objective = id => ({ getScore: () => scores.get(id), setScore: (_p, v) => scores.set(id, v) });
const world = { scoreboard: { getObjective: id => objective(id), addObjective: id => objective(id) } };
const ctx = vm.createContext({ system: { currentTick: 1 }, console: { warn() {} }, world });
vm.runInContext(source.slice(source.indexOf('// Frequently-changing bridge state'), source.indexOf('function applyActionBar(')), ctx);
vm.runInContext(source.slice(source.indexOf('function publishMicState('), source.indexOf('function stateFor(')), ctx);

const tags = new Set(['vcmumble.mic.off', 'vcmumble.mic.on']); // corrupted legacy tags are ignored
const p = {
  name: 'Tester', nameTag: 'Tester', writes: 0,
  hasTag: tag => tags.has(tag),
  getDynamicProperty: () => undefined, // ActionBar option never enabled
};
const real = p;
const player = new Proxy(real, {
  set(target, key, value) { if (key === 'nameTag') target.writes++; target[key] = value; return true; },
});
ctx.player = player;
ctx.state = {};
const apply = (hasMic, effective) => vm.runInContext(`applyNameGlyph(player, state, ${hasMic}, ${effective})`, ctx);
const ON = 'Tester ', OFF = 'Tester ', TALK = 'Tester ';

apply(true, true);
assert.equal(real.nameTag, ON);
scores.set('vcmumble_talk', 1);
apply(true, true);
assert.equal(real.nameTag, TALK, 'talking shows on the name without the ActionBar option');
apply(true, false);
assert.equal(real.nameTag, OFF, 'mic off wins over the talking tag');
apply(true, true);
assert.equal(real.nameTag, TALK, 'talking returns after mic off -> on');
scores.set('vcmumble_talk', 0);
apply(true, true);
assert.equal(real.nameTag, ON);

const writes = real.writes;
apply(true, true);
assert.equal(real.writes, writes, 'no write when the name tag already matches');
real.nameTag = 'Tester'; // the game reset the name (respawn)
apply(true, true);
assert.equal(real.nameTag, ON, 'a reset name tag is repaired');
apply(false, false);
assert.equal(real.nameTag, 'Tester');

vm.runInContext('publishMicState(player, true)', ctx);
assert.equal(scores.get('vcmumble_mic'), 1, 'mic state is published as a score');
vm.runInContext('publishMicState(player, false)', ctx);
assert.equal(scores.get('vcmumble_mic'), 0);
assert.doesNotMatch(source, /addTag\((MIC_ON_TAG|MIC_OFF_TAG|TALKING_TAG)/, 'no mic/talking tag writes remain');

assert.doesNotMatch(source.slice(source.indexOf('async function maybeShowMicStatusIntro(')), /GLYPH_/, 'no glyphs in DDUI forms');

console.log('PASS: name glyph follows the mic and talking scores without the ActionBar option, ignores legacy tags, repairs resets, publishes the mic score, and DDUI forms carry no glyphs.');
