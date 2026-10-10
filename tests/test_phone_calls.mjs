import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
const runtime = source.slice(source.indexOf('let phoneCallSequence = 0;'), source.indexOf('const openPhonePlayers = new Set();'));
const players = [
  { id: 'a', phone: 'pa', tags: new Set(), messages: [], normalOn: false, range: 30 },
  { id: 'b', phone: 'pb', tags: new Set(), messages: [], normalOn: false, range: 30 },
];
for (const p of players) {
  p.getTags = () => [...p.tags]; p.hasTag = t => p.tags.has(t); p.addTag = t => p.tags.add(t);
  p.removeTag = t => p.tags.delete(t); p.sendMessage = m => p.messages.push(m);
}
let monitor;
const context = vm.createContext({
  world: { getAllPlayers: () => players, getDynamicProperty: () => undefined },
  console: { warn() {} },
  ANONYMOUS_NUMBER: '#@+*', PHONE: 'phone', MIC_ON: 'on', MIC_OFF: 'off', MODE_HOLD: 'hold', MODE_TOGGLE: 'toggle',
  stateFor: p => p.state ??= { mode: 'toggle', micKnown: true, toggleLatched: p.normalOn, effective: p.normalOn },
  isMicId: id => id === 'on' || id === 'off', getMainId: () => 'phone', getOffId: () => '',
  getMode: () => 'toggle', setLatch: (p, value) => { p.normalOn = value; },
  replaceMicStatus: (p, value) => { p.visualOn = value; }, applyNameGlyph() {}, applyActionBar() {}, checkEndstoneAgreement() {},
  publishMicState: (p, value) => { p.publishedOn = value; },
  system: { currentTick: 100, runInterval: f => { monitor = f; } },
  playerHasPhoneId: (p, id) => p.phone === id,
  readPhoneContacts: () => [], currentPhoneSlot: p => p,
  phoneItemData: slot => slot?.phone ? { id: slot.phone } : undefined,
});
vm.runInContext(source.slice(source.indexOf('function evaluate(player)'), source.indexOf('function isPhoneId(')), context);
vm.runInContext(runtime, context);
context.a = players[0]; context.b = players[1];
context.pa = { id: 'pa', number: '0001', icName: 'Alice' };
context.pb = { id: 'pb', number: '0002', icName: 'Bob' };
const run = code => vm.runInContext(code, context);
assert.equal(run('startPhoneCall(a, pa, pb, true)'), '');
assert.equal(players[0].tags.has('vcmumble.call.mic'), true); assert.equal(players[1].tags.size, 0);
assert.equal(players[0].publishedOn, true); assert.equal(players[0].normalOn, false);
assert.match(players[1].messages.at(-1), /#@\+\*/);
assert.match(players[1].messages.at(-1), /^§e/);
assert.doesNotMatch(players[1].messages.at(-1), /Alice|0001/);
assert.notEqual(run('startPhoneCall(b, pb, pa, false)'), '');
run('acceptPhoneCall(a)'); assert.equal(players[0].tags.size, 1);
run('acceptPhoneCall(b)'); assert.equal(players[0].tags.size, 2); assert.equal(players[1].tags.size, 2);
assert.equal(players[1].publishedOn, true);
assert.equal(players[1].normalOn, false);
assert.match([...players[0].tags].find(t => t.startsWith('vcmumble.call.active.')), /\.a\.0$/);
assert.equal(run('togglePhoneSpeaker(b)'), true);
assert.match([...players[1].tags].find(t => t.startsWith('vcmumble.call.active.')), /\.b\.1$/);
assert.match([...players[0].tags].find(t => t.startsWith('vcmumble.call.active.')), /\.a\.0$/);
assert.equal(run('togglePhoneSpeaker(b)'), false);
assert.match([...players[1].tags].find(t => t.startsWith('vcmumble.call.active.')), /\.b\.0$/);
players[1].phone = undefined; monitor(); assert.equal(players[0].tags.size, 0); assert.equal(players[1].tags.size, 0);
players[1].phone = 'pb'; assert.equal(run('startPhoneCall(a, pa, pb, false)'), '');
context.system.currentTick += 1200; monitor(); assert.equal(run('phoneCallFor(a)'), undefined);
console.log('PASS: ringing has no active-call audio tags; anonymous identity; busy/self accept guard; mutual call tags; held-phone cleanup; timeout.');

assert.equal(players[0].publishedOn, false);
assert.equal(players[1].publishedOn, false);
assert.equal(players[0].range, 30);
// Existing ON stays ON after the overlay, without changing its normal latch.
players[0].normalOn = true; players[0].state = undefined;
run('startPhoneCall(a, pa, pb, false)');
run('endPhoneCall(phoneCallFor(a))');
assert.equal(players[0].publishedOn, true);
assert.equal(players[0].normalOn, true);
// Disconnect leaves no routing for the other participant.
run('startPhoneCall(a, pa, pb, false)'); run('acceptPhoneCall(b)');
const departed = players.pop(); monitor();
assert.equal(players[0].tags.size, 0);
players.push(departed);
console.log('PASS: real Mic evaluator opens caller on dial and recipient on accept, preserves normal latch/range, restores OFF/ON on end, timeout and disconnect.');

context.readPhoneContacts = () => [];
assert.equal(run("incomingCallIdentity('pb', 'pa', '0001', false)"), '0001');
context.readPhoneContacts = () => [{ phoneId: 'pa', name: 'Saved Alice' }];
assert.equal(run("incomingCallIdentity('pb', 'pa', '0001', false)"), 'Saved Alice (0001)');
assert.equal(run("incomingCallIdentity('pb', 'pa', '0001', true)"), '#@+*');
run("phoneChat(a, 'ปกติ'); phoneChat(b, 'ขัดข้อง', 'error')");
assert.equal(players[0].messages.at(-1), '§b[ SleepyPhone ] ปกติ§r');
assert.equal(players[1].messages.at(-1), '§c[ SleepyPhone ] ขัดข้อง§r');
run('startPhoneCall(a, pa, pb, false); endPhoneCall(phoneCallFor(a))');
assert.equal(players[0].messages.at(-1), '§b[ SleepyPhone ] วางสายแล้ว§r');
assert.ok(source.includes('.button("เพิ่มรายชื่อ", openAddContact, { visible: pages.contactsApp })'));
console.log('PASS: saved-name privacy, anonymous mask, chat colors, hangup text and call-contact add button.');
