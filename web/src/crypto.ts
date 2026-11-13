// Decrypts the files written by collector/crypto.py (AES-256-GCM, key derived by PBKDF2-SHA256
// or, since #139, Argon2id; the Argon2id code is loaded on demand from ./argon2).
import { repoDoc } from './source-repo';

export interface Envelope {
  v: number;
  kdf: string;
  iter?: number; // PBKDF2
  m?: number; // Argon2id: memory (KiB), passes, lanes
  t?: number;
  p?: number;
  salt: string;
  iv: string;
  ct: string;
}

export type Argon2Info = { v: 2; kdf: 'Argon2id'; salt: string; m: number; t: number; p: number };
/** keyinfo.json: version 1 (PBKDF2, no "v") or version 2 (Argon2id, #139). */
export type KeyInfo = { salt: string; iter: number } | Argon2Info;

export class WrongPassphrase extends Error {}

/** #236: an envelope or a keyinfo.json the app refuses to use (format, weak derivation). */
export class BadEnvelope extends Error {}

/** #524: the page is not in a secure context (HTTP outside localhost): WebCrypto is absent. */
export class InsecureContext extends Error {}

export const INSECURE_DOC = repoDoc('docs/nas-copie-locale.md'); // #533: the guide of this copy (source-repo.ts)
export const INSECURE_MESSAGE =
  "Cette adresse n'est pas sécurisée (HTTP) : le navigateur refuse d'y déchiffrer les données. Ouvrez l'application en HTTPS ou sur localhost.";

/**
 * #524: WebCrypto (crypto.subtle) exists only in a secure context (HTTPS or localhost). Without
 * it every decryption fails with « Cannot read properties of undefined ». One check, read by the
 * lock screen before anything is typed and by every use of the key below (where the action is).
 * `g` is injected by the tests.
 */
export function insecureContext(g: { isSecureContext?: boolean; crypto?: { subtle?: unknown } } = globalThis): boolean {
  return g.isSecureContext === false || !g.crypto?.subtle;
}

function subtle(): SubtleCrypto {
  if (insecureContext()) throw new InsecureContext(INSECURE_MESSAGE);
  return crypto.subtle;
}

/** Envelope format written by collector/crypto.py. */
export const ENVELOPE_VERSION = 1;
export const KDF = 'PBKDF2-SHA256';
export const ARGON2 = 'Argon2id';
// #139: the same values as collector/kdf.json, which the collector reads (crypto.test.ts checks
// that they agree: one rule on both sides). The minimum is what the collector writes: fewer would
// make the passphrase cheaper to guess (rekey error, tampering); the maximum keeps a keyinfo.json
// from freezing the phone. One Argon2id lane only: the key must be the collector's.
export const MIN_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 2_000_000;
export const ARGON2_MIN = { m: 64 * 1024, t: 2, p: 1 } as const;
export const ARGON2_MAX = { m: 256 * 1024, t: 10 } as const;

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function checkIterations(iter: unknown) {
  if (typeof iter !== 'number' || !Number.isInteger(iter) || iter < MIN_ITERATIONS)
    throw new BadEnvelope(
      `Dérivation de clé trop faible (${String(iter)} itérations, minimum ${MIN_ITERATIONS.toLocaleString('fr-FR')}) : keyinfo.json a été modifié ou mal régénéré, relancez « rekey ».`,
    );
  if (iter > MAX_ITERATIONS)
    throw new BadEnvelope(
      `Dérivation de clé refusée (${String(iter)} itérations, maximum ${MAX_ITERATIONS.toLocaleString('fr-FR')}) : keyinfo.json a été modifié ou mal régénéré, relancez « rekey ».`,
    );
}

const intIn = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

function checkArgon2(o: { m?: unknown; t?: unknown; p?: unknown }) {
  if (!intIn(o.m, ARGON2_MIN.m, ARGON2_MAX.m) || !intIn(o.t, ARGON2_MIN.t, ARGON2_MAX.t) || o.p !== ARGON2_MIN.p)
    throw new BadEnvelope(
      `Paramètres Argon2id refusés (mémoire ${String(o.m)} Kio, ${String(o.t)} passes, parallélisme ${String(o.p)}) : keyinfo.json a été modifié ou mal régénéré, relancez « rekey ».`,
    );
}

