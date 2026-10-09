import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { PGlite } from '../web/join/node_modules/@electric-sql/pglite/dist/index.js';
import { unzipSync } from '../web/join/node_modules/fflate/esm/index.mjs';

process.env.SESSION_SECRET='test-session-secret-0123456789abcdef';
process.env.LICENSE_PRIVATE_KEY=generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const { signArtifact, verifyArtifact } = await import('../web/join/lib/artifact-token.js');
const { prepareInstallation, installOnMCSV, PACKS, WHEEL } = await import('../web/join/lib/mcsv-install.js');
const { BUNDLED } = await import('../web/join/lib/endweave.js');
const { installGuard, GuardError } = await import('../web/join/lib/install-guard.js');
const { paymentStore, payOrder } = await import('../web/join/lib/payments.js');
const { checkSlip, PaymentError } = await import('../web/join/lib/payment-providers.js');
const { alert } = await import('../web/join/lib/alerts.js');
const { default: artifactHandler } = await import('../web/join/api/mcsv/artifact.js');

// --- Signed artifact links -------------------------------------------------------------------------
const params={kind:'plugin',version:'2.15.44'};const now=Date.now();
const signed={...params,...signArtifact(params,{now})};
assert(verifyArtifact(signed,{now}));
assert(!verifyArtifact({...signed,kind:'packs'},{now}),'changing a parameter breaks the signature');
assert(!verifyArtifact({...signed,behavior:'x'},{now}),'adding a parameter breaks the signature');
assert(!verifyArtifact(signed,{now:now+6*60*1000}),'links expire after five minutes');
assert(!verifyArtifact(params,{now}),'unsigned links are refused');
assert(!verifyArtifact(signed,{now,env:{SESSION_SECRET:'another-secret-0123456789abcdefghij'}}),'other secrets do not verify');
assert.throws(()=>signArtifact(params,{env:{}}),e=>e.code==='artifact_unavailable');
async function get(query){let status,body,cache;await artifactHandler({method:'GET',url:'/api/mcsv/artifact?'+new URLSearchParams(query)},{setHeader(k,v){if(k==='Cache-Control')cache=v;},status(c){status=c;return this;},send(b){body=b;return this;},end(){return this;}});return {status,body,cache};}
assert.equal((await get(params)).status,403);
const served=await get({...params,...signArtifact(params)});assert.equal(served.status,200);assert.equal(served.cache,'private, no-store');
assert.equal(createHash('sha256').update(served.body).digest('hex'),'0839b0acb58d207aad957ff3617b891479028c7828e6731158e2e94195e603d5');
console.log('PASS artifact links: signed, parameter-bound, five-minute expiry, unsigned refused, never publicly cached');

