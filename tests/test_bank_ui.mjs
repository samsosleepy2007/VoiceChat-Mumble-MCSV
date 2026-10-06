import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url),'utf8');
class Observable { constructor(value,options={}){this.value=value;this.clientWritable=options.clientWritable===true;} getData(){return this.value;} setData(value){this.value=value;} }
let form, dial, historyBody;
class ActionForm { title(){return this;} body(text){historyBody=text;return this;} button(){return this;} show(){return Promise.resolve({selection:0});} }
class Form {
 constructor(){form=this;this.entries=[];}
 button(label,action,options={}){this.entries.push({type:'button',label,action,...options});return this;}
 textField(label,value,options={}){assert.equal(value.clientWritable,true,'DDUI text fields require clientWritable: '+label);this.entries.push({type:'field',label,value,...options});return this;}
 label(value,options={}){this.entries.push({type:'label',value,...options});return this;}
 header(){return this;} divider(){return this;} spacer(){return this;} toggle(){return this;}
 closeButton(){return this;} close(){this.resolve?.();} show(){return new Promise(resolve=>{this.resolve=resolve;});}
}
let contacts=[{phoneId:'pb',name:'Saved Bob',number:'0002',createdAt:Date.UTC(2026,9,4,21,0),favorite:false}];
const profiles={pa:{id:'pa',icName:'Alice',number:'0001'},pb:{id:'pb',icName:'Bob',number:'0002'},pc:{id:'pc',icName:'Carol',number:'0003'}};
const ctx=vm.createContext({console,Date,ObservableBoolean:Observable,ObservableString:Observable,ObservableNumber:Observable,CustomForm:Form,ActionFormData:ActionForm,
 openPhonePlayers:new Set(),openSettingsPlayers:new Set(),resolvePhoneProfile:()=>({slot:{},profile:profiles.pa}),
 PHONE_CONTACT_LIMIT:30,PHONE_INBOX_LIMIT:30,PHONE_NAME_MAX_LENGTH:24,PHONE_CONTACT_NAME_MAX_LENGTH:24,PHONE_MESSAGE_MAX_LENGTH:500,
 ANONYMOUS_NAME:'ไม่ระบุตัวตน',ANONYMOUS_NUMBER:'#@+*',
 world: { getDynamicProperty:()=>undefined, setDynamicProperty(){} },
 readPhoneContacts:()=>contacts.map(c=>({...c})),writePhoneContacts:(_,c)=>{contacts=c;},
 readPhoneProfile:id=>profiles[id],readPhoneProfileByNumber:n=>Object.values(profiles).find(p=>p.number===n),
 readPhoneInbox:()=>[],phoneCallFor:()=>undefined,
 normalizeContactName:s=>s.trim(),phoneChat(){},
 startPhoneCall:(_,own,target,anonymous)=>{dial={target,anonymous};return '';},
 system:{run:f=>f(),runTimeout:f=>f()},
});
vm.runInContext(source.slice(source.indexOf('function phoneContactDateTime('),source.indexOf('function readPhoneInbox(')),ctx);
vm.runInContext(source.slice(source.indexOf('function readPhoneOutgoing('),source.indexOf('function createMessageId(')),ctx);
vm.runInContext(source.slice(source.indexOf('function phoneIcOwner('),source.indexOf('async function showPhone(')),ctx);
vm.runInContext(source.slice(source.indexOf('function phonePageForm('),source.indexOf('function handlePhoneUse(')),ctx);
const bankProperties = new Map();
const bankItems = [];
ctx.world = { getDynamicProperty: k => bankProperties.get(k), setDynamicProperty: (k,v) => bankProperties.set(k,v) };
ctx.inventory = () => ({ emptySlotsCount: 1, size: bankItems.length, addItem: item => { bankItems.push(item); }, getItem: i => bankItems[i], setItem: (i,item) => { bankItems[i]=item; } });
ctx.ItemStack = class { constructor(typeId) { this.typeId=typeId; this.props=new Map(); } setDynamicProperty(k,v) { this.props.set(k,v); } getDynamicProperty(k) { return this.props.get(k); } };
vm.runInContext(source.slice(source.indexOf('const BANK_ACCOUNT_PREFIX'), source.indexOf('function phonePageForm(')), ctx);
const session = ctx.showPhone({id:'a',name:'Alice'});
const settle = () => new Promise(resolve=>setImmediate(resolve));
await settle();
assert.ok(form.entries.length < 25, 'home creates only its own controls');
const value=v=>v instanceof Observable?v.getData():v;
const buttons=()=>form.entries.filter(e=>e.type==='button'&&e.visible?.getData());
const click=async name=>{const b=buttons().find(e=>value(e.label)===name);assert.ok(b,`visible button: ${name}`);b.action();await settle();};
const field=(label,text)=>{const f=form.entries.find(e=>e.type==='field'&&e.visible?.getData()&&e.label===label);assert.ok(f);f.value.setData(text);};
await click('ธนาคาร');
assert.ok(buttons().some(b=>value(b.label)==='ยืนยันไปต่อ'));
assert.ok(buttons().some(b=>value(b.label)==='ไปหน้าตั้งค่า'));
assert.ok(!buttons().some(b=>value(b.label)==='โอนเงิน'));
ctx.phoneRingtone = () => 'deltarune';
await click('ไปหน้าตั้งค่า');
assert.ok(buttons().some(b=>value(b.label)==='เปิดการใช้รหัสผ่าน'));
await click('ย้อนกลับ'); await click('ธนาคาร'); await click('ยืนยันไปต่อ');
const numberField=form.entries.find(e=>e.type==='field'&&e.label==='เลขบัญชี 3 หลัก');
assert.equal(numberField.disabled.getData(),true);
const first=numberField.value.getData();
await click('สุ่มเลขบัญชี');
assert.notEqual(numberField.value.getData(),first);
const chosen=numberField.value.getData();
numberField.value.setData('9999');
await click('ยืนยันเลขบัญชี');
assert.ok(buttons().some(b=>value(b.label)==='BlackCard'));
assert.ok(!buttons().some(b=>value(b.label)==='โอนเงิน'));
const notices=[]; ctx.phoneChat=(_, message)=>notices.push(message);
await click('BlackCard');
await session;
assert.equal(ctx.openPhonePlayers.size,0);
assert.deepEqual(notices,['คุณเปิดบัญชีแล้ว รักษาโทรศัพท์และบัตรของคุณให้ดี']);
const reopened=ctx.showPhone({id:'a',name:'Alice'}); await settle(); await click('ธนาคาร');
assert.equal(bankItems.length,1);
assert.equal(bankItems[0].nameTag,'บัตร - '+chosen);
assert.ok(buttons().some(b=>value(b.label)==='โอนเงิน'));
assert.ok(buttons().some(b=>value(b.label)==='ทัชแพด'));
assert.ok(!buttons().some(b=>value(b.label)==='BlackCard'));
await click('ย้อนกลับ'); await click('ธนาคาร');
assert.ok(buttons().some(b=>value(b.label)==='โอนเงิน'));
assert.ok(!buttons().some(b=>value(b.label)==='ยืนยันไปต่อ'));
const text=form.entries.filter(e=>e.type==='label').map(e=>value(e.value)).join('\n').replace(/§./g,'');
assert.ok(text.includes('เลขบัญชี: '+chosen)); assert.match(text,/จำนวนเงิน: 0/);
form.close(); await reopened;
// The same phone remains the bank identity when it changes hands.
const next=ctx.showPhone({id:'b',name:'Bob'}); await settle(); await click('ธนาคาร');
assert.ok(buttons().some(b=>value(b.label)==='โอนเงิน'));
assert.equal(bankItems.length,1);
form.close(); await next;
console.log('PASS: password warning/settings, separate registration/card/home pages, repeated randomization, immutable candidate and shared phone account.');
profiles.pa={id:'new-phone',icName:'Alice',number:'0001'};
ctx.readPhoneLock=()=>({pin:'1234',owner:'Alice'});
ctx.unlockPhone=async()=>true;
const lockedSession=ctx.showPhone({id:'a',name:'Alice'}); await settle(); await click('ธนาคาร');
assert.ok(buttons().some(b=>value(b.label)==='สุ่มเลขบัญชี'));
assert.ok(!buttons().some(b=>value(b.label)==='ยืนยันไปต่อ'));
form.close(); await lockedSession;
console.log('PASS: a phone with a password skips the warning and opens registration directly.');
