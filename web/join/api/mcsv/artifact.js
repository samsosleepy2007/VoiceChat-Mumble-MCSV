import {artifacts} from '../../lib/install-artifacts.js';
import {packArchive} from '../../lib/mcsv-install.js';
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).end();
 const query=new URL(req.url,'https://localhost').searchParams;
 if(!['packs','plugin'].includes(query.get('kind'))||[...query.keys()].some(k=>!['kind','behavior','resource'].includes(k))||[...query.values()].some(v=>v.length>512))return res.status(400).end();
 try{const source=await artifacts();const bytes=query.get('kind')==='plugin'?source.wheel:packArchive(source,{behavior:query.get('behavior'),resource:query.get('resource')});res.setHeader('Content-Type','application/octet-stream');res.setHeader('Cache-Control','public, max-age=3600');return res.status(200).send(bytes);}catch(error){return res.status(error.code==='unsafe_layout'?400:503).end();}
}
