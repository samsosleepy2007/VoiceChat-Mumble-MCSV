import { trueMoneyClient } from '../../lib/truemoney-client.js';
// Public read-only availability. No phone, voucher, payment or credential input.
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'method'});
 res.setHeader('Cache-Control','public, max-age=30, s-maxage=60');
 const {client,transport}=trueMoneyClient({timeoutMs:5000});
 const result=await client.checkServerStatus();
 return res.status(200).json({truemoney:result.success===true,code:transport.blocked?'REQUEST_BLOCKED':result.code,upstreamStatus:transport.upstreamStatus,challenge:transport.challenge});
}
