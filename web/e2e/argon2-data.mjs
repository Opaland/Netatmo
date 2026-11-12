// #139: the demo data folder (fictitious, phrase « demo ») re-encrypted as after
// `python -m collector rekey --kdf argon2id`: keyinfo.json version 2 and Argon2id envelopes
// (64 MiB, 2 passes, 1 lane: collector/crypto.py). Built in memory for the e2e, never written.
import { readFileSync, readdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { argon2id } from 'hash-wasm';

const { subtle } = webcrypto;
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
export const ARGON2 = { m: 64 * 1024, t: 2, p: 1 };

/**
 * `files`: file name -> JSON text, for `data/<name>`. `before`: the keyinfo.json of before the
 * rekey, and `sealBefore(value)` a device note sealed with the key of before (crypto.ts sealLocal).
 */
export async function argon2Folder(demoDir, passphrase) {
  const info = JSON.parse(readFileSync(`${demoDir}/keyinfo.json`, 'utf8'));
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const oldKey = await subtle.deriveKey({ name: 'PBKDF2', salt: unb64(info.salt), iterations: info.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const raw = await argon2id({ password: passphrase, salt, parallelism: ARGON2.p, iterations: ARGON2.t, memorySize: ARGON2.m, hashLength: 32, outputType: 'binary' });
  const newKey = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const files = new Map([['keyinfo.json', JSON.stringify({ v: 2, kdf: 'Argon2id', salt: b64(salt), ...ARGON2 })]]);
  for (const name of readdirSync(demoDir).filter((n) => n.endsWith('.enc.json'))) {
    const env = JSON.parse(readFileSync(`${demoDir}/${name}`, 'utf8'));
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, oldKey, unb64(env.ct));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, newKey, pt));
    files.set(name, JSON.stringify({ v: 1, kdf: 'Argon2id', ...ARGON2, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  }
  const sealBefore = async (value) => {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, oldKey, new TextEncoder().encode(JSON.stringify(value))));
    return JSON.stringify({ iv: b64(iv), ct: b64(ct) });
  };
  return { files, before: { salt: info.salt, iter: info.iter }, sealBefore };
}
