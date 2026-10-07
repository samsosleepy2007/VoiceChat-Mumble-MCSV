import { headers, configured, session, ORIGIN } from '../../lib/auth.js';
export default async function handler(req,res){headers(res);if(req.method!=='POST')return res.status(405).end();if(req.headers.origin!==ORIGIN)return res.status(403).json({error:'Forbidden'});if(configured()){const s=await session(req,res);s.destroy();}res.status(200).json({ok:true});}
