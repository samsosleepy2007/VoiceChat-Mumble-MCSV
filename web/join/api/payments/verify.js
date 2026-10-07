import { randomUUID } from 'node:crypto';
import { headers,configured,session,ORIGIN } from '../../lib/auth.js';
import { readMember,GUILD_ID } from '../../lib/guild.js';
import { paymentsEnabled,payOrder,PaymentError } from '../../lib/payments.js';

export default async function handler(req,res){
 headers(res);const reference=randomUUID();
 if(req.method!=='POST')return res.status(405).json({error:'method'});
 if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'origin'});
 if(!configured()||!paymentsEnabled())return res.status(503).json({error:'payment_unavailable'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'format'});
 if(Number(req.headers['content-length']||0)>3000000)return res.status(413).json({error:'slip_format'});
 try{
  const s=await session(req,res);
  if(!s.user||!/^\d{17,20}$/.test(s.user.id)||s.guildId!==GUILD_ID||typeof s.accessToken!=='string'||s.tokenExpiresAt<=Date.now()||!Number.isFinite(s.tokenExpiresAt))return res.status(401).json({error:'login_required'});
  const member=await readMember(s.accessToken,s.user.id,{fresh:true});if(!member||member.pending){s.destroy();return res.status(401).json({error:'login_required'});}
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw new PaymentError('format');}
  if(!body||JSON.stringify(body).length>3000000)throw new PaymentError('slip_format');
  return res.status(200).json(await payOrder(s.user.id,body));
 }catch(error){const code=error instanceof PaymentError?error.code:'payment_unavailable';console.warn(JSON.stringify({event:'payment_verification_failed',reference,code}));return res.status(['payment_unavailable','payment_review','voucher_unavailable'].includes(code)?503:400).json({error:code,reference});}
}