// --- Free-install bypass: files on the server prove nothing ----------------------------------------
function mockServer(extra={}){
 const files=new Map([['/server.properties','level-name=W\n'],['/worlds/W/world_behavior_packs.json','[]'],['/worlds/W/world_resource_packs.json','[]'],...Object.entries(extra)]);
 const dirs=new Set(['/','/worlds','/worlds/W','/plugins','/behavior_packs','/resource_packs']);const calls=[];
 const listing=path=>{const prefix=path==='/'?'/':path+'/',items=new Map();for(const d of dirs)if(d.startsWith(prefix)&&d!==path&&!d.slice(prefix.length).includes('/'))items.set(d.slice(prefix.length),{name:d.slice(prefix.length),is_file:false});for(const [f,data] of files)if(f.startsWith(prefix)&&!f.slice(prefix.length).includes('/'))items.set(f.slice(prefix.length),{name:f.slice(prefix.length),is_file:true,size:Buffer.byteLength(data)});return {files:[...items.values()]};};
 const tools=['server_overview','files_list','files_read','files_read_many','files_read_base64','files_upload_base64','files_fetch_url','files_decompress','files_write','files_edit','files_compress','files_delete','power_action','domain_info'];
 const client={catalog:async()=>({tools:tools.map(name=>({name,allowed:true}))}),call:async(name,args={})=>{calls.push({name,args});switch(name){
  case 'server_overview':return {info:{id:'srv',name:'S',game:'minecraft-bedrock',server_type:'endstone',port:10459,ports:[10459,18655],status:'active',pelican_identifier:'5fb3cecf'},runtime:{current_state:'offline'}};
  case 'domain_info':return {node_hostname:'sv1.mcsv.me'};case 'files_list':return listing(args.directory);
  case 'files_read':return {content:String(files.get(args.path))};case 'files_read_many':return {files:args.paths.map(path=>files.has(path)?{path,content:String(files.get(path))}:{path,error:'not found'})};
  case 'files_read_base64':return {content_base64:Buffer.from(files.get(args.path)).toString('base64')};
  case 'files_upload_base64':files.set(args.path,Buffer.from(args.content_base64,'base64'));return {success:true};
  case 'files_compress':return {success:true,path:(args.root==='/'?'':args.root)+'/'+args.name};
  case 'files_decompress':for(const [path,bytes] of Object.entries(unzipSync(files.get('/'+args.file)))){files.set('/'+path,Buffer.from(bytes));dirs.add('/'+path.slice(0,path.lastIndexOf('/')));}return {success:true};case 'files_delete':for(const f of args.files)files.delete((args.root==='/'?'':args.root)+'/'+f);return {success:true};
  case 'files_edit':{let text=String(files.get(args.path));for(const e of args.edits)text=text.replace(e.old_string,e.new_string);files.set(args.path,text);return {success:true};}
  case 'files_write':files.set(args.path,args.content);dirs.add(args.path.slice(0,args.path.lastIndexOf('/')));return {success:true};
  default:return {success:true};}}};
 return {client,files,calls};
}
const planted=mockServer({'/plugins/endstone_mumble_host-0.0.1-py3-none-any.whl':''});
const plantedPlan=await prepareInstallation(planted.client);
assert.equal(plantedPlan.installation.present,true);assert.notEqual(plantedPlan.installation.parts.license,'valid','a planted file is not a license');assert.equal(plantedPlan.installation.status,'update');
// The library refuses to touch anything unless the caller explicitly authorizes the install.
await assert.rejects(installOnMCSV(planted.client,{serverId:'srv',world:'W',voicePort:18655},async()=>{throw Error('artifacts must not load');},async()=>undefined),e=>e.code==='payment_required');
assert(!planted.calls.some(c=>['files_write','files_upload_base64','files_compress','power_action'].includes(c.name)));
// A forged license (wrong signature) is reported invalid, so checkout is required.
const forged=mockServer({'/plugins/mumble_host/license.json':JSON.stringify({format:'sleepymumla-license-1',server:'5fb3cecf',port:18655,users:99,issued:'2026-01-01',signature:Buffer.alloc(64).toString('base64')})});
forged.files.set('/plugins/mumble_host/config.toml','[mumble]\nport = 18655\n');
// Present the mumble_host folder so the installer reads the planted license.
const forgedPlan=await prepareInstallation({...forged.client,call:async(name,args)=>name==='files_list'&&args.directory==='/plugins'?{files:[{name:'mumble_host',is_file:false}]}:name==='files_list'&&args.directory==='/plugins/mumble_host'?{files:[{name:'license.json',is_file:true},{name:'config.toml',is_file:true}]}:forged.client.call(name,args)});
assert.equal(forgedPlan.installation.parts.license,'invalid');
console.log('PASS free-install bypass closed: planted wheel or forged license is not proof of purchase; installs require explicit authorization');