/** #236: refuses an unknown envelope version or KDF, and a weak derivation, with a clear message. */
export function checkEnvelope(env: Envelope) {
  if (env?.v !== ENVELOPE_VERSION) throw new BadEnvelope(`Format de fichier chiffré inconnu (version ${String(env?.v)}) : mettez l'application à jour.`);
  if (env.kdf === ARGON2) return checkArgon2(env);
  if (env.kdf !== KDF) throw new BadEnvelope(`Dérivation de clé inconnue (${String(env.kdf)}).`);
  checkIterations(env.iter);
}

const isArgon2Info = (info: KeyInfo): info is Argon2Info => (info as { v?: unknown }).v === 2;

/** #139: a keyinfo.json, checked (version, derivation, bounds) before any derivation. */
export function checkKeyInfo(info: KeyInfo) {
  if (!info || typeof info !== 'object' || typeof info.salt !== 'string') throw new BadEnvelope('keyinfo.json illisible.');
  const v = (info as { v?: unknown }).v;
  if (v === undefined) return checkIterations((info as { iter?: unknown }).iter);
  if (v !== 2 || (info as { kdf?: unknown }).kdf !== ARGON2)
    throw new BadEnvelope(`keyinfo.json de version inconnue (${String(v)}) : mettez l'application à jour.`);
  checkArgon2(info as { m?: unknown; t?: unknown; p?: unknown });
}

/** The fields of a keyinfo.json, checked, and nothing else (backup: the file as the app reads it). */
export function keyInfoFields(info: KeyInfo): KeyInfo {
  checkKeyInfo(info);
  if (isArgon2Info(info)) return { v: 2, kdf: ARGON2, salt: info.salt, m: info.m, t: info.t, p: info.p };
  return { salt: info.salt, iter: info.iter };
}

/** The fields of an envelope for its derivation, and nothing else (backup). */
export function envelopeFields(env: Envelope): Envelope {
  const { v, kdf, salt, iv, ct } = env;
  return kdf === ARGON2 ? { v, kdf, m: env.m, t: env.t, p: env.p, salt, iv, ct } : { v, kdf, iter: env.iter, salt, iv, ct };
}

const AES = { name: 'AES-GCM', length: 256 } as const;
// Non-extractable: can be kept in IndexedDB without exposing the raw key.
// encrypt: private notes kept on the device (S-4.10 absences).
const USAGES: KeyUsage[] = ['decrypt', 'encrypt'];

export async function deriveKey(passphrase: string, info: KeyInfo): Promise<CryptoKey> {
  checkKeyInfo(info);
  subtle(); // #524: said before an Argon2id derivation of several seconds, not after
  if (isArgon2Info(info)) {
    // #139: hash-wasm (WebAssembly) is loaded only for a folder migrated to Argon2id, never with the first screen.
    const { argon2idKey } = await import('./argon2');
    const raw = await argon2idKey(passphrase, fromB64(info.salt), info);
    try {
      return await subtle().importKey('raw', raw, AES, false, USAGES);
    } finally {
      raw.fill(0);
    }
  }
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt: fromB64(info.salt), iterations: info.iter, hash: 'SHA-256' }, base, AES, false, USAGES);
}

// No associated data (file name) in AES-GCM yet: binding it needs a v2 format written by the
// collector, and as long as v1 files are still read, a v1 file could replace a v2 one, so the
// binding would protect nothing. Deferred to a format change with a full rekey (README, sécurité).
export async function decryptEnvelope<T>(env: Envelope, key: CryptoKey): Promise<T> {
  checkEnvelope(env);
  const api = subtle(); // #524: outside the try, an insecure page is not a wrong passphrase
  try {
    const pt = await api.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    throw new WrongPassphrase('Phrase de passe incorrecte');
  }
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Small private JSON kept on this device (localStorage), encrypted with the data key. */
export async function sealLocal(value: unknown, key: CryptoKey): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openLocal<T>(sealed: { iv: string; ct: string }, key: CryptoKey): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
