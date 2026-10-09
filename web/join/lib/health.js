// For an external uptime monitor (e.g. UptimeRobot): 200 when installs and payments can work, 503 otherwise.
// Reports only booleans, never configuration values.
import { database,paymentsEnabled,paymentConfig } from './payments.js';
import { licenseEnabled } from './license.js';
import { configured } from './auth.js';
// Served at /api/health through a route to the availability function (the Hobby plan allows 12 functions).
export async function health(req,res){
 res.setHeader('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method))return res.status(405).end();
 const checks={auth:configured(),license:licenseEnabled(),payments:true,database:true};
 if(paymentsEnabled()){try{paymentConfig();}catch{checks.payments=false;}try{await database().query('SELECT 1');}catch{checks.database=false;}}
 const ok=Object.values(checks).every(Boolean);return res.status(ok?200:503).json({ok,...checks});
}
