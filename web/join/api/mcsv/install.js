import { randomUUID } from 'node:crypto';
import { headers,configured,session,ORIGIN } from '../../lib/auth.js';
import { readMember,GUILD_ID } from '../../lib/guild.js';
import { MCSVError } from '../../lib/mcsv.js';
import { createMCSVClient,prepareInstallation,publicPlan,installOnMCSV,installationStatus } from '../../lib/mcsv-install.js';
import { checkoutPayment,requirePayment,consumeInstallation,PaymentError } from '../../lib/payments.js';

import {safeHistory} from '../../lib/payment-history.js';

import { artifacts } from '../../lib/install-artifacts.js';
import { latestEndweave, loadEndweave } from '../../lib/endweave.js';
import { installGuard,GuardError } from '../../lib/install-guard.js';
import { alert } from '../../lib/alerts.js';
async function consumeExisting(server,reference){try{await consumeInstallation(server);}catch{console.warn(JSON.stringify({event:'existing_installation_grant_pending',reference}));}}
// Files on the server prove nothing (anyone can upload a file named like our plugin). Only a license this
// website signed for this exact server, or a payment record for it, lets an install skip checkout.
const licensed=plan=>plan.installation?.parts?.license==='valid';
export default async function handler(req,res){
 headers(res);
 if(req.method!=='POST')return res.status(405).json({error:'method'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'origin'});
 if(!configured())return res.status(503).json({error:'auth_unavailable'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'format'});
 if(Number(req.headers['content-length']||0)>4096)return res.status(413).json({error:'format'});
 const reference=randomUUID();let stage='discord_membership',tracking=null,userId=null,action=null,serverName=null;
 try{
  const s=await session(req,res);
  if(!s.user||!/^\d{17,20}$/.test(s.user.id)||s.guildId!==GUILD_ID||typeof s.accessToken!=='string'||!Number.isFinite(s.tokenExpiresAt)||s.tokenExpiresAt<=Date.now())return res.status(401).json({error:'login_required'});
  userId=s.user.id;const member=await readMember(s.accessToken,s.user.id,{fresh:true});if(!member||member.pending===true){s.destroy();return res.status(401).json({error:'login_required'});}
  stage='request_body';const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||!['prepare','install','status'].includes(body.action)||JSON.stringify(body).length>4096)return res.status(400).json({error:'format'});
  action=body.action;const guard=installGuard();stage='rate_limit';await guard.limit(s.user.id,action);
  stage='prepare';const client=createMCSVClient(body.apiKey);
  if(body.action==='prepare'){
   const plan=publicPlan(await prepareInstallation(client,{endweave:await latestEndweave()}));
   if(plan.compatible&&plan.installAllowed){stage='payment';if(licensed(plan)){await consumeExisting(plan.server.id,reference);plan.payment={required:false,reason:'licensed'};}else plan.payment=await checkoutPayment(s.user.id,plan.server.id,plan.server.name,s.user.name);}
   return res.status(200).json(plan);
  }
  if(body.action==='status'){tracking=s.installPending?.paymentTracking||null;const result=await installationStatus(client,s.installPending);if(result.ready)await safeHistory(h=>h.transition(s.user.id,tracking,'completed'));await safeHistory(h=>h.flush());return res.status(200).json(result);}
  if(body.confirm!==true||typeof body.serverId!=='string'||typeof body.world!=='string'||!Number.isInteger(body.voicePort))return res.status(400).json({error:'format'});
  stage='lock';const release=await guard.lock(body.serverId);
  try{
   let usedPayment=false;stage='install';const endweave=await latestEndweave();
   const result=await installOnMCSV(client,body,async()=>({...await artifacts(),endweave:await loadEndweave(endweave),transferOrigin:ORIGIN}),async fresh=>{stage='payment';serverName=fresh.server.name;if(!licensed(fresh)){await requirePayment(fresh.server.id);usedPayment=true;}tracking=await safeHistory(h=>h.begin(s.user.id,fresh.server.id));await safeHistory(h=>h.flush());stage='install';return true;},async component=>{await safeHistory(h=>h.component(s.user.id,tracking,component));},{endweave});
   if(usedPayment)await consumeInstallation(result.server.id);else await consumeExisting(result.server.id,reference);s.installPending={serverId:result.server.id,host:result.server.host,voicePort:result.voicePort,action:result.powerAction,previousUptime:result.previousUptime,requestedAt:Date.now(),paymentTracking:tracking};await s.save();return res.status(200).json(result);
  }finally{await release();}
 }catch(error){const code=error instanceof MCSVError||error instanceof PaymentError||error instanceof GuardError?error.code:stage==='request_body'?'format':stage==='payment'?'payment_unavailable':'auth_check_unavailable';const partial=error.partial===true;
  if(tracking&&userId&&(action==='install'||['voice_failed','status_expired'].includes(code))){await safeHistory(h=>h.transition(userId,tracking,'failed',code));await safeHistory(h=>h.flush());}
  console.warn(JSON.stringify({event:'mcsv_install_failed',reference,stage:error.stage||stage,code,partial,operation:error.operation||null,upstreamStatus:error instanceof MCSVError?error.status:null}));
  if(action==='install'&&!['busy','rate_limit','payment_required','reinstall_confirmation','server_running','invalid_port','permission','server_changed','format','invalid_key'].includes(code))await alert('ติดตั้งไม่สำเร็จ',{reference,server:serverName||'-',code,stage:error.stage||stage,partial:partial?'มีไฟล์บางส่วนแล้ว':'ยังไม่เปลี่ยนไฟล์'});
  return res.status(code==='permission'?403:code==='rate_limit'?429:['invalid_key','format','rejected','invalid_port'].includes(code)?400:['server_running','busy','server_changed','existing_version','existing_plugin','duplicate_pack','newer_version','reinstall_confirmation'].includes(code)?409:503).json({error:code,reference,partial});
 }
}
