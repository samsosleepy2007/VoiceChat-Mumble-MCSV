// Operator alerts for things that need a human: orders stuck in review, failed or timed-out installs,
// and unlicensed/suspicious plugin reports. Posts to WebhookAlerts (falls back to WebhookPay).
// Never throws; never includes secrets or API keys.
import { webhookURL } from './payment-history.js';

const clean=value=>String(value??'-').replace(/[@`*_~<>\\]/g,'').slice(0,200);

// Low-level embed post. fields:[{name,value,inline?}], color is a Discord integer.
export async function postEmbed(title,fields=[],{color=0xef856c,fetcher=fetch,env=process.env}={}){
 const url=webhookURL({WebhookPay:env.WebhookAlerts||env.WebhookPay||env.Webhookpay});if(!url)return false;
 const body={username:'SleepyMumla Alerts',allowed_mentions:{parse:[]},embeds:[{title:clean(title),color,fields:fields.slice(0,20).map(f=>({name:clean(f.name),value:clean(f.value),inline:f.inline!==false})),timestamp:new Date().toISOString()}]};
 try{const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return response.ok;}
 catch{return false;}
}
export async function alert(title,fields={},options={}){
 return postEmbed(title,Object.entries(fields).map(([name,value])=>({name,value})),options);
}
