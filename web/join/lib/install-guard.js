// Cross-instance install lock and per-user rate limits, stored in the existing Postgres database.
// Serverless instances do not share memory, so an in-memory lock lets two installs race on one server.
// These guards fail open (log and continue) if the database is unreachable: they protect files and
// quota, not money, and payment checks stay fail-closed elsewhere.
import { randomUUID } from 'node:crypto';
import { database } from './payments.js';

const SCHEMA=`CREATE TABLE IF NOT EXISTS sleepy_install_locks(server_id text PRIMARY KEY,holder uuid NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sleepy_rate_limits(key text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL DEFAULT 0,PRIMARY KEY(key,window_start));`;
export const LIMITS={prepare:{hits:20,minutes:10},install:{hits:6,minutes:10},status:{hits:240,minutes:10}};

export class GuardError extends Error{constructor(code){super(code);this.code=code;}}
const configured=env=>Boolean(env.PAYMENT_DATABASE_URL||env.DATABASE_URL);

export function installGuard(db=null,{env=process.env}={}){
 let ready=null;
 const conn=()=>db||database();
 async function schema(){if(!ready)ready=conn().query(SCHEMA).catch(e=>{ready=null;throw e;});return ready;}
 async function safely(work,fallback){
  if(!db&&!configured(env))return fallback;
  try{await schema();return await work(conn());}
  catch(error){if(error instanceof GuardError)throw error;console.warn(JSON.stringify({event:'install_guard_unavailable'}));return fallback;}
 }
 return {
  // Returns a release function. Throws GuardError('busy') if another install holds this server.
  async lock(server,seconds=330){
   const holder=randomUUID();
   const got=await safely(async c=>{const r=await c.query(`INSERT INTO sleepy_install_locks(server_id,holder,expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))
    ON CONFLICT(server_id) DO UPDATE SET holder=EXCLUDED.holder,expires_at=EXCLUDED.expires_at WHERE sleepy_install_locks.expires_at<now() RETURNING holder`,[server,holder,seconds]);if(!r.rowCount)throw new GuardError('busy');return true;},false);
   return async()=>{if(got)await safely(c=>c.query('DELETE FROM sleepy_install_locks WHERE server_id=$1 AND holder=$2',[server,holder]),null);};
  },
  // Fixed-window counter per user and action. Throws GuardError('rate_limit') when exceeded.
  async limit(user,action){
   const rule=LIMITS[action];if(!rule)return;
   await safely(async c=>{const r=await c.query(`INSERT INTO sleepy_rate_limits(key,window_start,hits) VALUES($1,date_bin(make_interval(mins=>$2),now(),'2000-01-01'),1)
    ON CONFLICT(key,window_start) DO UPDATE SET hits=sleepy_rate_limits.hits+1 RETURNING hits`,[action+':'+user,rule.minutes]);if(r.rows[0].hits>rule.hits)throw new GuardError('rate_limit');},null);
  },
  async prune(){return safely(async c=>{await c.query("DELETE FROM sleepy_rate_limits WHERE window_start<now()-interval '1 day'");await c.query('DELETE FROM sleepy_install_locks WHERE expires_at<now()');
   // Report log is only kept to detect bursts; blacklist is kept (it is the permanent block).
   await c.query("DELETE FROM sleepy_report_log WHERE at<now()-interval '7 days'").catch(()=>{});return true;},false);}
 };
}
