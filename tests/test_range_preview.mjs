import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');
class Variables {setFloat(key,value){this[key]=value;}}
const ctx=vm.createContext({MolangVariableMap:Variables,console});
vm.runInContext(source.slice(source.indexOf('function showVoiceRangePreview('),source.indexOf('const openSettingsPlayers')),ctx);
const effects=[];const player={location:{x:10,y:64,z:20},spawnParticle:(...args)=>effects.push(args)};
ctx.showVoiceRangePreview(player,30);
assert.equal(effects.length,1);assert.equal(effects[0][0],'vcmumble:private_voice_range_ring');
assert.equal(effects[0][1].y,65);assert.equal(effects[0][2]['variable.range_radius'],30);
ctx.showVoiceRangePreview(player,999);assert.equal(effects[1][2]['variable.range_radius'],150);
const effect=JSON.parse(fs.readFileSync(new URL('../addon/RP/particles/private_voice_range_ring.json',import.meta.url),'utf8')).particle_effect.components;
assert.equal(effect['minecraft:particle_appearance_billboard'].facing_camera_mode,'direction_y');
assert.equal(effect['minecraft:particle_initial_speed'],0);
assert.deepEqual(Array.from(effect['minecraft:particle_appearance_billboard'].size),['variable.range_radius','variable.range_radius']);
assert.ok(effect['minecraft:emitter_lifetime_once']);
assert.ok(source.includes('showVoiceRangePreview(player, value);'));
console.log('PASS: private waist-height emitter, reference direction_y and size bound directly to range.');
