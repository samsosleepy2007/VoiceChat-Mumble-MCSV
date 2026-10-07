import { createHash } from 'node:crypto';

export class PaymentError extends Error {
 constructor(code,uncertain=false){super(code);this.code=code;this.uncertain=uncertain;}
}
export function satang(value){
 const text=String(value);if(!/^\d{1,7}(\.\d{1,2})?$/.test(text))throw new PaymentError('payment_amount');
 const [whole,fraction='']=text.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function slipImage(value){
 if(typeof value!=='string'||value.length>2800000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new PaymentError('slip_format');
 const b=Buffer.from(value,'base64');let mime;
 if(b.length>=12&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))mime='image/png';
 else if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg';
 else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')mime='image/webp';
 if(!mime||b.length>2000000)throw new PaymentError('slip_format');return {bytes:b,mime};
}
export function proof(body){
 if(body.method==='promptpay'||body.method==='truemoney'){const image=slipImage(body.image);return {value:image,key:'image:'+createHash('sha256').update(image.bytes).digest('hex')};}
 throw new PaymentError('payment_method');
}
export async function checkSlip(order,image,config,fetcher=fetch){
 const form=new FormData();form.append('files',new Blob([image.bytes],{type:image.mime}),'slip.'+(image.mime==='image/png'?'png':image.mime==='image/webp'?'webp':'jpg'));form.append('log','true');form.append('amount',(order.amount_satang/100).toFixed(2));
 let response,result;
 try{response=await fetcher('https://api.slipok.com/api/line/apikey/'+config.branch,{method:'POST',redirect:'error',headers:{'x-authorization':config.key},body:form,signal:AbortSignal.timeout(25000)});result=await response.json();}catch{throw new PaymentError('payment_review',true);}
 if(!response.ok||result.success!==true){const code=Number(result.code);const errors={1010:'slip_delay',1012:'payment_duplicate',1013:'payment_amount',1014:'payment_receiver',1006:'slip_format',1007:'slip_format',1008:'slip_invalid',1009:'slip_invalid'};throw new PaymentError(errors[code]||'payment_review',!errors[code]);}
 const d=result.data;let amount;try{amount=satang(d?.amount);}catch{throw new PaymentError('payment_review',true);}
 const timestamp=Date.parse(d?.transTimestamp);const created=new Date(order.created_at).getTime();
 if(d?.success!==true||amount!==order.amount_satang||typeof d.sendingBank!=='string'||! /^[A-Za-z0-9 _-]{1,40}$/.test(d.sendingBank)||!d.sendingBank.trim()||typeof d.transRef!=='string'||!d.transRef||d.transRef.length>100||!Number.isFinite(timestamp)||timestamp<created-60000||timestamp>Date.now()+60000)throw new PaymentError('payment_review',true);
 // log:true makes SlipOK enforce the receiving account configured for this branch.
 return {reference:'slip:'+d.sendingBank.trim().toUpperCase()+':'+d.transRef,amount};
}
