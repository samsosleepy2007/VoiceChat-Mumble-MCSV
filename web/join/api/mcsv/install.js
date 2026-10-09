import { randomUUID } from 'node:crypto';
import { headers,configured,session,ORIGIN } from '../../lib/auth.js';
import { readMember,GUILD_ID } from '../../lib/guild.js';
import { MCSVError } from '../../lib/mcsv.js';
import { createMCSVClient,prepareInstallation,publicPlan,installOnMCSV,installationStatus } from '../../lib/mcsv-install.js';
import { checkoutPayment,requirePayment,consumeInstallation,PaymentError } from '../../lib/payments.js';

import {safeHistory} from '../../lib/payment-history.js';

import { artifacts } from '../../lib/install-artifacts.js';
import { latestEndweave, loadEndweave } from '../../lib/endweave.js';
async function consumeExisting(user,server,reference){try{await consumeInstallation(user,server);}catch{console.warn(JSON.stringify({event:'existing_installation_grant_pending',reference}));}}
export default async function handler(req,res){
 headers(res);
 if(req.method!=='POST')return res.status(405).json({error:'method'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'origin'});
 if(!configured())return res.status(503).json({error:'auth_unavailable'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'format'});
 if(Number(req.headers['content-length']||0)>4096)return res.status(413).json({error:'format'});
 const reference=randomUUID();let stage='discord_membership',tracking=null,userId=null,action=null;
 try{
  const s=await session(req,res);
  if(!s.user||!/^\d{17,20}$/.test(s.user.id)||s.guildId!==GUILD_ID||typeof s.accessToken!=='string'||!Number.isFinite(s.tokenExpiresAt)||s.tokenExpiresAt<=Date.now())return res.status(401).json({error:'login_required'});
  userId=s.user.id;const member=await readMember(s.accessToken,s.user.id,{fresh:true});if(!member||member.pending===true){s.destroy();return res.status(401).json({error:'login_required'});}
  stage='request_body';const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||!['prepare','install','status'].includes(body.action)||JSON.stringify(body).length>4096)return res.status(400).json({error:'format'});
  action=body.action;stage='prepare';const client=createMCSVClient(body.apiKey);
  if(body.action==='prepare'){
   const plan=publicPlan(await prepareInstallation(client,{endweave:await latestEndweave()}));
   if(plan.compatible&&plan.installAllowed){stage='payment';if(plan.installation.present){await consumeExisting(s.user.id,plan.server.id,reference);plan.payment={required:false,reason:'installed'};}else plan.payment=await checkoutPayment(s.user.id,plan.server.id,plan.server.name,s.user.name);}
   return res.status(200).json(plan);
  }
  if(body.action==='status'){tracking=s.installPending?.paymentTracking||null;const result=await installationStatus(client,s.installPending);if(result.ready)await safeHistory(h=>h.transition(s.user.id,tracking,'completed'));await safeHistory(h=>h.flush());return res.status(200).json(result);}
  if(body.confirm!==true||typeof body.serverId!=='string'||typeof body.world!=='string'||!Number.isInteger(body.voicePort))return res.status(400).json({error:'format'});
  let usedPayment=false;stage='install';const endweave=await latestEndweave();const result=await installOnMCSV(client,body,async()=>({...await artifacts(),endweave:await loadEndweave(endweave),transferOrigin:ORIGIN}),async fresh=>{stage='payment';if(!fresh.installation.present){await requirePayment(s.user.id,fresh.server.id);usedPayment=true;}tracking=await safeHistory(h=>h.begin(s.user.id,fresh.server.id));await safeHistory(h=>h.flush());stage='install';},async component=>{await safeHistory(h=>h.component(s.user.id,tracking,component));},{endweave});if(usedPayment)await consumeInstallation(s.user.id,result.server.id);else await consumeExisting(s.user.id,result.server.id,reference);s.installPending={serverId:result.server.id,host:result.server.host,voicePort:result.voicePort,action:result.powerAction,previousUptime:result.previousUptime,requestedAt:Date.now(),paymentTracking:tracking};await s.save();return res.status(200).json(result);
 }catch(error){const code=error instanceof MCSVError||error instanceof PaymentError?error.code:stage==='request_body'?'format':stage==='payment'?'payment_unavailable':'auth_check_unavailable';const partial=error.partial===true;
  if(tracking&&userId&&(action==='install'||['voice_failed','status_expired'].includes(code))){await safeHistory(h=>h.transition(userId,tracking,'failed',code));await safeHistory(h=>h.flush());}
  console.warn(JSON.stringify({event:'mcsv_install_failed',reference,stage:error.stage||stage,code,partial,operation:error.operation||null,upstreamStatus:error instanceof MCSVError?error.status:null}));
  return res.status(code==='permission'?403:['invalid_key','format','rejected','invalid_port'].includes(code)?400:['server_running','busy','server_changed','existing_version','existing_plugin','duplicate_pack','newer_version','reinstall_confirmation'].includes(code)?409:503).json({error:code,reference,partial,stage:error.stage||stage});
 }
}
