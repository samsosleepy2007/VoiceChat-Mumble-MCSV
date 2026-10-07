import fs from 'node:fs';import {minify} from 'terser';import {spawnSync} from 'node:child_process';
const raw=fs.readFileSync('addon/BP/scripts/main.js','utf8');
const chunk=raw.slice(raw.indexOf('const touchpadReceivers'),raw.indexOf('// ATM uses the PIN'))+'\nglobalThis.showTouchpad=showTouchpad;globalThis.nearbyTouchpads=nearbyTouchpads;';
const result=await minify(chunk,{module:true,compress:false,mangle:{toplevel:true,properties:false},format:{comments:false},sourceMap:false});
let test=fs.readFileSync('tests/test_touchpad.mjs','utf8');test=test.replace("vm.runInContext(s.slice(s.indexOf('const touchpadReceivers'),s.indexOf('// ATM uses the PIN')),ctx)",'vm.runInContext('+JSON.stringify(result.code)+',ctx)');
const path='tests/.protected-touchpad-check.mjs';fs.writeFileSync(path,test);try{const r=spawnSync(process.execPath,[path],{stdio:'inherit'});if(r.status!==0)process.exitCode=r.status||1;}finally{fs.unlinkSync(path);}
