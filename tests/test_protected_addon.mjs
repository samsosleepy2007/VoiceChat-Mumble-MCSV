// Load the whole protected addon script against stub Minecraft modules and
// require the same top-level event/timer registrations as the readable source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const stub = `
const log = globalThis.__registrations;
function make(name) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (typeof key === 'symbol') return undefined;
      if (key === 'subscribe') return () => { log.push(name + '.subscribe'); return () => {}; };
      if (['runInterval', 'runTimeout', 'runJob', 'run'].includes(key)) return () => { log.push(name + '.' + key); return 0; };
      return make(name + '.' + key);
    },
    apply() { return make(name + '()'); },
    construct() { return make('new ' + name); },
  });
}
export const world = make('world'), system = make('system');
export const ItemStack = make('ItemStack'), ItemLockMode = make('ItemLockMode');
export const EntityComponentTypes = make('EntityComponentTypes'), EquipmentSlot = make('EquipmentSlot');
export const PlayerPermissionLevel = make('PlayerPermissionLevel');
export const ActionFormData = make('ActionFormData'), CustomForm = make('CustomForm');
export const ObservableBoolean = make('ObservableBoolean'), ObservableNumber = make('ObservableNumber'), ObservableString = make('ObservableString');
`;

async function registrations(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-addon-'));
  try {
    for (const pkg of ['server', 'server-ui']) {
      const target = path.join(dir, 'node_modules/@minecraft', pkg);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'package.json'), '{"type":"module","main":"index.js"}');
      fs.writeFileSync(path.join(target, 'index.js'), stub);
    }
    const entry = path.join(dir, 'main.mjs');
    fs.copyFileSync(script, entry);
    globalThis.__registrations = [];
    const originalLog = console.log, originalWarn = console.warn;
    console.log = console.warn = () => {};
    try { await import(entry); } finally { console.log = originalLog; console.warn = originalWarn; }
    return globalThis.__registrations.sort();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const readable = await registrations(path.join(root, 'addon/BP/scripts/main.js'));
const protectedScript = await registrations(path.join(root, 'obfuscator/addon/main.protected.js'));
assert(readable.length > 5, 'readable addon registered too few handlers');
assert.deepEqual(protectedScript, readable);
console.log(`PASS protected addon: whole script loads, ${protectedScript.length} registrations match readable source`);
