import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ system: { currentTick: 1 }, console: { warn() {} } });
vm.runInContext(source.slice(source.indexOf('const TALKING_TAG'), source.indexOf('function applyActionBar(')), ctx);

const tags = new Set();
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
tags.add('vcmumble.talking');
apply(true, true);
assert.equal(real.nameTag, TALK, 'talking shows on the name without the ActionBar option');
apply(true, false);
assert.equal(real.nameTag, OFF, 'mic off wins over the talking tag');
apply(true, true);
assert.equal(real.nameTag, TALK, 'talking returns after mic off -> on');
tags.delete('vcmumble.talking');
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

assert.doesNotMatch(source.slice(source.indexOf('async function maybeShowMicStatusIntro(')), /GLYPH_/, 'no glyphs in DDUI forms');

console.log('PASS: name glyph follows mic and talking state without the ActionBar option, repairs resets, and DDUI forms carry no glyphs.');
