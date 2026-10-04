import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');
const properties=new Map(), inboxes=new Map(),contacts=[];let notification;
const ctx=vm.createContext({Date,PHONE_INBOX_LIMIT:30,ANONYMOUS_NAME:'ไม่ระบุตัวตน',ANONYMOUS_NUMBER:'#@+*',
 world:{getDynamicProperty:k=>properties.get(k),setDynamicProperty:(k,v)=>properties.set(k,v),getAllPlayers:()=>[{id:'b'}]},
 readPhoneInbox:id=>inboxes.get(id)||[],readPhoneContacts:()=>contacts,playerHasPhoneId:()=>true,
 phoneChat:(_,text)=>{notification=text;},
});
for(const [start,end] of [['function readPhoneOutgoing(','function createMessageId('],['function formatPhoneMessageTime(','function slotHasPhoneId('],['function resolveIncomingMessageName(','let phoneCallSequence = 0;']]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),ctx);
const msg=(id,from,body,time,anonymous=false)=>({id,senderPhoneId:from,senderNumber:from==='a'?'0001':'0002',senderName:'Secret IC',body,timestamp:time,anonymous,read:false});
inboxes.set('a',[msg('r1','b','reply',2),msg('r2','b','again',4),msg('anon','b','hidden',5,true)]);
inboxes.set('b',[msg('s1','a','old sent',1)]);
ctx.writePhoneOutgoing('a',[{...msg('s2','a','new sent',3),peerPhoneId:'b',peerNumber:'0002'}]);
assert.deepEqual(Array.from(ctx.phoneConversationMessages('a','b'),m=>m.id),['s1','r1','s2','r2']);
assert.equal(ctx.phoneInboxThreads('a').length,2);
assert.equal(ctx.phoneConversationMessages('a','b',true).length,1);
assert.equal(ctx.resolveIncomingMessageName('a',msg('x','b','',1)),'');
ctx.notifyPhoneRecipient('a',msg('x','b','',1));assert.equal(notification,'มีข้อความจาก 0002');
contacts.push({phoneId:'b',name:'Saved Bob'});
ctx.notifyPhoneRecipient('a',msg('x','b','',1));assert.equal(notification,'มีข้อความจาก Saved Bob (0002)');
ctx.notifyPhoneRecipient('a',msg('x','b','',1,true));assert.equal(notification,'มีข้อความจาก #@+*');
const history=Array.from({length:12},(_,i)=>msg('m'+i,'b','body'+i,i+1));
const latest=ctx.phoneConversationText(history);assert.equal(latest.older,true);assert.equal(latest.newer,false);assert.match(latest.text,/body11/);assert.doesNotMatch(latest.text,/body0\n/);
assert.equal(ctx.phoneConversationText(history,2).newer,true);
ctx.writePhoneOutgoing('a',Array.from({length:100},(_,i)=>({...msg('large'+i,'a','ก'.repeat(500),1),peerPhoneId:'b',peerNumber:'0002'})));
assert.ok(Buffer.byteLength(properties.get('vcmphone:outgoing:a'),'utf8')<=28000);
assert.ok(!source.includes('phoneChat(player, `เตรียมและส่งคำขอเปิด DDUI:'));
console.log('PASS: legacy incoming/outgoing recovery, persistence, one thread per pair, anonymous isolation, paging and notification privacy.');
ctx.writePhoneInbox=(id,m)=>inboxes.set(id,m);
ctx.readPhoneProfile=id=>({id,number:id==='a'?'0001':'0002'});
const sent=msg('receipt','a','check read receipt',100);
inboxes.set('b',[sent]);inboxes.set('a',[]);
ctx.writePhoneOutgoing('a',[{...sent,peerPhoneId:'b',peerNumber:'0002'}]);
assert.match(ctx.phoneConversationText(ctx.phoneConversationMessages('a','b')).text,/ยังไม่อ่าน/);
ctx.markPhoneConversationRead('b','a');
assert.equal(inboxes.get('b')[0].read,true);
assert.match(ctx.phoneConversationText(ctx.phoneConversationMessages('a','b')).text,/อ่านแล้ว/);
inboxes.set('b',[]);
assert.equal(ctx.phoneConversationMessages('a','b')[0].read,true);
const colored=ctx.phoneConversationText(history).text;
assert.match(colored,/§7[^]*body7/);assert.match(colored,/§f[^]*body11/);
assert.doesNotMatch(ctx.phoneConversationText(history,2).text,/§f/);
console.log('PASS: latest message white, old messages gray; actual recipient read persists after inbox deletion.');
