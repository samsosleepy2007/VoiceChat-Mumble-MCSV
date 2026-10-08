import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { satang,slipImage,proof,checkSlip,PaymentError } from '../web/join/lib/payment-providers.js';
import { paymentConfig,paymentStore,payOrder,requirePayment } from '../web/join/lib/payments.js';
import { PGlite } from '../web/join/node_modules/@electric-sql/pglite/dist/index.js';

assert.equal(satang('100.25'),10025);for(const bad of ['1e2','-1','1.123',NaN,'100abc'])assert.throws(()=>satang(bad));
assert.throws(()=>slipImage(Buffer.from('<svg/>').toString('base64')));assert.throws(()=>paymentConfig({}));
const env={DATABASE_URL:'postgresql://test.invalid/db',INSTALL_PRICE_SATANG:'500',SLIPOK_BRANCH_ID:'https://api.slipok.com/api/line/apikey/123',SLIPOK_API_KEY:'test-key',PAYMENT_RECEIVER_NAME:'Test',TRUEMONEY_PHONE:'0933402606',TRUEMONEY_ENABLED:'true'};
assert.equal(paymentConfig(env).amount,500);assert.equal(paymentConfig(env).truemoney,true);assert.equal(paymentConfig({...env,TRUEMONEY_ENABLED:'false',PROMPTPAY_ID:'0812345678'}).truemoney,false);assert.throws(()=>paymentConfig({...env,SLIPOK_API_KEY:''}));
const image=slipImage(Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'));
const config={amount:10000,promptpay:true,truemoney:true,branch:'123',key:'private-test',phone:'0812345678'};
const order={amount_satang:10000,created_at:new Date()};
const valid={success:true,data:{success:true,amount:100,sendingBank:'004',transRef:'bank-ref',transTimestamp:new Date().toISOString()}};
let calls=0;
const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.slipok.com/api/line/apikey/123');assert.equal(options.redirect,'error');assert.equal(options.headers['x-authorization'],'private-test');assert.equal(options.body.get('log'),'true');assert.equal(options.body.get('amount'),'100.00');assert(options.body.get('files') instanceof Blob);return {ok:true,json:async()=>valid};};
assert.deepEqual(await checkSlip(order,image,config,fetcher),{reference:'slip:004:bank-ref',amount:10000});
for(const [code,error] of [[1012,'payment_duplicate'],[1013,'payment_amount'],[1014,'payment_receiver'],[1010,'slip_delay']])await assert.rejects(checkSlip(order,image,config,async()=>({ok:false,json:async()=>({code})})),e=>e.code===error);
for(const data of [{...valid.data,amount:1},{...valid.data,transTimestamp:'2000-01-01T00:00:00Z'},{...valid.data,success:false},{...valid.data,transRef:''}])await assert.rejects(checkSlip(order,image,config,async()=>({ok:true,json:async()=>({success:true,data})})),e=>e.uncertain);
await assert.rejects(checkSlip(order,image,config,async()=>{throw Error('timeout');}),e=>e.uncertain);
const walletResult={...valid,data:{...valid.data,sendingBank:'TrueMoney Wallet',transRef:'wallet-ref'}};
assert.deepEqual(await checkSlip(order,image,config,async()=>({ok:true,json:async()=>walletResult})),{reference:'slip:TRUEMONEY WALLET:wallet-ref',amount:10000});
const imageValue=image.bytes.toString('base64');
assert.equal(proof({method:'promptpay',image:imageValue}).key,proof({method:'truemoney',image:imageValue}).key);
assert.throws(()=>proof({method:'truemoney',voucher:'https://gift.truemoney.com/campaign/?v=abcdef0123456789'}),e=>e.code==='slip_format');
const differentImage=n=>Buffer.concat([image.bytes,Buffer.from([n])]).toString('base64');

// Embedded PostgreSQL exercises the actual schema, row state and unique constraints.
const db=new PGlite();await db.exec(await readFile(new URL('../web/join/lib/payment-schema.sql',import.meta.url),'utf8'));
const adapter={query:async(sql,args)=>{const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},connect:async()=>({...adapter,release(){}})};
const store=paymentStore(adapter);const o=await store.checkout('user-a','server-a',10000);assert.equal((await store.checkout('user-a','server-a',10000)).id,o.id);
let verified=0;const providers={checkSlip:async(o,value,c)=>{verified++;assert.equal(value.mime,'image/png');assert.equal(c.branch,config.branch);return {reference:'slip:wallet:unique',amount:10000};}};
const body={orderId:o.id,method:'truemoney',image:imageValue};
await assert.rejects(payOrder('user-b',body,store,config,providers),e=>e.code==='payment_order');assert.equal(verified,0);
assert.equal((await payOrder('user-a',body,store,config,providers)).paid,true);assert(await store.entitled('user-a','server-a'));assert(!await store.entitled('user-a','server-b'));assert(!await store.entitled('user-b','server-a'));
assert.equal((await payOrder('user-a',body,store,config,providers)).paid,true);assert.equal(verified,1);assert.equal((await store.checkout('user-a','server-a',10000)).status,'paid');
const other=await store.checkout('user-b','server-b',10000);await assert.rejects(payOrder('user-b',{...body,orderId:other.id,method:'promptpay'},store,config,providers),e=>e.code==='payment_duplicate');assert.equal(verified,1);
const uncertain=await store.checkout('user-a','server-c',10000);const uncertainBody={...body,orderId:uncertain.id,image:differentImage(1)};
await assert.rejects(payOrder('user-a',uncertainBody,store,config,{checkSlip:async()=>{throw new PaymentError('payment_review',true);}}),e=>e.uncertain);
assert.equal((await store.order(uncertain.id,'user-a')).status,'review');assert(!await store.entitled('user-a','server-c'));assert.equal((await store.checkout('user-a','server-c',10000)).id,uncertain.id);
await assert.rejects(payOrder('user-a',uncertainBody,store,config,providers),e=>e.code==='payment_review');
const expired=await store.checkout('user-c','server-d',10000);await db.query("UPDATE sleepy_payment_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);await assert.rejects(store.begin(expired.id,'user-c','unused','truemoney'),e=>e.code==='payment_expired');
const newer=await store.checkout('user-c','server-d',10000);assert.notEqual(newer.id,expired.id);
const sameRef=await store.checkout('user-d','server-e',10000);await assert.rejects(payOrder('user-d',{...body,orderId:sameRef.id,image:differentImage(2)},store,config,providers),e=>e.uncertain);assert(!await store.entitled('user-d','server-e'));
process.env.PAYMENTS_ENABLED='true';await assert.rejects(requirePayment('user','server'),e=>e.code==='payment_unavailable');delete process.env.PAYMENTS_ENABLED;
// One payment per server: installing keeps the entitlement, so a reinstall needs no new order.
await store.installed('user-a','server-a');assert(await store.entitled('user-a','server-a'));assert.equal((await store.checkout('user-a','server-a',10000)).status,'paid');assert(!await store.entitled('user-b','server-a'));
await db.close();console.log('PASS payments: SlipOK log/amount/account errors, old slips, TrueMoney slip upload, shared SlipOK validation and cross-channel replay prevention, SQL duplicate protection, ownership, retries, expiry, ambiguous recovery and fail-closed configuration');

const legacy=new PGlite();const schema=await readFile(new URL('../web/join/lib/payment-schema.sql',import.meta.url),'utf8');await legacy.exec(schema.replace(',installed_at timestamptz',''));
const legacyOrder='87654321-1234-1234-1234-123456789abc';await legacy.query("INSERT INTO sleepy_payment_orders(id,user_id,server_id,amount_satang,status) VALUES($1,'legacy-user','legacy-server',500,'paid')",[legacyOrder]);await legacy.query("INSERT INTO sleepy_install_entitlements(user_id,server_id,order_id) VALUES('legacy-user','legacy-server',$1)",[legacyOrder]);
const migration=await readFile(new URL('../web/join/lib/payment-install-migration.sql',import.meta.url),'utf8');await legacy.exec(migration);assert((await legacy.query('SELECT installed_at FROM sleepy_install_entitlements')).rows[0].installed_at);
await legacy.query("INSERT INTO sleepy_install_entitlements(user_id,server_id,order_id) VALUES('new-user','legacy-server',$1)",[legacyOrder]);await legacy.exec(migration);assert.equal((await legacy.query("SELECT installed_at FROM sleepy_install_entitlements WHERE user_id='new-user'")).rows[0].installed_at,null);await legacy.close();console.log('PASS payment installation migration: preserves audits, historical consumed grants, unpaid installation retry and idempotence');
