// Read-only deployment checks. Never redeem an envelope or upload a slip here.
import pg from 'pg';
import { TmnVoucherClient } from '@prakrit_m/tmn-voucher';
import { paymentConfig } from './payments.js';
console.log('PAYMENT_CONFIG_CHECK '+JSON.stringify({branchPresent:Boolean(process.env.SLIPOK_BRANCH_ID),branchNumeric:/^\d+$/.test((process.env.SLIPOK_BRANCH_ID||'').trim()),keyPresent:Boolean(process.env.SLIPOK_API_KEY),receiverPresent:Boolean(process.env.PAYMENT_RECEIVER_NAME),promptpayValid:/^(0\d{9}|\d{13}|\d{15})$/.test(process.env.PROMPTPAY_ID||'')}));
const config=paymentConfig();
const client=new pg.Client({connectionString:process.env.PAYMENT_DATABASE_URL||process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{
 await client.connect();
 const result=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('sleepy_payment_orders','sleepy_payment_attempts','sleepy_install_entitlements')");
 if(result.rows.length!==3)throw Error('payment_schema');
 console.log('PAYMENT_DATABASE_OK');
}catch{console.error('PAYMENT_DATABASE_FAILED');process.exitCode=1;}finally{await client.end();}
if(config.promptpay){
 try{
  const response=await fetch('https://api.slipok.com/api/line/apikey/'+config.branch+'/quota',{headers:{'x-authorization':config.key},redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok||result.success!==true||!Number.isFinite(result.data?.quota))throw Error('slipok_quota');
  console.log('SLIPOK_QUOTA_OK '+JSON.stringify({quota:result.data.quota,specialQuota:result.data.specialQuota??0}));
 }catch{console.error('SLIPOK_PREFLIGHT_FAILED');process.exitCode=1;}
}
if(config.truemoney){
 const result=await new TmnVoucherClient({timeoutMs:15000}).checkServerStatus();
 console.log('TRUEMONEY_PREFLIGHT '+JSON.stringify({ready:result.success===true,code:result.code}));
}
