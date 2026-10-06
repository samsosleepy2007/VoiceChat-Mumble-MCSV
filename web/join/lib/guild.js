export const GUILD_ID = '1420339720277463112';
export class GuildError extends Error {
 constructor(reason,status=null,discordCode=null){super(reason);this.reason=reason;this.status=status;this.discordCode=discordCode;}
}
export function createMembershipReader({request=fetch,clock=Date.now,botToken=()=>process.env.DISCORD_BOT_TOKEN}={}) {
 const cache=new Map(),pending=new Map();
 async function lookup(accessToken,userId,bot) {
  let response;
  try{response=await request(bot?'https://discord.com/api/v10/guilds/'+GUILD_ID+'/members/'+userId:'https://discord.com/api/v10/users/@me/guilds/'+GUILD_ID+'/member',{headers:{Authorization:bot?'Bot '+bot:'Bearer '+accessToken},signal:AbortSignal.timeout(10000)});}catch{throw new GuildError('membership_unavailable');}
  let member;try{member=await response.json();}catch{throw new GuildError('membership_unavailable',response.status);}
  const code=Number.isInteger(member?.code)?member.code:null;
  if(response.status===404&&(code===10007||(!bot&&code===10004)))return null;
  if(!response.ok)throw new GuildError(response.status===429?'membership_rate_limit':response.status===401?'membership_auth_invalid':response.status===403||code===10004?'membership_access_denied':'membership_unavailable',response.status,code);
  if(!member||!Array.isArray(member.roles)||typeof member.joined_at!=='string'||(bot?member.user?.id!==userId:member.user&&member.user.id!==userId))throw new GuildError('membership_unavailable',response.status);
  return member;
 }
 return async function read(accessToken,userId,{fresh=false}={}) {
  if(!/^\d{17,20}$/.test(userId))throw new GuildError('membership_unavailable');
  const bot=botToken();
  if(!bot)return lookup(accessToken,userId,null);
  if(fresh)cache.delete(userId);
  const hit=cache.get(userId);if(!fresh&&hit&&hit.expires>clock())return hit.member;
  if(!fresh&&pending.has(userId))return pending.get(userId);
  const job=lookup(accessToken,userId,bot).then(member=>{if(member&&member.pending!==true){if(cache.size>=2000)cache.clear();cache.set(userId,{member,expires:clock()+20000});}else cache.delete(userId);return member;});
  pending.set(userId,job);try{return await job;}finally{if(pending.get(userId)===job)pending.delete(userId);}
 };
}
export const readMember=createMembershipReader();
export async function ensureMember(accessToken,userId) {
 let member=await readMember(accessToken,userId,{fresh:true});
 if(!member) {
  if(!process.env.DISCORD_BOT_TOKEN)throw new GuildError('join_unavailable');
  const response=await fetch('https://discord.com/api/v10/guilds/'+GUILD_ID+'/members/'+userId,{method:'PUT',headers:{Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({access_token:accessToken}),signal:AbortSignal.timeout(10000)});
  if(response.status!==201&&response.status!==204)throw new GuildError('join_failed',response.status);
  member=await readMember(accessToken,userId,{fresh:true});
  if(!member)throw new GuildError('membership_unavailable');
 }
 if(member.pending===true)throw new GuildError('screening');
 return member;
}
