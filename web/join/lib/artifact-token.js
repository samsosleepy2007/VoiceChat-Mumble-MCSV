// Short-lived signed links for /api/mcsv/artifact. The installer mints one right before MCSV fetches a
// file, so the paid plugin and addon are not downloadable by anyone who guesses the URL.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL=5*60*1000;
function secret(env){const value=env.ARTIFACT_SECRET||env.SESSION_SECRET;return typeof value==='string'&&value.length>=32?value:null;}
function canonical(params){return Object.keys(params).filter(k=>k!=='t'&&k!=='exp').sort().map(k=>k+'='+params[k]).join('&');}
function mac(key,params,exp){return createHmac('sha256',key).update('artifact-v1\n'+exp+'\n'+canonical(params)).digest('base64url');}

export function signArtifact(params,{env=process.env,now=Date.now()}={}){
 const key=secret(env);if(!key)throw Object.assign(new Error('artifact_unavailable'),{code:'artifact_unavailable'});
 const exp=String(now+TTL);return {exp,t:mac(key,params,exp)};
}

export function verifyArtifact(params,{env=process.env,now=Date.now()}={}){
 const key=secret(env),exp=params.exp,token=params.t;
 if(!key||typeof exp!=='string'||!/^\d{13}$/.test(exp)||typeof token!=='string'||token.length!==43)return false;
 const expires=Number(exp);if(expires<now||expires>now+TTL+60000)return false;
 const expected=Buffer.from(mac(key,params,exp)),actual=Buffer.from(token);
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
