import {database} from './payments.js';
export function webhookURL(env=process.env){try{const u=new URL((env.WebhookPay||env.Webhookpay||'').trim());if(u.protocol!=='https:'||!['discord.com','discordapp.com'].includes(u.hostname)||!/^\/api(?:\/v\d+)?\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)||u.username||u.password)return null;u.search='';u.hash='';return u;}catch{return null;}}
const labels={waiting:'ชำระแล้ว · รอเลือกพอร์ต',installing:'กำลังติดตั้ง',completed:'เสร็จสิ้น',failed:'ติดตั้งไม่สำเร็จ',unknown:'ไม่มีข้อมูลการติดตั้งเดิม'};
const componentLabels={pending:'รอติดตั้ง',installed:'ติดตั้งสำเร็จ',failed:'ไม่สำเร็จ',unknown:'ไม่มีข้อมูล'};
const safe=value=>String(value||'ไม่มีข้อมูล').replace(/[@`*_~<>\\]/g,'').slice(0,180);
const titleEmoji={installing:'⏳',completed:'✅',failed:'❌',waiting:'💰',unknown:'ℹ️'};
const method=o=>o.payment_method==='truemoney'?'TrueMoney Wallet':o.payment_method==='promptpay'?'PromptPay':o.payment_method==='manual'?'ให้สิทธิ์โดยแอดมิน':'—';
const dash=v=>{const t=(v==null||v==='')?'':String(v);return t||'—';};
export function paymentEmbed(o,state,extra={}){
 const id=/^\d{17,20}$/.test(o.user_id)?o.user_id:null;
 const when=new Date(o.installation_updated_at||o.paid_at||o.created_at);
 const versions=[extra.pluginVersion&&('MumbleHost '+extra.pluginVersion),extra.addonVersion&&('Item Mic '+extra.addonVersion),extra.endweaveVersion&&('Endweave '+extra.endweaveVersion)].filter(Boolean).join(' · ')||'—';
 const fields=[
  {name:'จำนวนเงิน',value:o.payment_method==='manual'?'—':(o.amount_satang/100).toFixed(2)+' บาท',inline:true},
  {name:'ช่องทาง',value:method(o),inline:true},
  {name:'ลำดับชำระสำเร็จ',value:dash(o.purchase_number),inline:true},
  {name:'เวอร์ชัน',value:versions,inline:true},
  {name:'พอร์ตเสียง',value:dash(extra.voicePort),inline:true},
  {name:'ใบอนุญาต',value:dash(extra.license),inline:true},
  {name:'เซิร์ฟเวอร์ MCSV',value:safe(o.server_name),inline:false},
  {name:'แอดออน / Plugin',value:'แอดออน: '+(componentLabels[o.addon_state]||'—')+' · Plugin: '+(componentLabels[o.plugin_state]||'—'),inline:false},
  {name:'วันเวลา (ไทย)',value:when.toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}),inline:true},
  {name:'รหัสคำสั่งซื้อ',value:dash(o.id),inline:false}
 ];
 return {username:'SleepyMumla Payments',allowed_mentions:{parse:[],users:id?[id]:[]},content:id?'<@'+id+'>':undefined,embeds:[{
  title:(titleEmoji[state]||'ℹ️')+' '+(labels[state]||labels.unknown),
  color:state==='completed'?0x39c99a:state==='failed'?0xef856c:0x449eea,
  description:'**'+safe(o.server_name)+'**'+(id?' · เจ้าของ <@'+id+'>':(o.user_name?' · '+safe(o.user_name):'')),
  fields,timestamp:when.toISOString(),
  footer:{text:state==='failed'?'รหัสปัญหา: '+safe(o.installation_error):'SleepyMumla'}
 }]};}
export function historyStore(db=database()) {return {
 async list(user,page=1){const r=await db.query(`SELECT id,amount_satang,status,payment_method,server_name,purchase_number,created_at,paid_at,installation_state,addon_state,plugin_state,installation_updated_at,installation_error FROM sleepy_payment_orders WHERE user_id=$1 AND COALESCE(paid_at,created_at)>now()-interval '7 days' ORDER BY created_at DESC,id DESC LIMIT 2 OFFSET $2`,[user,(page-1)]);return {items:r.rows.slice(0,1),hasNext:r.rows.length>1,page};},
 async begin(server,extra={}){const r=await db.query(`UPDATE sleepy_payment_orders SET installation_state='installing',addon_state='pending',plugin_state='pending',installation_attempt=installation_attempt+1,installation_updated_at=now(),installation_error=NULL WHERE id=(SELECT order_id FROM sleepy_install_entitlements WHERE server_id=$1 LIMIT 1) AND status='paid' AND installation_state<>'installing' RETURNING *`,[server]);if(!r.rows[0]){const current=await db.query(`SELECT id,installation_attempt FROM sleepy_payment_orders WHERE id=(SELECT order_id FROM sleepy_install_entitlements WHERE server_id=$1 LIMIT 1) AND status='paid' AND installation_state='installing'`,[server]);return current.rows[0]?{orderId:current.rows[0].id,attempt:current.rows[0].installation_attempt}:null;}await this.queue(r.rows[0],'installing',extra);return {orderId:r.rows[0].id,attempt:r.rows[0].installation_attempt};},
 async component(tracking,component){if(!tracking||!['addon','plugin'].includes(component))return;await db.query(`UPDATE sleepy_payment_orders SET ${component}_state='installed',installation_updated_at=now() WHERE id=$1 AND installation_attempt=$2 AND installation_state='installing'`,[tracking.orderId,tracking.attempt]);},
 async transition(tracking,state,error=null,extra={}){if(!tracking||!['completed','failed'].includes(state))return;const r=await db.query(`UPDATE sleepy_payment_orders SET installation_state=$3,installation_error=$4,installation_updated_at=now(),addon_state=CASE WHEN $3='failed' AND addon_state='pending' THEN 'failed' ELSE addon_state END,plugin_state=CASE WHEN $3='failed' AND plugin_state='pending' THEN 'failed' ELSE plugin_state END WHERE id=$1 AND installation_attempt=$2 AND installation_state='installing' RETURNING *`,[tracking.orderId,tracking.attempt,state,error]);if(r.rows[0])await this.queue(r.rows[0],state,extra);},
 // The order row often lacks the real MCSV name (null for old orders, the grant note for manual
 // grants) and the owner (manual grants store user_id='manual'). The server registry, written at
 // every web install, keeps the real name/owner keyed by server_id — merge it before the embed.
 async enrich(o){try{const r=await db.query('SELECT server_name,user_id,user_name FROM sleepy_server_registry WHERE server_id=$1',[o.server_id]);const reg=r.rows[0]||{};const isId=v=>/^\d{17,20}$/.test(String(v||''));return {...o,server_name:reg.server_name||o.server_name,user_id:isId(o.user_id)?o.user_id:(isId(reg.user_id)?reg.user_id:o.user_id),user_name:o.user_name||reg.user_name||null};}catch{return o;}},
 async queue(o,event,extra={}){const row=await this.enrich(o);await db.query(`INSERT INTO sleepy_payment_notifications(order_id,attempt,event,payload) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,attempt,event) DO NOTHING`,[o.id,o.installation_attempt,event,JSON.stringify(paymentEmbed(row,event,extra))]);},
 async flush(fetcher=fetch,env=process.env){const url=webhookURL(env);if(!url)return;const missing=await db.query(`SELECT o.* FROM sleepy_payment_orders o WHERE COALESCE(o.paid_at,o.created_at)>now()-interval '7 days' AND o.status='paid' AND o.installation_state IN ('installing','completed','failed') AND o.installation_attempt>0 AND NOT EXISTS(SELECT 1 FROM sleepy_payment_notifications n WHERE n.order_id=o.id AND n.attempt=o.installation_attempt AND n.event=o.installation_state) LIMIT 3`);for(const order of missing.rows)await this.queue(order,order.installation_state);for(let n=0;n<3;n++){const r=await db.query(`UPDATE sleepy_payment_notifications SET status='sending',tries=tries+1 WHERE id=(SELECT id FROM sleepy_payment_notifications WHERE status='pending' AND next_at<=now() AND tries<5 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);const event=r.rows[0];if(!event)return;let status='uncertain',message=null;try{url.searchParams.set('wait','true');const response=await fetcher(url.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event.payload),redirect:'error',signal:AbortSignal.timeout(4000)});if(response.ok){const data=await response.json();if(/^\d{17,20}$/.test(data.id||'')){status='sent';message=data.id;}}else status=response.status===429||response.status>=500?'pending':'failed';}catch{ /* A timeout may have delivered: don't resend an ambiguous event. */ }await db.query(`UPDATE sleepy_payment_notifications SET status=$2,message_id=$3,next_at=now()+interval '60 seconds' WHERE id=$1`,[event.id,status,message]);if(status==='sent'&&event.event==='completed'){const previous=await db.query(`SELECT message_id FROM sleepy_payment_notifications WHERE order_id=$1 AND attempt=$2 AND event='installing' AND status='sent'`,[event.order_id,event.attempt]);if(previous.rows[0]?.message_id){try{const edit=new URL(url);edit.search='';edit.pathname=edit.pathname.replace(/\/$/,'')+'/messages/'+previous.rows[0].message_id;await fetcher(edit.toString(),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...event.payload,content:null,allowed_mentions:{parse:[]}}),redirect:'error',signal:AbortSignal.timeout(4000)});}catch{}}}}}
};}
export async function safeHistory(action){try{return await action(historyStore());}catch{console.warn(JSON.stringify({event:'payment_history_update_failed'}));return null;}}
