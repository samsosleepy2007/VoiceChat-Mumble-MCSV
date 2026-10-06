import { headers,configured,session,ORIGIN } from '../../lib/auth.js';
import { readMember,GUILD_ID } from '../../lib/guild.js';
import { checkMCSV,MCSVError } from '../../lib/mcsv.js';
export default async function handler(req,res){
 headers(res);if(req.method!=='POST')return res.status(405).json({error:'method'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'origin'});
 if(!configured())return res.status(503).json({error:'auth_unavailable'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'format'});
 if(Number(req.headers['content-length']||0)>4096)return res.status(413).json({error:'format'});
 try{
  const s=await session(req,res);
  if(!s.user||!/^\d{17,20}$/.test(s.user.id)||s.guildId!==GUILD_ID||typeof s.accessToken!=='string'||!Number.isFinite(s.tokenExpiresAt)||s.tokenExpiresAt<=Date.now())return res.status(401).json({error:'login_required'});
  const member=await readMember(s.accessToken,s.user.id);if(!member||member.pending===true){s.destroy();return res.status(401).json({error:'login_required'});}
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  const result=await checkMCSV(body?.apiKey);return res.status(200).json(result);
 }catch(error){const code=error instanceof MCSVError?error.code:'unavailable';return res.status(code==='invalid_key'?400:code==='permission'?403:503).json({error:code});}
}
