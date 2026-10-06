import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url), 'utf8');
const saved = new Map();
class Card {
 constructor(typeId) { assert.match(typeId, /^[a-z0-9_]+:[a-z0-9_]+$/); this.typeId = typeId; this.properties = new Map(); }
 setDynamicProperty(k, v) { this.properties.set(k, v); }
 getDynamicProperty(k) { return this.properties.get(k); }
}
const ctx = vm.createContext({
 world: { getDynamicProperty: k => saved.get(k), setDynamicProperty: (k, v) => saved.set(k, v) },
 inventory: p => p.inv, ItemStack: Card, Math: Object.assign(Object.create(Math), { random: () => 0 }),
});
vm.runInContext(source.slice(source.indexOf('const BANK_ACCOUNT_PREFIX'), source.indexOf('function phonePageForm(')), ctx);
const player = name => ({ name, inv: { size: 1, emptySlotsCount: 1, items: [], addItem(c) { if (!this.emptySlotsCount) return c; this.items.push(c); this.emptySlotsCount--; }, getItem(i) { return this.items[i]; }, setItem(i,c) { this.items[i]=c; } } });
ctx.a = player('Alice'); ctx.b = player('Bob');
const run = s => vm.runInContext(s, ctx);
assert.equal(run('openBankAccount("phone-a", randomBankNumber()).number'), '100');
assert.equal(run('openBankAccount("phone-a", randomBankNumber()).number'), '100');
assert.equal(run('openBankAccount("phone-b", randomBankNumber()).number'), '101');
assert.equal(run('readBankAccount("phone-a").balance'), 0);
ctx.a.inv.emptySlotsCount=0;
assert.match(run('issueBankCard(a,"phone-a","black")'), /กระเป๋าเต็ม/);
assert.equal(run('readBankAccount("phone-a").cardType'), '');
ctx.a.inv.emptySlotsCount=1;
assert.equal(run('issueBankCard(a,"phone-a","black")'), "");
assert.equal(ctx.a.inv.items[0].typeId, 'custom:blackcard');
assert.equal(ctx.a.inv.items[0].nameTag, 'บัตร - 100');
assert.match(run('issueBankCard(a,"phone-a","white")'), /ได้รับบัตรแล้ว/);
assert.equal(ctx.a.inv.items.length, 1);
run('const account = readBankAccount("phone-a"); account.balance=123; writeBankAccount(account); syncBankCards(a)');
assert.equal(ctx.a.inv.items[0].nameTag, 'บัตร - 100');
assert.equal(run('issueBankCard(b,"phone-b","white")'), "");
assert.equal(ctx.b.inv.items[0].typeId, 'custom:whitecard');
ctx.a.name='ALICE'; assert.equal(run('readBankAccount("phone-a").number'),'100');
for(let i=102;i<=999;i++) saved.set('sleepybank:account:'+i,'reserved');
ctx.c=player('Carol'); assert.equal(run('randomBankNumber()'),undefined);
assert.equal(saved.has('sleepybank:owner:carol'),false);
console.log('PASS: unique persistent accounts, zero balance, both card types, duplicate/full inventory guards, balance name sync and number exhaustion.');

assert.equal(run("readBankAccount('other-phone')"),undefined);
assert.equal(run("randomBankNumber('100')"),undefined);
console.log('PASS: bank access is linked to phone identity, and card name omits balance.');
ctx.canEditPhoneIc=()=>true;
saved.set('sleepybank:owner:legacy','777');
saved.set('sleepybank:account:777',JSON.stringify({number:'777',owner:'legacy',balance:50,cardType:'white'}));
ctx.legacy=player('Legacy');
run('migrateBankAccount(legacy,"legacy-phone")');
assert.equal(run('readBankAccount("legacy-phone").balance'),50);
assert.equal(run('readBankAccount("legacy-phone").cardType'),'white');
assert.equal(saved.get('sleepybank:owner:legacy'),undefined);
run('migrateBankAccount(legacy,"another-phone")');
assert.equal(run('readBankAccount("another-phone")'),undefined);
console.log('PASS: existing account migration retains balance/card and cannot be linked to another phone.');
