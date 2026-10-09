// Maps a server's Pelican identifier (what the plugin reports, P_SERVER_UUID[:8]) to what the website
// knows about it (name, owner, ports, version) at the last successful install. The plugin report only
// carries the Pelican UUID, while payment orders are keyed by the MCSV server id — a different value —
// so without this table the report could never name the server or its owner. Fails open like the other
// guards: a registry error never breaks an install or a report.
const SCHEMA=`CREATE TABLE IF NOT EXISTS sleepy_server_registry(
 pelican text PRIMARY KEY,server_id text,server_name text,user_id text,user_name text,
 voice_port integer,ports integer[],host text,plugin_version text,updated_at timestamptz NOT NULL DEFAULT now());`;

const pel=v=>typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?v:null;

export function serverRegistry(conn){
 let ready=null;
 const schema=async()=>{if(!ready)ready=conn.query(SCHEMA).catch(e=>{ready=null;throw e;});return ready;};
 return {
  async remember(info){
   const pelican=pel(info.identifier);if(!pelican)return;
   try{await schema();await conn.query(`INSERT INTO sleepy_server_registry(pelican,server_id,server_name,user_id,user_name,voice_port,ports,host,plugin_version,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT(pelican) DO UPDATE SET server_id=EXCLUDED.server_id,server_name=EXCLUDED.server_name,user_id=EXCLUDED.user_id,user_name=EXCLUDED.user_name,voice_port=EXCLUDED.voice_port,ports=EXCLUDED.ports,host=EXCLUDED.host,plugin_version=EXCLUDED.plugin_version,updated_at=now()`,
    [pelican,info.serverId||null,info.serverName||null,info.userId||null,info.userName||null,Number.isInteger(info.voicePort)?info.voicePort:null,Array.isArray(info.ports)?info.ports.filter(Number.isInteger):null,info.host||null,info.pluginVersion||null]);}
   catch{console.warn(JSON.stringify({event:'server_registry_write_failed'}));}
  },
  // Pelican may arrive as the full UUID; match on its first 8 hex chars.
  async lookup(pelicanOrUuid){
   const pelican=pel(String(pelicanOrUuid||'').toLowerCase().slice(0,8));if(!pelican)return null;
   try{await schema();const r=await conn.query('SELECT * FROM sleepy_server_registry WHERE pelican=$1',[pelican]);return r.rows[0]||null;}
   catch{return null;}
  }
 };
}