// --- Wall-clock budget ------------------------------------------------------------------------------
const weaveBytes=Buffer.from('w');const fixture={endweave:{info:{...BUNDLED,sha256:createHash('sha256').update(weaveBytes).digest('hex'),size:1},bytes:weaveBytes},wheel:Buffer.from('wheel'),packs:Object.fromEntries(PACKS.map(p=>[p.type,{'manifest.json':Buffer.from(JSON.stringify({header:{uuid:p.uuid,version:[2,15,44]}}))}]))};
const slow=mockServer();
await assert.rejects(installOnMCSV(slow.client,{serverId:'srv',world:'W',voicePort:18655},async()=>fixture,async()=>true,async()=>{},{budgetMs:-1}),e=>e.code==='install_timeout'&&e.partial===false);
assert(!slow.calls.some(c=>['files_upload_base64','power_action'].includes(c.name)),'an install out of time stops before changing files');
const quick=mockServer();await installOnMCSV(quick.client,{serverId:'srv',world:'W',voicePort:18655},async()=>fixture,async()=>true);
assert(![...quick.files.keys()].some(f=>/SleepyMumla-packs-.*\.zip$/.test(f)),'the uploaded packs archive is removed after extraction');
assert(quick.files.has('/plugins/'+WHEEL));
console.log('PASS installer budget: stops cleanly before Vercel kills it; packs archive cleaned up');

// --- Install lock and rate limits (Postgres) --------------------------------------------------------
const pg=new PGlite();
const pgAdapter={query:async(sql,args)=>{if(!args){await pg.exec(sql);return {rows:[],rowCount:0};}const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}};
const guard=installGuard(pgAdapter);
const release=await guard.lock('srv');await assert.rejects(installGuard(pgAdapter).lock('srv'),e=>e instanceof GuardError&&e.code==='busy');
await release();const again=await guard.lock('srv');await again();
await pg.query("INSERT INTO sleepy_install_locks VALUES('stale','00000000-0000-0000-0000-000000000000',now()-interval '1 minute') ON CONFLICT(server_id) DO UPDATE SET expires_at=EXCLUDED.expires_at");
await (await guard.lock('stale'))();
for(let i=0;i<6;i++)await guard.limit('user-1','install');
await assert.rejects(guard.limit('user-1','install'),e=>e.code==='rate_limit');await guard.limit('user-2','install');
const offline=installGuard({query:async()=>{throw Error('db down');}});await (await offline.lock('srv'))();await offline.limit('u','install');
console.log('PASS install guard: one install per server across instances, stale locks expire, per-user rate limit, fails open when the database is down');

