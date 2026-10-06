import { createHash,randomUUID } from 'node:crypto';
import { unzipSync,zipSync } from 'fflate';
import { MCSVError } from './mcsv.js';

export const WHEEL='endstone_mumble_host-0.5.5-py3-none-any.whl';
export const PACKS=[{type:'behavior',uuid:'b6411120-cc4e-44a9-b28d-f43b10cafd86',folder:'SleepyMumla_BP'},{type:'resource',uuid:'cb345edb-6e6c-49ac-9950-e2ae07bda214',folder:'SleepyMumla_RP'}];
const VERSION=[2,15,39];
const REQUIRED=['server_overview','files_list','files_read','files_read_many','files_read_base64','files_upload_base64','files_decompress','files_write','files_edit','files_compress'];
const validName=name=>typeof name==='string'&&name.length>0&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f]/.test(name);
function fail(code){throw new MCSVError(code);}
export function createMCSVClient(key,request=fetch){
 if(typeof key!=='string'||key.length>512||!/^mcsv_[A-Za-z0-9_-]{8,}$/.test(key))fail('invalid_key');
 async function call(name,args={},catalog=false){
  let response;
  try{response=await request('https://api.mcsv.me/api/v1/tools'+(catalog?'':'/'+name),{method:catalog?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(catalog?{}:{body:JSON.stringify(args)}),signal:AbortSignal.timeout(30000)});}catch(error){throw new MCSVError(['TimeoutError','AbortError'].includes(error?.name)?'timeout':'unavailable');}
  const code={400:'rejected',401:'invalid_key',403:'permission',404:'endpoint',409:'installing',410:'invalid_key',429:'rate_limit'}[response.status];
  if(!response.ok)throw new MCSVError(code||'upstream',response.status);
  let data;try{data=await response.json();}catch{fail('invalid_response');}
  if(data.ok!==true||(!catalog&&(!data.result||data.result.error||data.result.success===false||data.result.denied)))fail('rejected');
  return catalog?data:data.result;
 }
 return {call,catalog:()=>call('',{},true)};
}
async function listing(client,path){const data=await client.call('files_list',{directory:path});if(!Array.isArray(data.files)||data.truncated)fail('unverified');if(data.files.some(f=>!validName(f.name)||f.is_symlink))fail('unsafe_layout');return data.files;}
async function read(client,path){const data=await client.call('files_read',{path});if(typeof data.content!=='string'||data.truncated)fail('unverified');return data.content;}
export function mergePacks(text,uuid){let data;try{data=JSON.parse(text);}catch{fail('invalid_pack_list');}if(!Array.isArray(data)||data.some(p=>!p||typeof p.pack_id!=='string'||!Array.isArray(p.version)))fail('invalid_pack_list');const other=data.filter(p=>p.pack_id.toLowerCase()!==uuid);const prior=data.find(p=>p.pack_id.toLowerCase()===uuid);other.push({...prior,pack_id:uuid,version:VERSION});return JSON.stringify(other,null,2)+'\n';}
export function configEdit(text,port){
 const sections=[...text.matchAll(/^\s*\[mumble\][^\S\r\n]*(?:#.*)?$/gm)];if(sections.length>1)fail('invalid_config');
 if(!sections.length)return {old_string:text,new_string:text+'\n[mumble]\nport = '+port+'\nusers = 20\n'};
 const start=sections[0].index,end=text.slice(start+sections[0][0].length).search(/^\s*\[/m);const section=text.slice(start,end<0?undefined:start+sections[0][0].length+end);
 const lines=[...section.matchAll(/^[ \t]*port[ \t]*=[^\r\n]*/gm)];if(lines.length>1)fail('invalid_config');
 if(lines.length){if(!/^[ \t]*port[ \t]*=[ \t]*\d+[ \t]*(?:#.*)?$/.test(lines[0][0]))fail('invalid_config');const old=lines[0][0];return {old_string:section,new_string:section.replace(old,old.replace(/(=[ \t]*)\d+/,'$1'+port))};}
 return {old_string:section,new_string:section.replace(sections[0][0],sections[0][0]+'\nport = '+port)};
}
async function findExisting(client,root,worldFiles,world){
 const roots=[];
 for(const pack of PACKS){
  for(const dir of [pack.type+'_packs','development_'+pack.type+'_packs'])if(root.some(f=>f.name===dir&&!f.is_file))roots.push('/'+dir);
  if(worldFiles.some(f=>f.name===pack.type+'_packs'&&!f.is_file))roots.push('/worlds/'+world+'/'+pack.type+'_packs');
 }
 const paths=[];
 for(const dir of roots)for(const f of await listing(client,dir)){const target=PACKS.find(p=>dir==='/'+p.type+'_packs'&&f.name.toLowerCase()===p.folder.toLowerCase());if(target&&(f.name!==target.folder||f.is_file))fail('unsafe_layout');if(!f.is_file)paths.push(dir+'/'+f.name+'/manifest.json');}
 if(paths.length>400)fail('unsafe_layout');
 const found={};const reserved=new Map(PACKS.map(p=>['/'+p.type+'_packs/'+p.folder+'/manifest.json',p.uuid]));
 for(let i=0;i<paths.length;i+=25){
  const data=await client.call('files_read_many',{paths:paths.slice(i,i+25)});if(!Array.isArray(data.files)||data.files.length!==paths.slice(i,i+25).length)fail('unverified');
  for(const file of data.files){
   if(file.denied)fail('permission');if(file.truncated)fail('unverified');
   if(typeof file.content!=='string'){if(reserved.has('/'+file.path.replace(/^\//,'')))fail('unsafe_layout');if(file.error&&!/not found|ไม่พบ|ไม่มี|no such/i.test(file.error))fail('unverified');continue;}
   let manifest;try{manifest=JSON.parse(file.content);}catch{fail('invalid_pack_list');}
   const reservedUUID=reserved.get('/'+file.path.replace(/^\//,''));if(reservedUUID&&manifest.header?.uuid?.toLowerCase()!==reservedUUID)fail('unsafe_layout');const pack=PACKS.find(p=>p.uuid===manifest.header?.uuid?.toLowerCase());if(!pack)continue;
   if(found[pack.type])fail('duplicate_pack');
   if(JSON.stringify(manifest.header.version)!==JSON.stringify(VERSION))fail('existing_version');
   found[pack.type]=true;
  }
 }
 return found;
}
export async function prepareInstallation(client){
 const overview=await client.call('server_overview');const info=overview.info;
 if(!info||typeof info.id!=='string'||typeof info.game!=='string'||typeof info.server_type!=='string')fail('unverified');
 const server={id:info.id,name:typeof info.name==='string'?info.name.slice(0,100):'MCSV',game:info.game,serverType:info.server_type};
 if(info.game!=='minecraft-bedrock'||info.server_type!=='endstone')return {compatible:false,server};
 const catalog=await client.catalog();if(!Array.isArray(catalog.tools))fail('unverified');
 const allowed=name=>catalog.tools.some(t=>t.name===name&&t.allowed===true&&t.applicable!==false);
 const missingTools=REQUIRED.filter(name=>!allowed(name));
 if(missingTools.length)return {compatible:true,server,installAllowed:false,missingTools};
 if(info.status!=='active'||overview.runtime?.is_suspended)fail('server_inactive');
 const root=await listing(client,'/');
 if(!root.some(f=>f.name==='server.properties'&&f.is_file)||!root.some(f=>f.name==='worlds'&&!f.is_file))fail('unsafe_layout');
 const properties=await read(client,'/server.properties');const names=[...properties.matchAll(/^level-name[ \t]*=[ \t]*(.*)$/gm)];
 const world=names.length===1?names[0][1].trim():'';if(!validName(world))fail('unsafe_layout');
 const worlds=await listing(client,'/worlds');if(!worlds.some(f=>f.name===world&&!f.is_file))fail('world_missing');
 const worldFiles=await listing(client,'/worlds/'+world);
 const ports=Array.isArray(info.ports)?[...new Set(info.ports.filter(p=>Number.isInteger(p)&&p>1024&&p<=65535&&p!==info.port&&p!==47855))]:[];
 if(!ports.length)fail('no_voice_port');
 const existing=await findExisting(client,root,worldFiles,world);
 const packLists={};for(const pack of PACKS){const filename='world_'+pack.type+'_packs.json';const exists=worldFiles.some(f=>f.name===filename&&f.is_file);const content=exists?await read(client,'/worlds/'+world+'/'+filename):'[]';mergePacks(content,pack.uuid);packLists[pack.type]={exists,content,path:'/worlds/'+world+'/'+filename};}
 let config=null;const pluginFolder=root.some(f=>f.name==='plugins'&&!f.is_file);const pluginFiles=pluginFolder?await listing(client,'/plugins'):[];
 if(pluginFiles.some(f=>f.is_file&&/^endstone_mumble_host-.*\.whl$/i.test(f.name)&&f.name!==WHEEL))fail('existing_plugin');
 if(pluginFiles.some(f=>f.name==='mumble_host'&&!f.is_file)){const entries=await listing(client,'/plugins/mumble_host');if(entries.some(f=>f.name==='config.toml'&&f.is_file)){config=await read(client,'/plugins/mumble_host/config.toml');configEdit(config,ports[0]);}}
 const voicePort=ports.includes(18655)?18655:ports[0];
 return {compatible:true,server,installAllowed:true,world,ports,voicePort,state:overview.runtime?.current_state||'unknown',canStart:allowed('power_action'),internal:{existing,packLists,config,root,pluginFiles}};
}
export function publicPlan(plan){const {internal,...publicData}=plan;return publicData;}
export async function fetchArtifacts(request,release){
 const definitions=[{name:WHEEL,hash:'9fef76a0b80ddf547582d388beb7b3aa12ba738761c5347e68c6afbdd39c57c4'},{name:'VC_Mumble_ItemMic_v2.15.39_MicFix.mcaddon',hash:'6472576d7f019ee25547d0908b8c7fd29617b37c579e9a75a055eae422b4a51b'}];
 const bytes=[];for(const item of definitions){let response;try{response=await request(release+item.name,{signal:AbortSignal.timeout(30000)});}catch{fail('artifact_unavailable');}if(!response.ok)fail('artifact_unavailable');const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>4000000||createHash('sha256').update(buffer).digest('hex')!==item.hash)fail('artifact_integrity');bytes.push(buffer);}
 const addon=unzipSync(bytes[1]);const packs={};for(const pack of PACKS){const entry=Object.keys(addon).find(n=>n.includes('_'+(pack.type==='behavior'?'BP':'RP')+'_')&&n.endsWith('.mcpack'));if(!entry)fail('artifact_integrity');const files=unzipSync(addon[entry]);const manifest=JSON.parse(Buffer.from(files['manifest.json']).toString());if(manifest.header.uuid!==pack.uuid||JSON.stringify(manifest.header.version)!==JSON.stringify(VERSION))fail('artifact_integrity');if(Object.keys(files).some(n=>n.startsWith('/')||n.includes('\\')||n.split('/').some(p=>p==='..'||p==='.'||!p)))fail('artifact_integrity');packs[pack.type]=files;}
 return {wheel:bytes[0],packs};
}
const active=new Set();
export async function installOnMCSV(client,body,loadArtifacts){
 const plan=await prepareInstallation(client);if(!plan.compatible)fail('incompatible');if(!plan.installAllowed)fail('permission');
 if(plan.server.id!==body.serverId||plan.world!==body.world)fail('server_changed');
 if(plan.state!=='offline')fail('server_running');
 if(!plan.ports.includes(body.voicePort))fail('invalid_port');
 if(body.start===true&&!plan.canStart)fail('permission');
 if(active.has(plan.server.id))fail('busy');active.add(plan.server.id);
 let stage='download',mutated=false;
 try{
  const source=await loadArtifacts();const internal=plan.internal;
  const backupFiles=Object.values(internal.packLists).filter(p=>p.exists).map(p=>p.path.slice(1));
  if(internal.config!==null)backupFiles.push('plugins/mumble_host/config.toml');
  if(internal.pluginFiles.some(f=>f.name===WHEEL))backupFiles.push('plugins/'+WHEEL);
  const backup='SleepyMumla-backup-'+randomUUID()+'.zip';stage='backup';if(backupFiles.length)await client.call('files_compress',{root:'/',files:backupFiles,name:backup});
  // Recheck immediately before the first write. The panel must keep the server offline.
  const runtime=await client.call('server_overview');if(runtime.info?.id!==plan.server.id||runtime.runtime?.current_state!=='offline')fail('server_running');
  stage='packs';const archiveFiles={};for(const pack of PACKS)if(!internal.existing[pack.type])for(const [name,data] of Object.entries(source.packs[pack.type]))archiveFiles[pack.type+'_packs/'+pack.folder+'/'+name]=data;
  if(Object.keys(archiveFiles).length){const archive='SleepyMumla-packs-'+randomUUID()+'.zip';mutated=true;await client.call('files_upload_base64',{path:'/'+archive,content_base64:Buffer.from(zipSync(archiveFiles,{level:6})).toString('base64')});await client.call('files_decompress',{root:'/',file:archive});}
  stage='plugin';mutated=true;await client.call('files_upload_base64',{path:'/plugins/'+WHEEL,content_base64:source.wheel.toString('base64')});
  stage='config';const configPath='/plugins/mumble_host/config.toml';if(internal.config!==null){const edit=configEdit(internal.config,body.voicePort);if(edit.old_string!==edit.new_string)await client.call('files_edit',{path:configPath,edits:[edit]});}else await client.call('files_write',{path:configPath,force_new:true,content:'[tracking]\ninterval_ticks = 4\nposition_epsilon = 0.05\nrotation_epsilon = 1.0\nheartbeat_seconds = 2\n\n[mumble]\nport = '+body.voicePort+'\nusers = 20\n\n[local_state]\nhost = "127.0.0.1"\nport = 47855\nmax_queue = 4096\n\n[voice]\ndefault_range = 30\nmax_range = 60\ndefault_attenuation_level = 3\n'});
  stage='world';for(const pack of PACKS){const item=internal.packLists[pack.type],content=mergePacks(item.content,pack.uuid);if(item.exists){if(item.content!==content)await client.call('files_edit',{path:item.path,edits:[{old_string:item.content,new_string:content}]});}else await client.call('files_write',{path:item.path,content});}
  stage='verify';for(const pack of PACKS){const list=JSON.parse(await read(client,internal.packLists[pack.type].path));if(!list.some(p=>p.pack_id===pack.uuid&&JSON.stringify(p.version)===JSON.stringify(VERSION)))fail('verification_failed');if(!internal.existing[pack.type]){const manifest=JSON.parse(await read(client,'/'+pack.type+'_packs/'+pack.folder+'/manifest.json'));if(manifest.header?.uuid!==pack.uuid)fail('verification_failed');}}
  const files=await listing(client,'/plugins');if(!files.some(f=>f.name===WHEEL&&f.size===source.wheel.length))fail('verification_failed');
  const uploaded=await client.call('files_read_base64',{path:'/plugins/'+WHEEL});if(typeof uploaded.content_base64!=='string'||createHash('sha256').update(Buffer.from(uploaded.content_base64,'base64')).digest('hex')!==createHash('sha256').update(source.wheel).digest('hex'))fail('verification_failed');
  const confirmed=await read(client,configPath);const edit=configEdit(confirmed,body.voicePort);if(edit.old_string!==edit.new_string)fail('verification_failed');
  stage='start';if(body.start===true)await client.call('power_action',{action:'start'});
  return {installed:true,started:body.start===true,server:{name:plan.server.name},world:plan.world,voicePort:body.voicePort,backup:backupFiles.length?backup:null,pluginVersion:'0.5.5',addonVersion:'2.15.39'};
 }catch(error){if(!(error instanceof MCSVError))error=new MCSVError('install_failed');error.stage=stage;error.partial=mutated;throw error;}finally{active.delete(plan.server.id);}
}
