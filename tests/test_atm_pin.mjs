import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');
let owner=false,lock={pin:'0123',owner:'OwnerXbox'},held='123',form;
class Obs{constructor(v){this.v=v;}getData(){return this.v;}setData(v){this.v=v;}}
class Form{constructor(){form=this;}label(){return this;}textField(_,input){this.input=input;return this;}button(_,action){this.action=action;return this;}closeButton(){return this;}show(){return new Promise(r=>this.done=r);}close(){this.done();}}
const player={messages:[],sendMessage(s){this.messages.push(s);}};
const account={number:'123',phoneId:'phone'};
const ctx=vm.createContext({canEditPhoneIc:()=>owner,readPhoneLock:()=>lock,atmAccountFromCard:()=>({account:{...account,number:held}}),CustomForm:Form,ObservableString:Obs});
vm.runInContext(source.slice(source.indexOf('function atmAccessValid('),source.indexOf('async function openAtm(')),ctx);
owner=true;assert(await ctx.unlockAtm(player,account));assert.equal(form,undefined);
owner=false;lock=undefined;assert.equal(await ctx.unlockAtm(player,account),undefined);
lock={pin:'0123',owner:'OwnerXbox'};let pending=ctx.unlockAtm(player,account);form.input.setData('wrong');form.action();assert.equal(form.input.getData(),'');form.input.setData('0123');form.action();const auth=await pending;assert(ctx.atmAccessValid(player,account,auth));lock={pin:'9999',owner:'OwnerXbox'};assert(!ctx.atmAccessValid(player,account,auth));lock=undefined;assert(!ctx.atmAccessValid(player,account,auth));
lock={pin:'0123',owner:'OwnerXbox'};pending=ctx.unlockAtm(player,account);held='456';form.input.setData('0123');form.action();assert.equal(await pending,undefined);held='123';pending=ctx.unlockAtm(player,account);form.close();assert.equal(await pending,undefined);
console.log('PASS ATM PIN: owner bypass, unset PIN denied, wrong/correct PIN, changed/removed PIN invalidates authorization, swapped card and cancel denied');
