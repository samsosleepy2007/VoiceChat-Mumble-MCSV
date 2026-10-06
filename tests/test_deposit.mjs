import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');
class Item {constructor(typeId,amount=1){this.typeId=typeId;this.amount=amount;}clone(){return new Item(this.typeId,this.amount);}isStackableWith(b){return this.typeId===b.typeId;}}
class Obs {constructor(v){this.v=v;}getData(){return this.v;}setData(v){this.v=v;}}
let form;const jobs=new Map();
class Form {constructor(){form=this;this.buttons=[];this.labels=[];}header(){return this;}label(v){this.labels.push(typeof v === "string" ? v.replace(/§./g,"") : v);return this;}button(label,action){this.buttons.push({label,action});return this;}toggle(l,v){this.manual=v;return this;}slider(l,v,min,max,o){this.selected=v;this.maximum=max;this.sliderOptions=o;return this;}textField(l,v,o){this.input=v;this.inputOptions=o;return this;}closeButton(...a){assert.equal(a.length,0);return this;}show(){return new Promise(r=>this.finish=r);}close(){this.finish();}}
let account,slots,held='123',fail=false;
const player={id:'test',sendMessage(){}};
const ctx=vm.createContext({BANK_CARD_IDS:{black:'custom:blackcard',white:'custom:whitecard'},BANK_CARD_ACCOUNT:'sleepybank:account',BANK_ACCOUNT_PREFIX:'sleepybank:account:',EquipmentSlot:{Mainhand:'main'},equippable:()=>({getEquipment:()=>({typeId:'custom:blackcard',getDynamicProperty:()=>held})}),world:{getDynamicProperty:()=>JSON.stringify(account)},inventory:()=>({size:slots.length,getItem:i=>slots[i]?.clone(),setItem(i,v){slots[i]=v?.clone();}}),writeBankAccount:a=>{if(fail){fail=false;throw Error('write failure');}account={...a};},ItemStack:Item,CustomForm:Form,ObservableString:Obs,ObservableBoolean:Obs,ObservableNumber:Obs,system:{runInterval:f=>{jobs.set(1,f);return 1;},clearRun:id=>jobs.delete(id),runTimeout:f=>f()},console:{warn(){}}});
vm.runInContext(source.slice(source.indexOf('const openAtmPlayers'),source.indexOf('function phonePageForm(')),ctx);
function reset(items,size=12){account={number:'123',phoneId:'p',cardType:'black',balance:250,income:400,expenses:150};slots=Array.from({length:size},(_,i)=>items[i]);held='123';}
const money=(v,n=1)=>new Item(`sleepy:money_${v}`,n);
reset([money(1,2),money(5,3),money(10,4),money(100,2),money(500),money(1000)]);assert.equal(ctx.cashTotal(player),1757);
let r=ctx.depositCash(player,'123',678);assert.equal(r.amount,678);assert.equal(ctx.cashTotal(player),1079);assert.equal(account.balance,928);assert.equal(account.income,1078);assert.equal(account.expenses,150);assert.ok(slots.every(x=>!x||x.amount<=64));
reset([money(1000)]);r=ctx.depositCash(player,'123',123);assert.equal(ctx.cashTotal(player),877);assert.equal(account.balance,373);
reset([money(1000,2)],1);r=ctx.depositCash(player,'123',1);assert.match(r.error,/เงินทอน/);assert.equal(ctx.cashTotal(player),2000);assert.equal(account.balance,250);
reset([money(100)]);fail=true;r=ctx.depositCash(player,'123',100);assert.ok(r.error);assert.equal(ctx.cashTotal(player),100);assert.equal(account.balance,250);
for(const amount of [0,-1,1.5,101]){reset([money(100)]);assert.ok(ctx.depositCash(player,'123',amount).error);assert.equal(ctx.cashTotal(player),100);}
reset([money(100)]);held='999';assert.ok(ctx.depositCash(player,'123',50).error);held='123';
const pending=ctx.openAtm(player);form.buttons[0].action();await new Promise(r=>setImmediate(r));form.selected.setData(30);form.buttons[0].action();await pending;assert.equal(account.balance,280);assert.equal(ctx.cashTotal(player),70);assert.equal(jobs.size,0);
reset([]);account.balance=1678;r=ctx.withdrawCash(player,'123',1678);assert.equal(r.amount,1678);assert.equal(account.balance,0);assert.equal(account.expenses,1828);assert.equal(account.income,400);assert.equal(ctx.cashTotal(player),1678);
assert.deepEqual(slots.filter(Boolean).map(x=>[x.typeId,x.amount]),[[1000,1],[500,1],[100,1],[10,7],[5,1],[1,3]].map(([v,n])=>[`sleepy:money_${v}`,n]));
reset([money(100,63)],1);r=ctx.withdrawCash(player,'123',100);assert.equal(slots[0].amount,64);assert.equal(account.balance,150);
reset([money(100,64)],1);assert.ok(ctx.withdrawCash(player,'123',100).error);assert.equal(account.balance,250);assert.equal(slots[0].amount,64);
reset([]);account.balance=65000;r=ctx.withdrawCash(player,'123',65000);assert.equal(slots[0].amount,64);assert.equal(slots[1].amount,1);
reset([new Item('minecraft:stone',64)],1);assert.ok(ctx.withdrawCash(player,'123',1).error);assert.equal(account.balance,250);assert.equal(ctx.cashTotal(player),0);
reset([]);fail=true;assert.ok(ctx.withdrawCash(player,'123',123).error);assert.equal(account.balance,250);assert.equal(account.expenses,150);assert.equal(ctx.cashTotal(player),0);
for(const amount of [0,-1,1.5,251,Number.MAX_SAFE_INTEGER+1]){reset([]);assert.ok(ctx.withdrawCash(player,'123',amount).error);assert.equal(account.balance,250);assert.equal(ctx.cashTotal(player),0);}
reset([]);held='999';assert.ok(ctx.withdrawCash(player,'123',100).error);held='123';
reset([]);const withdrawPage=ctx.openAtm(player);form.buttons[1].action();await new Promise(r=>setImmediate(r));form.selected.setData(100);form.buttons[0].action();await withdrawPage;assert.equal(account.balance,150);assert.equal(account.expenses,250);assert.equal(ctx.cashTotal(player),100);assert.equal(jobs.size,0);
console.log('PASS: withdrawal denomination allocation, stack limits, full inventory rejection, rollback, access/amount guards, slider/manual clamp, repeat clicks and expense totals.');
console.log('PASS: deposit conservation, denominations/change, full inventory rejection, rollback, invalid amounts/card, slider/manual clamp, repeat clicks and refreshed ATM totals.');
