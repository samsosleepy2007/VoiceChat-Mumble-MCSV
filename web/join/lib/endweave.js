// Endweave (Apache-2.0, https://github.com/EndstoneMC/endweave) translates the Bedrock protocol so
// clients on a newer Minecraft can still join an Endstone server that has not updated yet.
// We follow the newest GitHub release inside one series (ENDWEAVE_SERIES, default 0.5) and trust a
// file only if it matches the SHA-256 digest GitHub publishes for that asset. A new series can drop
// older Minecraft versions, so moving to it is a deliberate env change. When GitHub cannot be reached
// we fall back to the copy bundled with the deployment.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MCSVError } from './mcsv.js';

export const ENDWEAVE_REPO='https://github.com/EndstoneMC/endweave';
const RELEASES='https://api.github.com/repos/EndstoneMC/endweave/releases?per_page=30';
// The MCSV Endstone runtime is CPython 3.12 on Linux x86_64.
const ASSET=/^endstone_endweave-(\d+)\.(\d+)\.(\d+)-cp312-abi3-manylinux_2_28_x86_64\.whl$/;
export const BUNDLED={version:[0,5,1],name:'endstone_endweave-0.5.1-cp312-abi3-manylinux_2_28_x86_64.whl',sha256:'3eac84543faaee7bc658a301b1a8ed8b4c147e4eb594065c6e278bbb47596a6c',size:993901,url:null,source:'bundled'};
const LOCAL=new URL('../artifacts/'+BUNDLED.name,import.meta.url);
const MAX=4000000,TTL=3600000,RETRY=300000;
function fail(code){throw new MCSVError(code);}
function newer(a,b){for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}

export function endweaveVersion(name){const m=/^endstone_endweave-(\d+)\.(\d+)\.(\d+)-/i.exec(name||'');return m?m.slice(1).map(Number):null;}
export function endweaveSeries(env=process.env){const m=/^(\d+)\.(\d+)$/.exec(String(env.ENDWEAVE_SERIES||'').trim());return m?[Number(m[1]),Number(m[2])]:BUNDLED.version.slice(0,2);}
export function publicEndweave(info){return {version:info.version.join('.'),name:info.name,source:info.source,project:ENDWEAVE_REPO};}

export function pickRelease(releases,series){
 let best=null;
 for(const release of Array.isArray(releases)?releases:[]){
  if(!release||release.draft||release.prerelease)continue;
  for(const asset of Array.isArray(release.assets)?release.assets:[]){
   const m=ASSET.exec(asset?.name||''),digest=/^sha256:([0-9a-f]{64})$/.exec(asset?.digest||'');
   if(!m||!digest||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX)continue;
   if(typeof asset.browser_download_url!=='string'||!asset.browser_download_url.startsWith(ENDWEAVE_REPO+'/releases/download/'))continue;
   const version=m.slice(1).map(Number);if(version[0]!==series[0]||version[1]!==series[1])continue;
   if(!best||newer(version,best.version))best={version,name:asset.name,sha256:digest[1],size:asset.size,url:asset.browser_download_url,source:'github'};
  }
 }
 return best;
}

let cached=null;
export function resetEndweaveCache(){cached=null;blobs.clear();}
export async function latestEndweave({request=fetch,env=process.env,now=Date.now()}={}){
 if(cached&&now<cached.until)return cached.info;
 const series=endweaveSeries(env);let found=null;
 try{
  const headers={Accept:'application/vnd.github+json','User-Agent':'SleepyMumla-installer'};if(env.GITHUB_TOKEN)headers.Authorization='Bearer '+env.GITHUB_TOKEN;
  const response=await request(RELEASES,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.ok)found=pickRelease(await response.json(),series);
 }catch{}
 // Never offer something older than the bundled copy of the same series.
 const bundledInSeries=BUNDLED.version[0]===series[0]&&BUNDLED.version[1]===series[1];
 const info=found&&!(bundledInSeries&&newer(BUNDLED.version,found.version))?found:BUNDLED;
 cached={info,until:now+(found?TTL:RETRY)};
 return info;
}

const blobs=new Map();
export async function endweaveBytes(info,{request=fetch}={}){
 if(blobs.has(info.sha256))return blobs.get(info.sha256);
 let bytes;
 if(info.source==='bundled'){try{bytes=await readFile(LOCAL);}catch{fail('artifact_unavailable');}}
 else{
  let response;try{response=await request(info.url,{signal:AbortSignal.timeout(30000)});}catch{fail('artifact_unavailable');}
  if(!response.ok)fail('artifact_unavailable');
  bytes=Buffer.from(await response.arrayBuffer());
 }
 if(bytes.length>MAX||bytes.length!==info.size||createHash('sha256').update(bytes).digest('hex')!==info.sha256)fail('artifact_integrity');
 blobs.set(info.sha256,bytes);
 return bytes;
}

// The install uses the newest release; if that download fails, it installs the bundled copy instead.
export async function loadEndweave(info,options){
 try{return {info,bytes:await endweaveBytes(info,options)};}
 catch(error){if(info.source==='bundled'||error.code!=='artifact_unavailable')throw error;return {info:BUNDLED,bytes:await endweaveBytes(BUNDLED,options)};}
}

// Serves the exact file a pending install asked for, identified by its SHA-256.
export async function endweaveBySha(sha,options={}){
 if(sha===BUNDLED.sha256)return endweaveBytes(BUNDLED,options);
 const latest=await latestEndweave(options);if(latest.sha256!==sha)fail('artifact_unavailable');
 return endweaveBytes(latest,options);
}
