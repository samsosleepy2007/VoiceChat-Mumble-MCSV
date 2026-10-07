import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');
const account={number:'123',phoneId:'p',cardType:'black',balance:250,income:400,expenses:150};
let held,form,finish;
class Obs { constructor(v){this.v=v;} setData(v){this.v=v;} }
class Form {
 constructor(){form=this;this.buttons=[];this.labels=[];}
 header(){return this;} label(v){this.labels.push(typeof v === "string" ? v.replace(/§./g,"") : v);return this;}
 button(label,action){this.buttons.push({label,action});return this;}
 closeButton(...args){assert.equal(args.length,0,"CustomForm.closeButton takes no arguments");return this;} show(){return new Promise(r=>finish=r);}
}
const player={id:'a',messages:[],sendMessage(m){this.messages.push(m.replace(/§./g,""));}};
const ctx=vm.createContext({
 BANK_CARD_IDS:{black:'custom:blackcard',white:'custom:whitecard'},BANK_CARD_ACCOUNT:'sleepybank:account',BANK_ACCOUNT_PREFIX:'sleepybank:account:',
 canEditPhoneIc:()=>true,readPhoneLock:()=>undefined,
 EquipmentSlot:{Mainhand:'main'},equippable:()=>({getEquipment:()=>held}),
 world:{getDynamicProperty:()=>JSON.stringify(account)},CustomForm:Form,ObservableString:Obs,console,
});
vm.runInContext(source.slice(source.indexOf('const openAtmPlayers'),source.indexOf('function phonePageForm(')),ctx);
await ctx.openAtm(player);
assert.equal(player.messages.at(-1),'[ SleepyATM ] กรุณาถือบัตรเครดิตของคุณ');
held={typeId:'minecraft:stick'};await ctx.openAtm(player);assert.equal(form,undefined);
held={typeId:'custom:blackcard',getDynamicProperty:()=>undefined};await ctx.openAtm(player);
assert.match(player.messages.at(-1),/ยังไม่ได้ลงทะเบียน/);
held.getDynamicProperty=()=> '123';const pending=ctx.openAtm(player);await Promise.resolve();
assert.match(form.labels[0],/เลขบัญชี: 123/);assert.match(form.labels[0],/จำนวนเงินที่มีทั้งหมด: 250/);
assert.match(form.labels[0],/รายรับ: 400/);assert.match(form.labels[0],/รายจ่าย: 150/);
assert.deepEqual(form.buttons.map(b=>b.label),['ฝากเงิน','ถอนเงิน','โอนเงิน','ประวัติการโอน']);
for(const b of form.buttons.slice(4))b.action();assert.equal(account.balance,250);
const first=form;await ctx.openAtm(player);assert.equal(first,form);
finish();await pending;
held={typeId:'custom:whitecard',getDynamicProperty:()=> '123'};
const again=ctx.openAtm(player);await Promise.resolve();assert.notEqual(first,form);finish();await again;
const block=JSON.parse(fs.readFileSync(new URL('../addon/BP/blocks/modern_atm.block.json',import.meta.url)))['minecraft:block'];
assert.equal(block.components['minecraft:light_emission'],3);
assert.ok(block.components['sleepy:atm_interact']);
assert.equal(block.description.traits['minecraft:multi_block'].parts,2);
console.log('PASS: empty/other/unregistered cards denied, both cards open DDUI, correct bank totals, placeholder actions, double-open guard and 2-block ATM with light level 3.');
