import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
let held = 'phone';
const p = { id: 'p', name: 'Tester', hasTag: () => false };
const ctx = vm.createContext({
  states: new Map(), MODE_HOLD: 'hold', MODE_TOGGLE: 'toggle', MIC_ON: 'on', MIC_OFF: 'off', PHONE: 'phone',
  getMode: () => 'hold', getMainId: () => held,
  isMicId: id => ['on', 'off'].includes(id),
  stateFor: () => ({ mode: 'hold', micKnown: false, toggleLatched: false, lastMainMic: false }),
  setLatch() {}, replaceMicStatus() {}, publishMicState() {},
  system: { currentTick: 1 }, console: { warn() {} },
});
vm.runInContext(source.slice(source.indexOf('function evaluate(player)'), source.indexOf('function isPhoneId(')), ctx);
ctx.p = p;
vm.runInContext('evaluate(p)', ctx);
held = 'off';
vm.runInContext('evaluate(p)', ctx);
assert.doesNotMatch(source, /getOffId|offMic|บังคับ ON/);
for (const file of fs.readdirSync(new URL('../addon/BP/items/', import.meta.url))) {
  const item = JSON.parse(fs.readFileSync(new URL(`../addon/BP/items/${file}`, import.meta.url)))["minecraft:item"];
  assert.equal(item.components["minecraft:allow_off_hand"], false);
  assert.notEqual(item.components["minecraft:wearable"]?.slot, "slot.weapon.offhand");
}

console.log("PASS: mainhand-only evaluator runs and all items reject offhand equipment.");
