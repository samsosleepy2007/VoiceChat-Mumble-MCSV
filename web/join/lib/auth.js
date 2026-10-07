import { getIronSession } from 'iron-session';
import { Discord } from 'arctic';
export const ORIGIN = 'https://sleepyvoice-join.vercel.app';
export const configured = () => Boolean(process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_CLIENT_ID && process.env.SESSION_SECRET?.length >= 32);
export function headers(res) { res.setHeader('Cache-Control','no-store, private'); res.setHeader('Vary','Cookie'); }
export function safeReturn(value) { try { const u = new URL(value || '/', ORIGIN); return u.origin === ORIGIN && ['/', '/join', '/join/', '/install', '/install/', '/history'].includes(u.pathname) && !u.username && !u.password ? u.pathname + u.hash : '/'; } catch { return '/'; } }
export function session(req,res,transaction=false) { return getIronSession(req,res,{password:process.env.SESSION_SECRET,cookieName:transaction?'__Host-sleepy_oauth':'__Host-sleepy_session',ttl:transaction?600:86400,cookieOptions:{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:transaction?600:86400}}); }
export function provider() { return new Discord(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_CLIENT_SECRET,ORIGIN+'/api/auth/discord/callback'); }
export function redirect(res,path) { res.statusCode=302;res.setHeader('Location',path);res.end(); }
