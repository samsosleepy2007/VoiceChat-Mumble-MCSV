import pg from 'pg';
import { readFile } from 'node:fs/promises';
const client=new pg.Client({connectionString:process.env.PAYMENT_DATABASE_URL||process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{await client.connect();await client.query(await readFile(new URL('./payment-install-migration.sql',import.meta.url),'utf8'));console.log('PAYMENT_INSTALL_MIGRATION_OK');}
catch{console.error('PAYMENT_INSTALL_MIGRATION_FAILED');process.exitCode=1;}
finally{await client.end();}
