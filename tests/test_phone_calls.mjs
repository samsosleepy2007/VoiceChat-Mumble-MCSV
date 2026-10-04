import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
const runtime = source.slice(source.indexOf('let phoneCallSequence = 0;'), source.indexOf('const openPhonePlayers = new Set();'));
const players = [
  { id: 'a', phone: 'pa', tags: new Set(), messages: [] },
  { id: 'b', phone: 'pb', tags: new Set(), messages: [] },
];
for (const p of players) {
  p.getTags = () => [...p.tags]; p.addTag = t => p.tags.add(t);
  p.removeTag = t => p.tags.delete(t); p.sendMessage = m => p.messages.push(m);
}
let monitor;
const context = vm.createContext({
  world: { getAllPlayers: () => players },
  system: { currentTick: 100, runInterval: f => { monitor = f; } },
  playerHasPhoneId: (p, id) => p.phone === id,
  readPhoneContacts: () => [], currentPhoneSlot: p => p,
  phoneItemData: slot => slot?.phone ? { id: slot.phone } : undefined,
});
vm.runInContext(runtime, context);
context.a = players[0]; context.b = players[1];
context.pa = { id: 'pa', number: '0001', icName: 'Alice' };
context.pb = { id: 'pb', number: '0002', icName: 'Bob' };
const run = code => vm.runInContext(code, context);
assert.equal(run('startPhoneCall(a, pa, pb, true)'), '');
assert.equal(players[0].tags.size, 0); assert.equal(players[1].tags.size, 0);
assert.match(players[1].messages.at(-1), /ไม่ระบุตัวตน/);
assert.doesNotMatch(players[1].messages.at(-1), /Alice|0001/);
assert.notEqual(run('startPhoneCall(b, pb, pa, false)'), '');
run('acceptPhoneCall(a)'); assert.equal(players[0].tags.size, 0);
run('acceptPhoneCall(b)'); assert.equal(players[0].tags.size, 1); assert.equal(players[1].tags.size, 1);
assert.match([...players[0].tags][0], /\.a\.0$/);
assert.equal(run('togglePhoneSpeaker(b)'), true);
assert.match([...players[1].tags][0], /\.b\.1$/);
assert.match([...players[0].tags][0], /\.a\.0$/);
assert.equal(run('togglePhoneSpeaker(b)'), false);
assert.match([...players[1].tags][0], /\.b\.0$/);
players[1].phone = undefined; monitor(); assert.equal(players[0].tags.size, 0); assert.equal(players[1].tags.size, 0);
players[1].phone = 'pb'; assert.equal(run('startPhoneCall(a, pa, pb, false)'), '');
context.system.currentTick += 1200; monitor(); assert.equal(run('phoneCallFor(a)'), undefined);
console.log('PASS: ringing has no audio tags; anonymous identity; busy/self accept guard; mutual call tags; held-phone cleanup; timeout.');
