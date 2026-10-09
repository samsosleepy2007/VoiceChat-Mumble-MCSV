import { paymentConfig,paymentsEnabled } from '../../lib/payments.js';
import { health } from '../../lib/health.js';
import { pluginReport } from '../../lib/plugin-report.js';
// Public configuration readiness only. Never verify a slip or expose a credential.
export default async function handler(req,res){
 const query=new URL(req.url,'https://localhost').searchParams;
 if(query.get('check')==='health')return health(req,res);
 if(query.get('report')==='1')return pluginReport(req,res);
 if(req.method!=='GET')return res.status(405).json({error:'method'});
 res.setHeader('Cache-Control','public, max-age=30, s-maxage=60');
 try{const c=paymentConfig();return res.status(200).json({promptpay:paymentsEnabled()&&c.promptpay,truemoney:paymentsEnabled()&&c.truemoney,mode:'slipok',amountSatang:c.amount});}
 catch{return res.status(200).json({promptpay:false,truemoney:false,mode:'slipok'});}
}
