export class MCSVError extends Error { constructor(code){super(code);this.code=code;} }
export async function checkMCSV(key,request=fetch) {
 if(typeof key!=='string'||key.length>512||!/^mcsv_[A-Za-z0-9_-]{8,}$/.test(key))throw new MCSVError('invalid_key');
 let response;
 try{response=await request('https://api.mcsv.me/api/v1/tools/server_info',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(12000)});}catch{throw new MCSVError('unavailable');}
 if(response.status===401)throw new MCSVError('invalid_key');
 if(response.status===403)throw new MCSVError('permission');
 if(response.status===409)throw new MCSVError('installing');
 if(response.status===429)throw new MCSVError('rate_limit');
 if(!response.ok)throw new MCSVError('unavailable');
 let data;try{data=await response.json();}catch{throw new MCSVError('unavailable');}
 if(data.ok!==true||!data.result||typeof data.result.game!=='string'||typeof data.result.server_type!=='string')throw new MCSVError('unverified');
 const server=data.result;
 return {compatible:server.game==='minecraft-bedrock'&&server.server_type==='endstone',server:{name:typeof server.name==='string'?server.name.slice(0,100):'MCSV',game:server.game,serverType:server.server_type,status:typeof server.status==='string'?server.status:'unknown'}};
}
