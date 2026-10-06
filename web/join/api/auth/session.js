import { headers, configured, session } from '../../lib/auth.js';
import { readMember, GUILD_ID } from '../../lib/guild.js';
export default async function handler(req,res) {
 headers(res);if(req.method!=='GET')return res.status(405).end();
 if(!configured())return res.status(200).json({user:null,configured:false});
 try {
  const s=await session(req,res);
  const valid=s.user && /^\d{17,20}$/.test(s.user.id) && typeof s.user.name==='string' && Number.isFinite(s.loggedInAt) && Date.now()-s.loggedInAt>=0 && Date.now()-s.loggedInAt<86400000 && s.guildId===GUILD_ID && typeof s.accessToken==='string' && Number.isFinite(s.tokenExpiresAt) && s.tokenExpiresAt>Date.now();
  if(!valid){s.destroy();return res.status(200).json({user:null,configured:true});}
  const member=await readMember(s.accessToken,s.user.id);
  if(!member||member.pending===true){s.destroy();return res.status(200).json({user:null,configured:true,reason:member?'screening':'membership_required'});}
  return res.status(200).json({user:{id:s.user.id,name:s.user.name,avatar:s.user.avatar},configured:true});
 }catch{return res.status(503).json({user:null,configured:true,reason:'membership_unavailable'});}
}
