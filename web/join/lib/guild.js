export const GUILD_ID = '1420339720277463112';
export class GuildError extends Error { constructor(reason) { super(reason);this.reason=reason; } }
export async function readMember(accessToken,userId) {
 const response=await fetch('https://discord.com/api/v10/users/@me/guilds/'+GUILD_ID+'/member',{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(10000)});
 if(response.status===404)return null;
 if(!response.ok)throw new GuildError('membership_unavailable');
 const member=await response.json();
 if(member.user?.id!==userId)throw new GuildError('membership_unavailable');
 return member;
}
export async function ensureMember(accessToken,userId) {
 let member=await readMember(accessToken,userId);
 if(!member) {
  if(!process.env.DISCORD_BOT_TOKEN)throw new GuildError('join_unavailable');
  const response=await fetch('https://discord.com/api/v10/guilds/'+GUILD_ID+'/members/'+userId,{method:'PUT',headers:{Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({access_token:accessToken}),signal:AbortSignal.timeout(10000)});
  if(response.status!==201&&response.status!==204)throw new GuildError('join_failed');
  member=await readMember(accessToken,userId);
  if(!member)throw new GuildError('membership_unavailable');
 }
 if(member.pending===true)throw new GuildError('screening');
 return member;
}
