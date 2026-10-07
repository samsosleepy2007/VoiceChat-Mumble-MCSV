import { TmnVoucherClient } from '@prakrit_m/tmn-voucher';
// Public read-only availability. No phone, voucher, payment or credential input.
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'method'});
 res.setHeader('Cache-Control','public, max-age=30, s-maxage=60');
 let upstreamStatus=null;
 const client=new TmnVoucherClient({timeoutMs:5000,fetch:async(url,options)=>{
  const response=await fetch(url,{...options,redirect:'error'});upstreamStatus=response.status;return response;
 }});
 const result=await client.checkServerStatus();
 return res.status(200).json({truemoney:result.success===true,code:result.code,upstreamStatus});
}
