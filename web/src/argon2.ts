// #139: Argon2id key derivation (RFC 9106), loaded on demand by crypto.ts deriveKey for a data
// folder whose keyinfo.json is version 2. hash-wasm runs it in WebAssembly ('wasm-unsafe-eval' in
// the CSP of index.html); same key as argon2-cffi in the collector (__fixtures__/kdf-vector.json).
import { argon2id } from 'hash-wasm';

export async function argon2idKey(
  passphrase: string,
  salt: Uint8Array,
  params: { m: number; t: number; p: number },
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await argon2id({
    password: passphrase,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'binary',
  });
  const key = new Uint8Array(out); // a plain ArrayBuffer, as WebCrypto's importKey wants
  out.fill(0);
  return key;
}
