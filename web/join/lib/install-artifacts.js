import {readFile} from 'node:fs/promises';
import {fetchArtifacts} from './mcsv-install.js';
// Bundled with the deployment (vercel.json includeFiles); fetchArtifacts still verifies each SHA-256.
const DIR=new URL('../artifacts/',import.meta.url);
async function local(url){const name=url.slice(url.lastIndexOf('/')+1);try{const bytes=await readFile(new URL(name,DIR));return {ok:true,arrayBuffer:async()=>bytes};}catch{return {ok:false};}}
let pending;
export async function artifacts(){if(!pending)pending=fetchArtifacts(local,'bundled:').catch(error=>{pending=null;throw error;});return pending;}
