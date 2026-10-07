import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {webhookURL} from './payment-history.js';
const client=new pg.Client({connectionString:process.env.PAYMENT_DATABASE_URL||process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{const webhook=webhookURL();if(!webhook)throw Error('webhook_missing');const response=await fetch(webhook,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||(await response.json()).type!==1)throw Error('webhook_invalid');console.log('WEBHOOKPAY_READY');await client.connect();await client.query(await readFile(new URL('./payment-history-migration.sql',import.meta.url),'utf8'));console.log('PAYMENT_HISTORY_MIGRATION_OK Webhookpay configured');}catch{console.error('PAYMENT_HISTORY_MIGRATION_FAILED');process.exitCode=1;}finally{await client.end();}
