import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../addon/BP/scripts/main.js',import.meta.url),'utf8');let interval;
const system={currentTick:0,runInterval:fn=>interval=fn};const ctx=vm.createContext({system,console,VOICE_RANGE_PREVIEW_PREFIX:'vcmumble:voice_range_preview_'});
vm.runInContext(source.slice(source.indexOf('const activeRangePreviews ='),source.indexOf('const openSettingsPlayers')),ctx);
const effects=[];const player={id:'a',name:'Tester',isValid:true,location:{x:10,y:64,z:20},spawnParticle:(...args)=>effects.push(args)};
ctx.showVoiceRangePreview(player,30);assert.equal(effects[0][0],'vcmumble:voice_range_intro_030');assert.equal(effects[0][1].y,64.9);assert.equal(effects[0].length,2);
player.location.x=12;system.currentTick=20;interval();assert.equal(effects[1][1].x,12);assert.equal(effects[1][0],'vcmumble:voice_range_preview_030');
system.currentTick=200;interval();assert.equal(effects.length,2);
for(let i=1;i<=150;i++){const p=JSON.parse(fs.readFileSync(new URL(`../addon/RP/particles/voice_range_preview_${String(i).padStart(3,'0')}.particle.json`,import.meta.url)));assert.equal(p.particle_effect.description.identifier,ctx.voiceRangePreviewParticleId(i));}
assert.ok(source.includes('showVoiceRangePreview(player, value);'));
console.log('PASS: private static preview, waist height, follows player, expires in ten seconds and all radius assets exist.');
