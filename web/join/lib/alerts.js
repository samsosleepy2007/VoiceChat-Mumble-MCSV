// Operator alerts for things that need a human: orders stuck in review, failed or timed-out installs.
// Posts to WebhookAlerts (falls back to WebhookPay). Never throws; never includes secrets or API keys.
import { webhookURL } from './payment-history.js';

const clean=value=>String(value??'-').replace(/[@`*_~<>\\]/g,'').slice(0,200);

export async function alert(title,fields={},{fetcher=fetch,env=process.env}={}){
 const url=webhookURL({WebhookPay:env.WebhookAlerts||env.WebhookPay||env.Webhookpay});if(!url)return false;
 const body={username:'SleepyMumla Alerts',allowed_mentions:{parse:[]},embeds:[{title:clean(title),color:0xef856c,fields:Object.entries(fields).slice(0,10).map(([name,value])=>({name:clean(name),value:clean(value),inline:true})),timestamp:new Date().toISOString()}]};
 try{const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return response.ok;}
 catch{return false;}
}
