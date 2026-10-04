import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js', import.meta.url),'utf8');
class Observable { constructor(value){this.value=value;} getData(){return this.value;} setData(value){this.value=value;} }
let form, dial;
class Form {
 constructor(){form=this;this.entries=[];}
 button(label,action,options={}){this.entries.push({type:'button',label,action,...options});return this;}
 textField(label,value,options={}){this.entries.push({type:'field',label,value,...options});return this;}
 label(value,options={}){this.entries.push({type:'label',value,...options});return this;}
 header(){return this;} divider(){return this;} spacer(){return this;} toggle(){return this;}
 closeButton(){return this;} close(){} async show(){}
}
let contacts=[{phoneId:'pb',name:'Saved Bob',number:'0002',createdAt:Date.UTC(2026,9,4,21,0),favorite:false}];
const profiles={pa:{id:'pa',icName:'Alice',number:'0001'},pb:{id:'pb',icName:'Bob',number:'0002'},pc:{id:'pc',icName:'Carol',number:'0003'}};
const ctx=vm.createContext({console,Date,ObservableBoolean:Observable,ObservableString:Observable,ObservableNumber:Observable,CustomForm:Form,
 openPhonePlayers:new Set(),openSettingsPlayers:new Set(),resolvePhoneProfile:()=>({slot:{},profile:profiles.pa}),
 PHONE_CONTACT_LIMIT:30,PHONE_INBOX_LIMIT:30,PHONE_NAME_MAX_LENGTH:24,PHONE_CONTACT_NAME_MAX_LENGTH:24,PHONE_MESSAGE_MAX_LENGTH:500,
 ANONYMOUS_NAME:'ไม่ระบุตัวตน',ANONYMOUS_NUMBER:'#@+*',
 readPhoneContacts:()=>contacts.map(c=>({...c})),writePhoneContacts:(_,c)=>{contacts=c;},
 readPhoneProfile:id=>profiles[id],readPhoneProfileByNumber:n=>Object.values(profiles).find(p=>p.number===n),
 readPhoneInbox:()=>[],phoneCallFor:()=>undefined,
 normalizeContactName:s=>s.trim(),phoneChat(){},
 startPhoneCall:(_,own,target,anonymous)=>{dial={target,anonymous};return '';},
 system:{run:f=>f(),runTimeout:f=>f()},
});
vm.runInContext(source.slice(source.indexOf('function phoneContactDateTime('),source.indexOf('function readPhoneInbox(')),ctx);
vm.runInContext(source.slice(source.indexOf('async function showPhone('),source.indexOf('function handlePhoneUse(')),ctx);
await ctx.showPhone({id:'a',name:'Alice'});
const value=v=>v instanceof Observable?v.getData():v;
const buttons=()=>form.entries.filter(e=>e.type==='button'&&e.visible?.getData());
const click=name=>{const b=buttons().find(e=>value(e.label)===name);assert.ok(b,`visible button: ${name}`);b.action();};
const field=(label,text)=>{const f=form.entries.find(e=>e.type==='field'&&e.visible?.getData()&&e.label===label);assert.ok(f);f.value.setData(text);};
click('รายชื่อ');click('Saved Bob - 0002');
const details=form.entries.filter(e=>e.type==='label'&&e.visible?.getData()).map(e=>value(e.value)).join('\n');
assert.match(details,/ชื่อ IC:.*Bob/);assert.match(details,/05\/10\/2026 เวลา 04:00/);
click('แก้ไข');field('ชื่อที่ตั้ง','Saved Carol');field('เบอร์ 4 หลัก','0003');click('บันทึก');
assert.equal(contacts[0].phoneId,'pc');assert.equal(contacts[0].createdAt,Date.UTC(2026,9,4,21,0));
click('เพิ่มรายการโปรด');click('ย้อนกลับ');click('ย้อนกลับ');
assert.ok(buttons().some(b=>value(b.label)==='Saved Carol - 0003'));
click('ส่งข้อความ');click('ส่งด้วยรายชื่อ');assert.ok(!buttons().some(b=>value(b.label)==='เพิ่มรายชื่อ'));
click('Saved Carol - 0003');assert.ok(form.entries.some(e=>e.type==='field'&&e.label==='ข้อความ'&&e.visible?.getData()));
click('ย้อนกลับ');click('ย้อนกลับ');click('โทร');click('โทรด้วยรายชื่อ');
assert.ok(!buttons().some(b=>value(b.label)==='เพิ่มรายชื่อ'||String(value(b.label)).startsWith('ไม่ระบุตัวตน:')));
click('Saved Carol - 0003');assert.ok(buttons().some(b=>value(b.label)==='โทรปกติ'));
click('โทรแบบไม่ระบุตัวตน');assert.equal(dial.target.id,'pc');assert.equal(dial.anonymous,true);
assert.throws(()=>ctx.updatePhoneContact('pa',contacts[0],'X','9999'),/ไม่พบเบอร์/);
assert.throws(()=>ctx.updatePhoneContact('pa',contacts[0],'X','0001'),/ตัวเอง/);
console.log('PASS: actual DDUI contacts app, details, Bangkok date, edit retargeting, Favorites, direct compose, call confirmation and anonymous dial.');
