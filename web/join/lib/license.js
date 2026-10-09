// Signs an install license bound to one MCSV/Pelican server. The private key lives only in
// LICENSE_PRIVATE_KEY (Vercel env, PKCS8 base64); the plugin ships the matching public key and
// verifies the signature, so a copied plugin on another server fails.
import { createPrivateKey, sign as edSign } from 'node:crypto';

export const FORMAT = 'sleepymumla-license-1';
export const LICENSE_USERS = 99;

export function licenseMessage(server, port, users, issued) {
  return Buffer.from(`${FORMAT}\nserver=${server}\nport=${port}\nusers=${users}\nissued=${issued}\n`, 'utf8');
}

export function licenseEnabled(env = process.env) {
  return typeof env.LICENSE_PRIVATE_KEY === 'string' && env.LICENSE_PRIVATE_KEY.length > 0;
}

function privateKey(env) {
  try {
    return createPrivateKey({ key: Buffer.from(env.LICENSE_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error('license_key_invalid');
  }
}

export function signLicense({ server, port, users = LICENSE_USERS, issued }, env = process.env) {
  if (!/^[0-9a-f]{8}$/.test(server)) throw new Error('license_server');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('license_port');
  if (!Number.isInteger(users) || users < 1 || users > 500) throw new Error('license_users');
  if (typeof issued !== 'string' || !issued || issued.length > 40 || issued.includes('\n')) throw new Error('license_issued');
  const signature = edSign(null, licenseMessage(server, port, users, issued), privateKey(env));
  return JSON.stringify({ format: FORMAT, server, port, users, issued, signature: signature.toString('base64') });
}

export function issuedToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
