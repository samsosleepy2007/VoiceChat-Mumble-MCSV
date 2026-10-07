import { TmnVoucherClient } from '@prakrit_m/tmn-voucher';

// Use the fixed provider origin, an honest app identity, and no redirect/proxy.
// Only transport metadata is retained: never voucher URLs, bodies or phone numbers.
export function trueMoneyClient({fetcher=fetch,timeoutMs=15000}={}){
 const transport={upstreamStatus:null,blocked:false,challenge:false,redeemAttempted:false};
 const client=new TmnVoucherClient({timeoutMs,userAgent:'SleepyMumla/1.0 (+https://sleepyvoice-join.vercel.app)',fetch:async(url,options)=>{
  const target=new URL(url);
  if(target.origin!=='https://gift.truemoney.com')throw Error('provider_origin');
  if(options?.method==='POST'&&target.pathname.endsWith('/redeem'))transport.redeemAttempted=true;
  const response=await fetcher(url,{...options,redirect:'error'});
  transport.upstreamStatus=response.status;
  transport.blocked=response.status===403;
  transport.challenge=response.headers?.get('cf-mitigated')==='challenge';
  return response;
 }});
 return {client,transport};
}
