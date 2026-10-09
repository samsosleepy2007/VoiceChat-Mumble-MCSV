import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from '../web/join/node_modules/jsdom/lib/api.js';
// Phone keyboard: the visual viewport shrinks to ~half; the page must keep its scale, not shrink to fit.
const script=await readFile(new URL('../web/join/viewport.js',import.meta.url),'utf8');
const dom=new JSDOM('<body><header></header><main class="page"><section class="card"><input id="key"><button id="go">go</button></section></main></body>',{runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;let rafs=[];w.requestAnimationFrame=fn=>{rafs.push(fn);return rafs.length;};const flush=()=>{const q=rafs;rafs=[];q.forEach(f=>f(0));};
const listeners={};const vv={width:390,height:800,addEventListener:(t,f)=>{listeners[t]=f;}};Object.defineProperty(w,'visualViewport',{value:vv});
Object.defineProperty(w.HTMLElement.prototype,'offsetHeight',{get(){return this.classList.contains('viewport-stage')?1000:0;}});
Object.defineProperty(w.HTMLElement.prototype,'scrollWidth',{get(){return 380;}});
let revealed=0;w.HTMLElement.prototype.scrollIntoView=function(){revealed++;};
w.eval(script);
const stage=w.document.querySelector('.viewport-stage');const scale=()=>Number(/scale\(([\d.]+)\)/.exec(stage.style.transform)[1]);
const before=scale();assert(Math.abs(before-0.792)<0.001,before);
w.document.getElementById('key').focus();vv.height=400;listeners.resize();flush();
assert.equal(scale(),before,'keyboard open: scale unchanged');assert(w.document.body.classList.contains('typing'),'page may scroll while typing');
await new Promise(r=>setTimeout(r,400));assert(revealed>0,'focused field is scrolled into view');
w.document.getElementById('key').blur();vv.height=800;listeners.resize();await new Promise(r=>setTimeout(r,80));flush();
assert(!w.document.body.classList.contains('typing'));assert.equal(scale(),before,'keyboard closed: normal fit again');
// A button gets focus without a keyboard: normal fitting continues.
w.document.getElementById('go').focus();vv.height=600;listeners.resize();flush();assert(Math.abs(scale()-0.592)<0.001,'non-text focus still fits');
// Rotation while typing re-measures instead of keeping a stale height.
w.document.getElementById('key').focus();vv.width=800;vv.height=350;listeners.resize();flush();assert(Math.abs(scale()-0.342)<0.001,scale());
dom.window.close();
console.log('PASS viewport: phone keyboard keeps the page scale, page scrolls and reveals the field, normal fit otherwise, rotation re-measures');
