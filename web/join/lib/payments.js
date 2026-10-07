import { randomUUID } from 'node:crypto';
import pg from 'pg';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { PaymentError,proof,checkSlip } from './payment-providers.js';

export { PaymentError };
export const paymentsEnabled=()=>process.env.PAYMENTS_ENABLED==='true';
export function paymentConfig(env=process.env){
 const amount=Number(env.INSTALL_PRICE_SATANG);
 if(!(env.PAYMENT_DATABASE_URL||env.DATABASE_URL)||!Number.isSafeInteger(amount)||amount<100||amount>20000000)throw new PaymentError('payment_unavailable');
 const branchInput=(env.SLIPOK_BRANCH_ID||'').trim();
 const branch=/^\d+$/.test(branchInput)?branchInput:/^https:\/\/api\.slipok\.com\/api\/line\/apikey\/(\d+)\/?$/.exec(branchInput)?.[1];
 const key=(env.SLIPOK_API_KEY||'').trim();
 const slipok=Boolean(branch)&&Boolean(key)&&Boolean(env.PAYMENT_RECEIVER_NAME);
 const promptpay=/^(0\d{9}|\d{13}|\d{15})$/.test(env.PROMPTPAY_ID||'')&&slipok;
 const truemoney=env.TRUEMONEY_ENABLED==='true'&&/^0\d{9}$/.test(env.TRUEMONEY_PHONE||'')&&slipok;
 if(!promptpay&&!truemoney)throw new PaymentError('payment_unavailable');
 return {amount,promptpay,truemoney,slipok,branch,key,phone:env.TRUEMONEY_PHONE,target:env.PROMPTPAY_ID,receiver:env.PAYMENT_RECEIVER_NAME};
}
let pool;
export function database(){if(!pool)pool=new pg.Pool({connectionString:process.env.PAYMENT_DATABASE_URL||process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});return pool;}
export function paymentStore(db=database()){
 return {
 async entitled(user,server){return Boolean((await db.query('SELECT 1 FROM sleepy_install_entitlements WHERE user_id=$1 AND server_id=$2 AND installed_at IS NULL',[user,server])).rowCount);},
 async installed(user,server){await db.query('UPDATE sleepy_install_entitlements SET installed_at=now() WHERE user_id=$1 AND server_id=$2 AND installed_at IS NULL',[user,server]);},
 async checkout(user,server,amount,serverName=null,userName=null){
  const c=await db.connect();try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':'+server]);
   if((await c.query('SELECT 1 FROM sleepy_install_entitlements WHERE user_id=$1 AND server_id=$2 AND installed_at IS NULL',[user,server])).rowCount){await c.query('COMMIT');return {status:'paid'};}
   await c.query("UPDATE sleepy_payment_orders SET status='expired' WHERE user_id=$1 AND server_id=$2 AND status='pending' AND (expires_at<=now() OR amount_satang<>$3)",[user,server,amount]);
   const old=await c.query("SELECT * FROM sleepy_payment_orders WHERE user_id=$1 AND server_id=$2 AND status IN ('pending','verifying','review') ORDER BY created_at DESC LIMIT 1",[user,server]);
   const result=old.rowCount?old:await c.query(`INSERT INTO sleepy_payment_orders(id,user_id,server_id,amount_satang,server_name,user_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[randomUUID(),user,server,amount,serverName,userName]);await c.query('COMMIT');return result.rows[0];
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 },
 async order(id,user){const r=await db.query('SELECT * FROM sleepy_payment_orders WHERE id=$1 AND user_id=$2',[id,user]);if(!r.rowCount)throw new PaymentError('payment_order');return r.rows[0];},
 async begin(id,user,key,method){
  const c=await db.connect();try{
   await c.query('BEGIN');const r=await c.query('SELECT * FROM sleepy_payment_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user]);const o=r.rows[0];
   if(!o)throw new PaymentError('payment_order');
   if(o.status==='paid'){await c.query('COMMIT');return null;}
   if(o.status!=='pending')throw new PaymentError('payment_review');
   if(new Date(o.expires_at).getTime()<=Date.now())throw new PaymentError('payment_expired');
   const limit=await c.query("SELECT count(*)::int AS n FROM sleepy_payment_attempts a JOIN sleepy_payment_orders o ON o.id=a.order_id WHERE o.user_id=$1 AND a.created_at>now()-interval '10 minutes'",[user]);if(limit.rows[0].n>=5)throw new PaymentError('payment_rate_limit');
   const claim=await c.query(`INSERT INTO sleepy_payment_attempts(proof_key,order_id,method) VALUES($1,$2,$3)
    ON CONFLICT(proof_key) DO UPDATE SET status='verifying',error_code=NULL,created_at=now()
    WHERE sleepy_payment_attempts.order_id=EXCLUDED.order_id AND sleepy_payment_attempts.status='rejected'
    AND sleepy_payment_attempts.error_code='slip_delay' AND sleepy_payment_attempts.created_at<now()-interval '10 minutes' RETURNING proof_key`,[key,id,method]);
   if(!claim.rowCount)throw new PaymentError('payment_duplicate');
   await c.query("UPDATE sleepy_payment_orders SET status='verifying' WHERE id=$1",[id]);await c.query('COMMIT');return o;
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')throw new PaymentError('payment_duplicate');throw e;}finally{c.release();}
 },
 async finish(order,key,result){
  const c=await db.connect();try{
   await c.query('BEGIN');await c.query('SELECT id FROM sleepy_payment_orders WHERE id=$1 FOR UPDATE',[order.id]);
   await c.query("UPDATE sleepy_payment_attempts SET provider_reference=$2,status='paid',amount_satang=$3 WHERE proof_key=$1",[key,result.reference,result.amount]);
   await c.query("UPDATE sleepy_payment_orders SET status='paid',paid_at=now(),purchase_number=nextval('sleepy_purchase_sequence'),payment_method=(SELECT method FROM sleepy_payment_attempts WHERE proof_key=$2),installation_state='waiting' WHERE id=$1",[order.id,key]);
   await c.query('INSERT INTO sleepy_install_entitlements(user_id,server_id,order_id,installed_at) VALUES($1,$2,$3,NULL) ON CONFLICT(user_id,server_id) DO UPDATE SET order_id=EXCLUDED.order_id,installed_at=NULL',[order.user_id,order.server_id,order.id]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw new PaymentError('payment_review',true);}finally{c.release();}
 },
 async failed(id,key,error){
  // Persist ambiguous results; never automatically redeem or grant again after a timeout.
  const c=await db.connect();try{await c.query('BEGIN');await c.query('UPDATE sleepy_payment_attempts SET status=$2,error_code=$3 WHERE proof_key=$1',[key,error.uncertain?'review':'rejected',error.code||'payment_review']);await c.query('UPDATE sleepy_payment_orders SET status=$2 WHERE id=$1',[id,error.uncertain?'review':'pending']);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 };
}
export async function checkoutPayment(user,server,serverName=null,userName=null){
 if(!paymentsEnabled())return {required:false};const config=paymentConfig();const store=paymentStore();
 if(await store.entitled(user,server))return {required:true,paid:true};
 const o=await store.checkout(user,server,config.amount,serverName,userName);
 if(o.status==='paid')return {required:true,paid:true};
 return {required:true,paid:false,status:o.status,orderId:o.id,amountSatang:o.amount_satang,expiresAt:o.expires_at,methods:{promptpay:config.promptpay,truemoney:config.truemoney},receiver:config.receiver,truemoneyPhone:config.truemoney?config.phone:null,promptpayId:config.promptpay?config.target:null,qr:config.promptpay?await QRCode.toDataURL(generatePayload(config.target,{amount:o.amount_satang/100}),{width:320,margin:2}):null};
}
export async function payOrder(user,body,store=paymentStore(),config=paymentConfig(),providers={checkSlip}){
 if(!/^[0-9a-f-]{36}$/.test(body.orderId||''))throw new PaymentError('payment_order');
 if(!config[body.method])throw new PaymentError('payment_method');
 const p=proof(body);const o=await store.begin(body.orderId,user,p.key,body.method);if(!o)return {paid:true};
 try{const result=await providers.checkSlip(o,p.value,config);await store.finish(o,p.key,result);return {paid:true};}
 catch(e){const error=e instanceof PaymentError?e:new PaymentError('payment_review',true);await store.failed(o.id,p.key,error);throw error;}
}
export async function requirePayment(user,server){if(paymentsEnabled()){paymentConfig();if(!await paymentStore().entitled(user,server))throw new PaymentError('payment_required');}}

export async function consumeInstallation(user,server){if(paymentsEnabled())await paymentStore().installed(user,server);}
