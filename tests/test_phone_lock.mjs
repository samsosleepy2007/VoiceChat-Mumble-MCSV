import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');const data=new Map();let form;
class Obs{constructor(v){this.v=v;}getData(){return this.v;}setData(v){this.v=v;}}
class Form{constructor(){form=this;this.actions=[];}label(){return this;}textField(_,input){this.input=input;return this;}button(_,fn){this.actions.push(fn);return this;}closeButton(){return this;}show(){return new Promise(r=>this.done=r);}close(){this.done();}}
const ctx=vm.createContext({world:{getDynamicProperty:k=>data.get(k),setDynamicProperty:(k,v)=>v===undefined?data.delete(k):data.set(k,v)},ObservableString:Obs,CustomForm:Form,phoneChat(){}});
vm.runInContext(source.slice(source.indexOf('function readPhoneLock('),source.indexOf('async function showPhone(')),ctx);
ctx.writePhoneLock('phone','0123','Owner');assert.equal(await ctx.unlockPhone({name:'OWNER'},'phone'),true);
const pending=ctx.unlockPhone({name:'Guest'},'phone');form.input.setData('0000');form.actions[0]();assert.equal(form.input.getData(),'');form.input.setData('0123');form.actions[0]();assert.equal(await pending,true);
const cancel=ctx.unlockPhone({name:'Guest'},'phone');form.close();assert.equal(await cancel,false);
ctx.writePhoneLock('phone');assert.equal(await ctx.unlockPhone({name:'Guest'},'phone'),true);
console.log('PASS: PIN persists, owner bypass, wrong PIN denied, correct PIN unlock, close denies access, disabling unlocks.');
