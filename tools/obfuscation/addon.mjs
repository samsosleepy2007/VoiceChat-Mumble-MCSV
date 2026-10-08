import {minify} from 'terser';
import fs from 'node:fs';
const source=fs.readFileSync('addon/BP/scripts/main.js','utf8');
const result=await minify(source,{module:true,compress:false,mangle:{toplevel:true,properties:false},format:{comments:/@license|@preserve|^!/,ascii_only:false},sourceMap:false});
fs.writeFileSync('obfuscator/addon/main.protected.js',result.code);
