// Receives the plugin's "started without a valid license" notice and turns it into a Discord alert.
// Public endpoint, so it is defended in layers: blacklist short-circuit, per-IP rate limit, HMAC and
// source-IP checks to tell genuine reports from forged ones, and a permanent IP block when the same
// source fires faster than MCSV could ever restart a server (clearly scripted). Fails open on DB errors
// (it is intel, not enforcement) and never reveals internals to the caller.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { database } from './payments.js';
import { postEmbed } from './alerts.js';
import { serverRegistry } from './server-registry.js';

const SCHEMA=`CREATE TABLE IF NOT EXISTS sleepy_report_log(ip text NOT NULL,server_uuid text NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sleepy_report_log_ip ON sleepy_report_log(ip,at);
CREATE TABLE IF NOT EXISTS sleepy_report_blacklist(ip text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sleepy_rate_limits(key text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL DEFAULT 0,PRIMARY KEY(key,window_start));`;

// MCSV cannot restart a server faster than ~30s, so three reports spaced under that are a script.
const COOLDOWN_MS=30000, BURST=3, RATE={hits:12,minutes:10};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64=/^[A-Za-z0-9+/]{40,120}={0,2}$/;
// Render a plugin-sent player list into one Discord field value (≤1024 chars). Untrusted input:
// strip markdown/mention characters and cap counts and lengths.
const clean=v=>String(v==null?'':v).replace(/[@`*_~<>\\\n]/g,'').slice(0,40);
function playerList(list,max){
 if(!Array.isArray(list)||!list.length)return null;
 const lines=[];let used=0;
 for(const e of list.slice(0,max)){
  if(!e||typeof e!=='object')continue;
  const name=clean(e.name)||'(?)';const xuid=clean(e.xuid);const op=e.op===true;
  const line=`${op?'👑 ':''}${name}${xuid?' ('+xuid+')':''}`;
  if(used+line.length+1>1000){lines.push('…');break;}
  lines.push(line);used+=line.length+1;
 }
 return lines.length?lines.join('\n'):null;
}
const configured=env=>Boolean(env.PAYMENT_DATABASE_URL||env.DATABASE_URL);

function clientIP(req){
 const vercel=req.headers['x-vercel-forwarded-for'];
 const raw=(Array.isArray(vercel)?vercel[0]:vercel)||String(req.headers['x-forwarded-for']||'').split(',')[0];
 return String(raw||'').trim().slice(0,64)||'unknown';
}
function verifySig(secret,uuid,ts,sig){
 try{const expected=createHmac('sha256',secret).update(uuid+'\n'+ts).digest();const got=Buffer.from(sig,'base64');return got.length===expected.length&&timingSafeEqual(got,expected);}catch{return false;}
}

export async function pluginReport(req,res,{env=process.env,db=null,fetcher=fetch}={}){
 res.setHeader('Cache-Control','no-store');
 const done=()=>res.status(204).end();
 if(req.method!=='POST')return res.status(405).end();
 const ip=clientIP(req);
 if(!db&&!configured(env)){console.warn(JSON.stringify({event:'plugin_report_no_db'}));return done();}
 const conn=db||database();
 let schemaReady=false;
 const ensure=async()=>{if(!schemaReady){await conn.query(SCHEMA);schemaReady=true;}};
 try{
  await ensure();
  // 1. Blacklisted source: drop before any work, logging or alert.
  if((await conn.query('SELECT 1 FROM sleepy_report_blacklist WHERE ip=$1',[ip])).rowCount)return res.status(403).end();
  // 2. Size + shape. (Larger than the old 1KB: a report may now carry an online + ever-joined roster.)
  if(Number(req.headers['content-length']||0)>16384)return res.status(413).end();
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{body=null;}
  const uuid=String(body?.uuid||'').toLowerCase();
  const claimedIP=String(body?.ip||'').slice(0,64);
  const port=/^\d{1,5}$/.test(String(body?.port||''))?Number(body.port):null;
  const ts=Number(body?.ts);
  const sig=String(body?.sig||'');
  if(!UUID.test(uuid)||!Number.isSafeInteger(ts)||Math.abs(Date.now()/1000-ts)>300||!B64.test(sig))return done();
  // 3. Per-IP rate limit (shared fixed-window table).
  const limited=await conn.query(`INSERT INTO sleepy_rate_limits(key,window_start,hits) VALUES($1,date_bin(make_interval(mins=>$2),now(),'2000-01-01'),1)
   ON CONFLICT(key,window_start) DO UPDATE SET hits=sleepy_rate_limits.hits+1 RETURNING hits`,['report:'+ip,RATE.minutes]);
  if(limited.rows[0].hits>RATE.hits)return done();
  // 4. Genuine (real plugin on MCSV) vs suspicious (forged/misrouted).
  const secret=env.PLUGIN_REPORT_SECRET||'';
  const genuine=Boolean(secret)&&verifySig(secret,uuid,String(ts),sig)&&claimedIP===ip;
  // 5. Record, then detect a scripted burst from this IP.
  await conn.query('INSERT INTO sleepy_report_log(ip,server_uuid,at) VALUES($1,$2,now())',[ip,uuid]);
  const recent=await conn.query(`SELECT at FROM sleepy_report_log WHERE ip=$1 ORDER BY at DESC LIMIT $2`,[ip,BURST]);
  let scripted=false;
  if(recent.rowCount>=BURST){
   scripted=true;
   for(let i=0;i<recent.rowCount-1;i++)if(new Date(recent.rows[i].at)-new Date(recent.rows[i+1].at)>=COOLDOWN_MS){scripted=false;break;}
  }
  const known=await serverRegistry(conn).lookup(uuid);
  const owner=known?(known.user_name||'ไม่ทราบชื่อ')+(/^\d{17,20}$/.test(known.user_id||'')?' (<@'+known.user_id+'>)':''):'ยังไม่เคยติดตั้งผ่านเว็บ (อาจก๊อปไฟล์มา)';
  const serverName=known?.server_name||'ไม่ทราบ';
  const allPorts=Array.isArray(known?.ports)&&known.ports.length?known.ports.join(', '):'-';
  if(scripted){
   await conn.query('INSERT INTO sleepy_report_blacklist(ip,reason) VALUES($1,$2) ON CONFLICT(ip) DO NOTHING',[ip,'report_flood']);
   await conn.query('DELETE FROM sleepy_report_log WHERE ip=$1',[ip]);
   await postEmbed('ปลายทางถูกบล็อกถาวร (ยิง report รัวผิดปกติ)',[
    {name:'IP',value:ip},{name:'ชื่อเซิร์ฟเวอร์',value:serverName},{name:'เจ้าของ',value:owner},
    {name:'เซิร์ฟเวอร์ UUID',value:uuid},
    {name:'เหตุผล',value:`ยิง ${BURST} ครั้งเร็วกว่าคูลดาวน์ MCSV (~30 วิ) = สคริปต์`},{name:'ล้าง log',value:'ลบ log ของ IP นี้แล้ว'}
   ],{color:0xd04a4a,env,fetcher});
   return res.status(403).end();
  }
  const fields=[
   {name:'ชื่อเซิร์ฟเวอร์',value:serverName},{name:'เจ้าของ',value:owner},{name:'เซิร์ฟเวอร์ UUID',value:uuid},
   {name:'IP ต้นทาง',value:ip},{name:'พอร์ตหลัก',value:port?String(port):'-'},{name:'พอร์ตทั้งหมด',value:allPorts},
   {name:'เวอร์ชันปลั๊กอิน',value:String(body?.v||'-').slice(0,20)},{name:'เหตุผล license',value:String(body?.reason||'-').slice(0,40)},
   {name:'เวลา (ไทย)',value:new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}
  ];
  const online=playerList(body?.online,20);
  const roster=playerList(body?.roster,40);
  if(online)fields.push({name:'กำลังออนไลน์ (👑 = OP)',value:online});
  if(roster)fields.push({name:'เคยเข้าเซิร์ฟเวอร์ (ล่าสุดก่อน · 👑 = OP)',value:roster});
  if(!genuine)fields.push({name:'IP ที่อ้าง',value:claimedIP||'-'},{name:'⚠ สถานะ',value:'ลายเซ็น/ที่มาไม่ตรง — อาจไม่ได้มาจาก MCSV'});
  await postEmbed(genuine?'เซิร์ฟเปิดระบบโดยไม่มีใบอนุญาต':'ได้รับ report จากพื้นที่น่าสงสัย',fields,{color:genuine?0xef9f43:0x8a6dd0,env,fetcher});
  return done();
 }catch(error){console.warn(JSON.stringify({event:'plugin_report_failed'}));return done();}
}

