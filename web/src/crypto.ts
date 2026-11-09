// Decrypts the files written by collector/crypto.py (AES-256-GCM, PBKDF2-SHA256 key).

export interface Envelope {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface KeyInfo {
  salt: string;
  iter: number;
}

export class WrongPassphrase extends Error {}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(passphrase: string, info: KeyInfo): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(info.salt), iterations: info.iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: can be kept in IndexedDB without exposing the raw key
    ['decrypt', 'encrypt'], // encrypt: private notes kept on the device (S-4.10 absences)
  );
}

export async function decryptEnvelope<T>(env: Envelope, key: CryptoKey): Promise<T> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    throw new WrongPassphrase('Phrase de passe incorrecte');
  }
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Small private JSON kept on this device (localStorage), encrypted with the data key. */
export async function sealLocal(value: unknown, key: CryptoKey): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openLocal<T>(sealed: { iv: string; ct: string }, key: CryptoKey): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
