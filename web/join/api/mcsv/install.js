import { randomUUID } from 'node:crypto';
import { headers,configured,session,ORIGIN } from '../../lib/auth.js';
import { readMember,GUILD_ID } from '../../lib/guild.js';
import { MCSVError } from '../../lib/mcsv.js';
import { createMCSVClient,prepareInstallation,publicPlan,installOnMCSV,fetchArtifacts,installationStatus } from '../../lib/mcsv-install.js';

const RELEASE='https://github.com/samsosleepy2007/VoiceChat-Mumble-MCSV/releases/download/sleepymumla-v0.6.1/';
let artifactPromise;
async function artifacts(){if(!artifactPromise)artifactPromise=fetchArtifacts(fetch,RELEASE).catch(error=>{artifactPromise=null;throw error;});return artifactPromise;}
export default async function handler(req,res){
 headers(res);
 if(req.method!=='POST')return res.status(405).json({error:'method'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'origin'});
 if(!configured())return res.status(503).json({error:'auth_unavailable'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'format'});
 if(Number(req.headers['content-length']||0)>4096)return res.status(413).json({error:'format'});
 const reference=randomUUID();let stage='discord_membership';
 try{
  const s=await session(req,res);
  if(!s.user||!/^\d{17,20}$/.test(s.user.id)||s.guildId!==GUILD_ID||typeof s.accessToken!=='string'||!Number.isFinite(s.tokenExpiresAt)||s.tokenExpiresAt<=Date.now())return res.status(401).json({error:'login_required'});
  const member=await readMember(s.accessToken,s.user.id,{fresh:true});if(!member||member.pending===true){s.destroy();return res.status(401).json({error:'login_required'});}
  stage='request_body';const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||!['prepare','install','status'].includes(body.action)||JSON.stringify(body).length>4096)return res.status(400).json({error:'format'});
  stage='prepare';const client=createMCSVClient(body.apiKey);
  if(body.action==='prepare')return res.status(200).json(publicPlan(await prepareInstallation(client)));
  if(body.action==='status')return res.status(200).json(await installationStatus(client,s.installPending));
  if(body.confirm!==true||typeof body.serverId!=='string'||typeof body.world!=='string'||!Number.isInteger(body.voicePort))return res.status(400).json({error:'format'});
  stage='install';const result=await installOnMCSV(client,body,artifacts);s.installPending={serverId:result.server.id,host:result.server.host,voicePort:result.voicePort,action:result.powerAction,previousUptime:result.previousUptime,requestedAt:Date.now()};await s.save();return res.status(200).json(result);
 }catch(error){const code=error instanceof MCSVError?error.code:stage==='request_body'?'format':'auth_check_unavailable';const partial=error.partial===true;
  console.warn(JSON.stringify({event:'mcsv_install_failed',reference,stage:error.stage||stage,code,partial,upstreamStatus:error instanceof MCSVError?error.status:null}));
  return res.status(code==='permission'?403:['invalid_key','format','rejected','invalid_port'].includes(code)?400:['server_running','busy','server_changed','existing_version','existing_plugin','duplicate_pack'].includes(code)?409:503).json({error:code,reference,partial,stage:error.stage||stage});
 }
}
