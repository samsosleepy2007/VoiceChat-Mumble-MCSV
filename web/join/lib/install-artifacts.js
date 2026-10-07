import {fetchArtifacts} from './mcsv-install.js';
const RELEASE='https://github.com/samsosleepy2007/VoiceChat-Mumble-MCSV/releases/download/sleepymumla-v0.6.1/';
let pending;
export async function artifacts(){if(!pending)pending=fetchArtifacts(fetch,RELEASE).catch(error=>{pending=null;throw error;});return pending;}
