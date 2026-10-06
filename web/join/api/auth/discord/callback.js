import { timingSafeEqual } from 'node:crypto';
import { headers, configured, session, provider, safeReturn, redirect, ORIGIN } from '../../../lib/auth.js';
export default async function handler(req,res) {
 headers(res);if(req.method!=='GET')return res.status(405).end();
 if(!configured())return redirect(res,'/?auth=unavailable');
 try {
  const q=new URL(req.url,ORIGIN).searchParams;const tx=await session(req,res,true);
  const state=q.get('state');const valid=typeof tx.state==='string' && typeof state==='string' && Buffer.byteLength(state)===Buffer.byteLength(tx.state) && timingSafeEqual(Buffer.from(state),Buffer.from(tx.state)) && typeof tx.verifier==='string' && Number.isFinite(tx.created) && Date.now()-tx.created>=0 && Date.now()-tx.created<600000;
  const returnTo=safeReturn(tx.returnTo);const verifier=tx.verifier;tx.destroy();
  if(!valid || !q.get('code') || q.has('error'))return redirect(res,'/?auth=cancelled');
  const tokens=await provider().validateAuthorizationCode(q.get('code'),verifier);
  const result=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+tokens.accessToken()},signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw Error('profile');const user=await result.json();
  if(!/^\d{17,20}$/.test(user.id)||typeof user.username!=='string')throw Error('identity');
  const login=await session(req,res);login.user={id:user.id,name:String(user.global_name||user.username).slice(0,80),avatar:typeof user.avatar==='string'&&/^[a-zA-Z0-9_]+$/.test(user.avatar)?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`:null};login.loggedInAt=Date.now();await login.save();
  redirect(res,returnTo);
 }catch{redirect(res,'/?auth=failed');}
}
