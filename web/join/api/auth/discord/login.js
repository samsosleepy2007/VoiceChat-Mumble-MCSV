import { generateState, generateCodeVerifier } from 'arctic';
import { headers, configured, session, provider, safeReturn, redirect } from '../../../lib/auth.js';
export default async function handler(req,res) {
 headers(res);
 if(req.method!=='GET') return res.status(405).end();
 if(!configured()) return redirect(res,'/?auth=unavailable');
 try {
  const tx=await session(req,res,true); tx.state=generateState();tx.verifier=generateCodeVerifier();tx.created=Date.now();
  tx.returnTo=safeReturn(new URL(req.url,'https://sleepyvoice-join.vercel.app').searchParams.get('returnTo'));
  await tx.save(); redirect(res,provider().createAuthorizationURL(tx.state,tx.verifier,['identify']).toString());
 } catch { redirect(res,'/?auth=unavailable'); }
}
