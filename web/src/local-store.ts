// Private notes kept on this device only (v1.4: invoices S-2.3, surfaces and works S-6.2),
// encrypted with the data key (AES-GCM, crypto.ts sealLocal) before they reach localStorage.
// Nothing is sent anywhere; another device or another passphrase does not see them.
import { openLocal, sealLocal } from './crypto';

/** Key of a note for one dataset (real data and demo never mix). */
export const noteKey = (name: string, source: string) => `intuis-history:${name}:${source}`;

/** The decrypted note, validated, or `fallback` (absent, unreadable or written with another passphrase). */
export async function loadNote<T>(name: string, source: string, key: CryptoKey, validate: (v: unknown) => T, fallback: T): Promise<T> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(noteKey(name, source));
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    return validate(await openLocal<unknown>(JSON.parse(raw), key));
  } catch {
    return fallback;
  }
}

/**
 * Encrypt and save. False when it could not be saved (key remembered by an older version
 * without the encrypt usage, private browsing, storage full): the note then lasts until locking.
 */
export async function saveNote(name: string, source: string, key: CryptoKey, value: unknown): Promise<boolean> {
  try {
    localStorage.setItem(noteKey(name, source), JSON.stringify(await sealLocal(value, key)));
    return true;
  } catch {
    return false;
  }
}
