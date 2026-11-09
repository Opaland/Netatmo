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

/** #236: an envelope or a keyinfo.json the app refuses to use (format, weak derivation). */
export class BadEnvelope extends Error {}

/** Envelope format written by collector/crypto.py. */
export const ENVELOPE_VERSION = 1;
export const KDF = 'PBKDF2-SHA256';
/** collector/crypto.py ITERATIONS: fewer would make the passphrase cheaper to guess (rekey error, tampering). */
export const MIN_ITERATIONS = 600_000;

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function checkIterations(iter: unknown) {
  if (typeof iter !== 'number' || !Number.isInteger(iter) || iter < MIN_ITERATIONS)
    throw new BadEnvelope(
      `Dérivation de clé trop faible (${String(iter)} itérations, minimum ${MIN_ITERATIONS.toLocaleString('fr-FR')}) : keyinfo.json a été modifié ou mal régénéré, relancez « rekey ».`,
    );
}

/** #236: refuses an unknown envelope version or KDF, and a weak iteration count, with a clear message. */
export function checkEnvelope(env: Envelope) {
  if (env?.v !== ENVELOPE_VERSION) throw new BadEnvelope(`Format de fichier chiffré inconnu (version ${String(env?.v)}) : mettez l'application à jour.`);
  if (env.kdf !== KDF) throw new BadEnvelope(`Dérivation de clé inconnue (${String(env.kdf)}).`);
  checkIterations(env.iter);
}

export async function deriveKey(passphrase: string, info: KeyInfo): Promise<CryptoKey> {
  checkIterations(info.iter);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(info.salt), iterations: info.iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: can be kept in IndexedDB without exposing the raw key
    ['decrypt', 'encrypt'], // encrypt: private notes kept on the device (S-4.10 absences)
  );
}

// No associated data (file name) in AES-GCM yet: binding it needs a v2 format written by the
// collector, and as long as v1 files are still read, a v1 file could replace a v2 one, so the
// binding would protect nothing. Deferred to a format change with a full rekey (README, sécurité).
export async function decryptEnvelope<T>(env: Envelope, key: CryptoKey): Promise<T> {
  checkEnvelope(env);
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
