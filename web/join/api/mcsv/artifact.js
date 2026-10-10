import {artifacts} from '../../lib/install-artifacts.js';
import {packArchive} from '../../lib/mcsv-install.js';
import {endweaveBySha} from '../../lib/endweave.js';
import {verifyArtifact} from '../../lib/artifact-token.js';
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).end();
 const query=new URL(req.url,'https://localhost').searchParams;
 if(!['packs','plugin','endweave'].includes(query.get('kind'))||[...query.keys()].some(k=>!['kind','behavior','resource','version','sha','exp','t'].includes(k))||new Set(query.keys()).size!==[...query.keys()].length||[...query.values()].some(v=>v.length>512))return res.status(400).end();
 if(query.get('version')!=='2.15.46')return res.status(400).end();
 // Only links minted by the installer for this transfer are honoured (see lib/artifact-token.js).
 res.setHeader('Cache-Control','private, no-store');
 if(!verifyArtifact(Object.fromEntries(query)))return res.status(403).end();
 const kind=query.get('kind');if(kind==='endweave'&&!/^[0-9a-f]{64}$/.test(query.get('sha')||''))return res.status(400).end();
 try{const bytes=kind==='endweave'?await endweaveBySha(query.get('sha')):kind==='plugin'?(await artifacts()).wheel:packArchive(await artifacts(),{behavior:query.get('behavior'),resource:query.get('resource')});res.setHeader('Content-Type','application/octet-stream');return res.status(200).send(bytes);}catch(error){return res.status(error.code==='unsafe_layout'?400:error.code==='artifact_unavailable'&&kind==='endweave'?404:503).end();}
}
