import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from '../web/join/node_modules/jsdom/lib/api.js';
const html=await readFile(new URL('../web/join/install.html',import.meta.url),'utf8');const script=await readFile(new URL('../web/join/install.js',import.meta.url),'utf8');
async function page(plan){
 const dom=new JSDOM(html,{url:'https://sleepyvoice-join.vercel.app/install',runScripts:'outside-only'});const w=dom.window;const requests=[];
 w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.latticeLoader=(node)=>{node.hidden=false;return {label(){},finish(state,text){node.textContent=text;}};};
 w.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,body});return {ok:true,json:async()=>url==='/api/payments/verify'?{paid:true}:JSON.parse(JSON.stringify(plan))};};
 w.eval(script);w.document.getElementById('mcsv-key').value='mcsv_private_test';
 w.document.getElementById('mcsv-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,5));return {dom,w,requests,el:id=>w.document.getElementById(id)};
}
const base={compatible:true,installAllowed:true,server:{id:'server',name:'Server'},world:'world',ports:[18655,20000],voicePort:18655};
const checkout={required:true,paid:false,status:'pending',orderId:'12345678-1234-1234-1234-123456789abc',amountSatang:25000,expiresAt:new Date(Date.now()+1800000).toISOString(),methods:{promptpay:true,truemoney:true},receiver:'Test Receiver',truemoneyPhone:'0933402606',promptpayId:'0812345678',qr:'data:image/png;base64,test'};
const p=await page({...base,payment:checkout});assert(p.w.document.querySelector('main.page').hidden);assert(!p.el('payment-page').hidden);assert(!p.el('install-dialog').open);assert.equal(p.el('payment-amount').textContent,'250.00');assert(!p.el('promptpay-fields').hidden);assert(p.el('truemoney-fields').hidden);
const radio=p.w.document.querySelector('input[value="truemoney"]');radio.checked=true;radio.dispatchEvent(new p.w.Event('change'));assert(p.el('promptpay-fields').hidden);assert(!p.el('truemoney-fields').hidden);
assert.equal(p.el('truemoney-target').textContent,'0933402606');assert.equal(p.el('truemoney-receiver'),null);assert.equal(p.el('payment-receiver'),null);assert(p.w.document.body.classList.contains('paying'));assert(p.el('payment-slip').required);assert.equal(p.el('payment-voucher'),null);
Object.defineProperty(p.el('payment-slip'),'files',{value:[new p.w.File([new Uint8Array([255,216,255,0])],'wallet.jpg',{type:'image/jpeg'})]});p.el('payment-form').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,25));assert(p.el('install-dialog').open);assert(p.el('payment-form').hidden);assert.equal(p.requests.length,2);assert.equal(p.requests[1].url,'/api/payments/verify');assert(!('apiKey' in p.requests[1].body));assert(!('voucher' in p.requests[1].body));assert.equal(p.requests[1].body.method,'truemoney');assert.equal(p.requests[1].body.image,'/9j/AA==');assert.equal(p.requests.filter(r=>r.body.action==='install').length,0);
p.dom.window.close();
for(const payment of [{required:false},{required:true,paid:true}]){const p=await page({...base,payment});assert(p.el('payment-page').hidden);assert(p.el('install-dialog').open);p.dom.window.close();}
const unsupported=await page({compatible:false,server:{name:'Java'}});assert(unsupported.el('payment-page').hidden);assert(!unsupported.el('reinstall-help').hidden);unsupported.dom.window.close();
const review=await page({...base,payment:{...checkout,status:'review'}});assert(review.el('payment-form').hidden);assert(!review.el('payment-result').hidden);assert(!review.el('install-dialog').open);review.dom.window.close();
const one=await page({...base,payment:{...checkout,methods:{promptpay:false,truemoney:true},qr:null}});assert(one.el('method-promptpay').hidden);assert(!one.el('truemoney-fields').hidden);one.dom.window.close();
const pp=await page({...base,payment:checkout});Object.defineProperty(pp.el('payment-slip'),'files',{value:[new pp.w.File([new Uint8Array([255,216,255,0])],'bank.jpg',{type:'image/jpeg'})]});pp.el('payment-form').dispatchEvent(new pp.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,25));assert(pp.el('install-dialog').open);assert.equal(pp.requests[1].body.method,'promptpay');pp.dom.window.close();
console.log('PASS payment UI: Endstone check → payment → port, method switching, no premature install, no API-key forwarding, paid/free paths, unsupported/review states');

const latest=await page({...base,installation:{present:true,status:'current',latest:{plugin:'0.5.5',addon:'2.15.39'}},payment:{required:false,reason:'installed'}});
assert(latest.el('reinstall-dialog').open);assert(!latest.el('install-dialog').open);assert(latest.el('payment-page').hidden);
latest.el('keep-installed').click();assert(!latest.el('reinstall-dialog').open);assert(!latest.el('install-dialog').open);assert.equal(latest.requests.length,1);
latest.el('mcsv-form').dispatchEvent(new latest.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,5));latest.el('confirm-reinstall').click();assert(latest.el('install-dialog').open);latest.dom.window.close();
const update=await page({...base,installation:{present:true,status:'update',latest:{plugin:'0.5.5',addon:'2.15.39'}},payment:{required:false,reason:'installed'}});assert(update.el('install-dialog').open);assert(!update.el('reinstall-dialog').open);assert(update.el('payment-page').hidden);update.dom.window.close();
console.log('PASS installation UI: latest asks to reinstall, cancellation does nothing, old version updates without checkout');
