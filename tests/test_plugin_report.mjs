import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PGlite } from '../web/join/node_modules/@electric-sql/pglite/dist/index.js';
import { pluginReport } from '../web/join/lib/plugin-report.js';

const SECRET='test-report-secret-0123456789';
const UUID='5fb3cecf-9cb9-428b-9053-9fb65a47b5df';
const pg=new PGlite();
// node-postgres runs the multi-statement SCHEMA (no params) via the simple protocol; PGlite needs exec().
const db={query:async(sql,args)=>{if(!args){await pg.exec(sql);return {rows:[],rowCount:0};}const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}};
// Seed an order so owner enrichment can resolve by the 8-hex identifier.
await pg.exec(`CREATE TABLE sleepy_payment_orders(id text,server_id text,user_name text,user_id text,paid_at timestamptz,created_at timestamptz DEFAULT now())`);
await db.query(`INSERT INTO sleepy_payment_orders(id,server_id,user_name,user_id,paid_at) VALUES('o1','5fb3cecf','SleepyOwner','904046392106967122',now())`,[]);

let embeds=[];const fetcher=async(url,opt)=>{embeds.push(JSON.parse(opt.body));return {ok:true};};
const env={PLUGIN_REPORT_SECRET:SECRET,WebhookAlerts:'https://discord.com/api/webhooks/123456789012345678/abcDEF_token-1'};
function sign(uuid,ts){return createHmac('sha256',SECRET).update(uuid+'\n'+ts).digest('base64');}
function res(){const r={code:0,ended:false,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},end(){this.ended=true;return this;},json(){this.ended=true;return this;}};return r;}
async function post(body,{ip='1.2.3.4',headers={}}={}){const r=res();await pluginReport({method:'POST',headers:{'x-vercel-forwarded-for':ip,'content-length':String(JSON.stringify(body).length),...headers},body},r,{env,db,fetcher});return r;}

// Genuine: valid HMAC + source IP matches the claimed IP.
let ts=Math.floor(Date.now()/1000);
let r=await post({uuid:UUID,ip:'1.2.3.4',port:'10459',ts,v:'0.6.3',reason:'missing',sig:sign(UUID,String(ts))},{ip:'1.2.3.4'});
assert.equal(r.code,204);assert.equal(embeds.length,1);
assert.match(embeds[0].embeds[0].title,/ไม่มีใบอนุญาต/);
const owner=embeds[0].embeds[0].fields.find(f=>f.name==='เจ้าของ').value;
assert.match(owner,/SleepyOwner/);assert.match(owner,/904046392106967122/);
assert(!embeds[0].embeds[0].fields.some(f=>f.name==='⚠ สถานะ'),'genuine has no suspicious flag');

// Suspicious: no signature.
embeds=[];ts=Math.floor(Date.now()/1000);
r=await post({uuid:UUID,ip:'1.0.0.2',port:'10459',ts,v:'0.6.3',reason:'missing',sig:'AAAA'+'B'.repeat(40)},{ip:'1.0.0.2'});
assert.equal(embeds.length,1);assert.match(embeds[0].embeds[0].title,/น่าสงสัย/);
assert(embeds[0].embeds[0].fields.some(f=>f.name==='⚠ สถานะ'));

// Suspicious: valid signature but the source IP is not the one the plugin claims.
embeds=[];ts=Math.floor(Date.now()/1000);
r=await post({uuid:UUID,ip:'9.9.9.9',port:'10459',ts,v:'0.6.3',reason:'missing',sig:sign(UUID,String(ts))},{ip:'1.2.3.4'});
assert.match(embeds[0].embeds[0].title,/น่าสงสัย/);

// Malformed (bad uuid / old ts) → 204, no embed.
embeds=[];
assert.equal((await post({uuid:'nope',ts:Math.floor(Date.now()/1000),sig:'x'.repeat(44)},{ip:'1.0.0.3'})).code,204);
assert.equal((await post({uuid:UUID,ts:1,sig:sign(UUID,'1')},{ip:'1.0.0.4'})).code,204);
assert.equal(embeds.length,0);

// Scripted burst: 3 reports from one IP faster than the MCSV restart floor → permanent block + purge.
embeds=[];const flood='7.7.7.7';
for(let i=0;i<3;i++){const t=Math.floor(Date.now()/1000);await post({uuid:UUID,ip:flood,port:'1',ts:t,v:'0.6.3',reason:'missing',sig:sign(UUID,String(t))},{ip:flood});}
assert(embeds.some(e=>/บล็อกถาวร/.test(e.embeds[0].title)),'block embed sent');
assert.equal((await db.query('SELECT 1 FROM sleepy_report_blacklist WHERE ip=$1',[flood])).rowCount,1);
assert.equal((await db.query('SELECT 1 FROM sleepy_report_log WHERE ip=$1',[flood])).rowCount,0,'junk log purged');
// 4th hit from a blocked IP: 403, no embed, no log.
embeds=[];const t=Math.floor(Date.now()/1000);
r=await post({uuid:UUID,ip:flood,port:'1',ts:t,v:'0.6.3',reason:'missing',sig:sign(UUID,String(t))},{ip:flood});
assert.equal(r.code,403);assert.equal(embeds.length,0);

// Slow, spaced reports (older than the cooldown) are NOT blocked.
await pg.query(`INSERT INTO sleepy_report_log(ip,server_uuid,at) VALUES('8.8.8.8',$1,now()-interval '2 minutes'),('8.8.8.8',$1,now()-interval '1 minute')`,[UUID]);
embeds=[];ts=Math.floor(Date.now()/1000);
r=await post({uuid:UUID,ip:'8.8.8.8',port:'1',ts,v:'0.6.3',reason:'missing',sig:sign(UUID,String(ts))},{ip:'8.8.8.8'});
assert.equal((await db.query('SELECT 1 FROM sleepy_report_blacklist WHERE ip=$1',['8.8.8.8'])).rowCount,0,'spaced reports are fine');

// Per-IP rate limit: beyond the window cap, silently dropped (204, no embed).
embeds=[];const spam='3.3.3.3';
for(let i=0;i<13;i++){const t2=Math.floor(Date.now()/1000);await post({uuid:UUID,ip:spam,port:'1',ts:t2,v:'0.6.3',reason:'x',sig:'z'.repeat(44)},{ip:spam});}
const before=embeds.length;const t3=Math.floor(Date.now()/1000);
await post({uuid:UUID,ip:spam,port:'1',ts:t3,v:'0.6.3',reason:'x',sig:'z'.repeat(44)},{ip:spam});
assert.equal(embeds.length,before,'rate-limited report produced no further embed');

// GET is rejected; DB down fails open (204, never throws).
assert.equal((await (async()=>{const r2=res();await pluginReport({method:'GET',headers:{}},r2,{env,db,fetcher});return r2;})()).code,405);
const downRes=res();await pluginReport({method:'POST',headers:{'x-vercel-forwarded-for':'1.1.1.1'},body:{uuid:UUID,ts,sig:'x'}},downRes,{env,db:{query:async()=>{throw new Error('db down');}},fetcher});
assert.equal(downRes.code,204);

console.log('PASS plugin-report: genuine vs suspicious (sig+IP), malformed dropped, scripted burst permanently blocked and log purged, spaced reports allowed, per-IP rate limit, owner enrichment, GET rejected, DB failure fails open');