// --- Payments: review resolution, manual grants, SlipOK connection failures --------------------------
const db=new PGlite();await db.exec(await readFile(new URL('../web/join/lib/payment-schema.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../web/join/lib/payment-history-migration.sql',import.meta.url),'utf8'));
const adapter={query:async(sql,args)=>{const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},connect:async()=>({...adapter,release(){}})};
const store=paymentStore(adapter);const config={amount:10000,promptpay:true,truemoney:true};
const slip=Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64');
const alerts=[];const notify=async(title,fields)=>{alerts.push({title,fields});};
const stuck=await store.checkout('buyer','srv-review',10000,'Review server','Buyer');
await assert.rejects(payOrder('buyer',{orderId:stuck.id,method:'promptpay',image:slip},store,config,{checkSlip:async()=>{throw new PaymentError('payment_review',true);}},notify),e=>e.code==='payment_review');
assert.equal(alerts.length,1,'an order entering review alerts the operator');
assert.deepEqual((await store.review()).map(o=>o.id),[]);await db.query("UPDATE sleepy_payment_orders SET created_at=now()-interval '5 minutes' WHERE id=$1",[stuck.id]);
assert.deepEqual((await store.review()).map(o=>o.id),[stuck.id]);
assert.equal(await store.resolve(stuck.id,'retry','bank shows nothing yet'),'retry');assert.equal((await store.order(stuck.id,'buyer')).status,'pending');
assert.equal((await payOrder('buyer',{orderId:stuck.id,method:'promptpay',image:slip},store,config,{checkSlip:async()=>({reference:'ref-1',amount:10000})},notify)).paid,true,'the same slip can be resent after retry');
assert(await store.entitled('srv-review'));
const manual=await store.checkout('buyer2','srv-manual',10000);await assert.rejects(payOrder('buyer2',{orderId:manual.id,method:'promptpay',image:Buffer.concat([Buffer.from(slip,'base64'),Buffer.from([2])]).toString('base64')},store,config,{checkSlip:async()=>{throw new PaymentError('payment_review',true);}},notify));
assert.equal(await store.resolve(manual.id,'paid','KBANK 0123'),'paid');assert(await store.entitled('srv-manual'));
await assert.rejects(store.resolve(manual.id,'paid','again'),e=>e.code==='payment_order');await assert.rejects(store.resolve(stuck.id,'refund','x x x'),e=>e.code==='format');
await store.grant('legacy-server-01','installed before payments');assert(await store.entitled('legacy-server-01'));assert.equal((await store.checkout('anyone','legacy-server-01',10000)).status,'paid');
// Connection refused: SlipOK never saw the slip, so the customer may resend it right away.
const refused=Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});
await assert.rejects(checkSlip({amount_satang:10000,created_at:new Date()},{bytes:Buffer.from('x'),mime:'image/png'},{branch:'1',key:'k'},async()=>{throw refused;}),e=>e.code==='payment_retry'&&!e.uncertain);
const timeout=Object.assign(new Error('timeout'),{name:'TimeoutError'});
await assert.rejects(checkSlip({amount_satang:10000,created_at:new Date()},{bytes:Buffer.from('x'),mime:'image/png'},{branch:'1',key:'k'},async()=>{throw timeout;}),e=>e.code==='payment_review'&&e.uncertain);
const retryOrder=await store.checkout('buyer3','srv-retry',10000);const retrySlip=Buffer.concat([Buffer.from(slip,'base64'),Buffer.from([3])]).toString('base64');
await assert.rejects(payOrder('buyer3',{orderId:retryOrder.id,method:'promptpay',image:retrySlip},store,config,{checkSlip:async()=>{throw new PaymentError('payment_retry');}},notify),e=>e.code==='payment_retry');
assert.equal((await store.order(retryOrder.id,'buyer3')).status,'pending');
assert.equal((await payOrder('buyer3',{orderId:retryOrder.id,method:'promptpay',image:retrySlip},store,config,{checkSlip:async()=>({reference:'ref-3',amount:10000})},notify)).paid,true);
console.log('PASS payments: review alerts, operator retry/paid resolution, legacy grants, connection failures retry the same slip, timeouts stay in review');

// --- Alerts -----------------------------------------------------------------------------------------
assert.equal(await alert('x',{},{env:{}}),false);
let posted;const hook='https://discord.com/api/webhooks/123456789012345678/abc_DEF-123';
assert.equal(await alert('ติดตั้งไม่สำเร็จ',{reference:'r','@everyone':'<@1>'},{env:{WebhookAlerts:hook},fetcher:async(url,options)=>{posted={url:String(url),body:JSON.parse(options.body)};return {ok:true};}}),true);
assert.equal(posted.url,hook);assert.deepEqual(posted.body.allowed_mentions,{parse:[]});assert(!JSON.stringify(posted.body).includes('@everyone'));
assert.equal(await alert('x',{},{env:{WebhookAlerts:hook},fetcher:async()=>{throw Error('down');}}),false);
console.log('PASS alerts: optional, mention-safe, never throw');

// --- Admin accounts install free (identity from the Discord session only) ----------------------------
const { isAdmin } = await import('../web/join/lib/admin.js');
assert(isAdmin('904046392106967122',{}));
assert(!isAdmin('104046392106967122',{}));assert(!isAdmin('',{}));assert(!isAdmin(904046392106967122,{}));assert(!isAdmin('904046392106967122 ',{}));
assert(isAdmin('123456789012345678',{ADMIN_DISCORD_IDS:'111111111111111111, 123456789012345678'}));
assert(!isAdmin('123456789012345678',{ADMIN_DISCORD_IDS:'abc,123'}));
const installApi=await readFile(new URL('../web/join/api/mcsv/install.js',import.meta.url),'utf8');
assert(installApi.includes("isAdmin(s.user.id)"),'admin is decided from the session user');assert(!/isAdmin\(body/.test(installApi),'never from the request body');
console.log('PASS admin: owner ID and ADMIN_DISCORD_IDS install free; decided from the Discord session, not the request');
