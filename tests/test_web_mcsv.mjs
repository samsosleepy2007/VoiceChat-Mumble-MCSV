import assert from 'node:assert/strict';
import {checkMCSV} from '../web/join/lib/mcsv.js';
const key='mcsv_test_key_for_unit_tests';
let calls=0;
const reply=(game,server_type)=>async(url,options)=>{calls++;assert.equal(url,'https://api.mcsv.me/api/v1/tools/server_info');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.body,'{}');return {ok:true,status:200,json:async()=>({ok:true,result:{name:'Test',game,server_type,status:'running',private_field:'never_return'}})};};
const valid=await checkMCSV(key,reply('minecraft-bedrock','endstone'));
assert.equal(valid.compatible,true);assert.equal(valid.server.private_field,undefined);
for(const [game,type] of [['minecraft-bedrock','bedrock'],['minecraft-java','paper'],['minecraft-java','endstone']])assert.equal((await checkMCSV(key,reply(game,type))).compatible,false);
const before=calls;await assert.rejects(checkMCSV('https://other-host.example/key',reply('minecraft-bedrock','endstone')),e=>e.code==='invalid_key');assert.equal(calls,before);
for(const [status,code] of [[401,'invalid_key'],[403,'permission'],[409,'installing'],[429,'rate_limit'],[500,'upstream'],[400,'rejected'],[404,'endpoint']])await assert.rejects(checkMCSV(key,async()=>({ok:false,status})),e=>e.code===code);
await assert.rejects(checkMCSV(key,async()=>({ok:true,status:200,json:async()=>({ok:true,result:{name:'endstone'}})})),e=>e.code==='unverified');
await assert.rejects(checkMCSV(key,async()=>{throw Error(key)}),e=>e.code==='unavailable'&&!e.message.includes(key));
console.log('PASS: strict Bedrock/Endstone gate, fixed MCSV destination, no private fields, invalid keys, API permissions/errors and no credential echo.');

await assert.rejects(checkMCSV(key,async()=>{const e=Error();e.name='TimeoutError';throw e}),e=>e.code==='timeout');
await assert.rejects(checkMCSV(key,async()=>({ok:true,status:200,json:async()=>{throw Error(key)}})),e=>e.code==='invalid_response'&&!e.message.includes(key));
