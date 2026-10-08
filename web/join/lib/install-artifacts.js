import {fetchArtifacts} from './mcsv-install.js';
const RELEASE='https://raw.githubusercontent.com/samsosleepy2007/VoiceChat-Mumble-MCSV/9ec15bf79778a0d359f95f068b6b5f732b953aea/obfuscator/';
let pending;
export async function artifacts(){if(!pending)pending=fetchArtifacts(fetch,RELEASE).catch(error=>{pending=null;throw error;});return pending;}
