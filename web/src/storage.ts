// S-7.9: storage eviction (Safari iOS above all). iOS may erase a site's IndexedDB, where
// the remembered key lives, after some days without use or when space runs short. Without
// a word, the user would think the data lost: it is not (it stays encrypted in the
// repository), only the key on this device is gone.
//
// - When the key is remembered, a small mark (the date only, no secret) is written to
//   localStorage and the browser is asked to keep the site's storage (storage.persist()).
// - At start-up, a mark without its key means the key was erased by the browser (or has
//   expired): the lock screen says so, and asks for the passphrase again.
// - Locking on purpose forgets the key and the mark together: no message then.
import { lsKey } from './scope';

export const REMEMBER_MARK = lsKey('remembered');

export interface RememberMark {
  source: string;
  at: number; // ms, when the key was remembered
}

export type KeyLoss = 'evicted' | 'expired' | null;

/** Why a remembered key is missing: erased by the browser, expired, or never remembered. */
export function keyLoss(mark: RememberMark | null, keyFound: boolean, now: number, rememberDays: number): KeyLoss {
  if (keyFound || !mark || typeof mark.at !== 'number') return null;
  if (now - mark.at > rememberDays * 86_400_000) return 'expired';
  return 'evicted';
}

/** iPhone / iPad (iPadOS presents itself as a Mac with a touch screen). */
export function isIos(ua: string, touchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Message of the lock screen for a lost key. */
export function lossMessage(loss: KeyLoss, ios: boolean): string {
  if (loss === 'evicted') {
    return `${ios ? 'iOS' : 'Le navigateur'} a effacé la clé, vos données sont intactes : elles restent chiffrées dans le dépôt, seule la clé mémorisée sur cet appareil a disparu. Ressaisissez la phrase de passe.`;
  }
  if (loss === 'expired') return 'La mémorisation de 30 jours a expiré : ressaisissez la phrase de passe. Vos données sont intactes.';
  return '';
}

export function readMark(): RememberMark | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_MARK) ?? 'null');
    return v && typeof v === 'object' && typeof v.at === 'number' && typeof v.source === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function writeMark(mark: RememberMark | null) {
  try {
    if (mark) localStorage.setItem(REMEMBER_MARK, JSON.stringify(mark));
    else localStorage.removeItem(REMEMBER_MARK);
  } catch {
    /* storage unavailable: no message after an eviction, nothing worse */
  }
}

/**
 * Ask the browser to keep this site's storage (no prompt on Safari, Chrome decides on its
 * own). Returns the answer, or null when the API is missing.
 */
export async function askPersistence(nav: { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } } = navigator): Promise<boolean | null> {
  try {
    if (!nav.storage?.persist) return null;
    if (nav.storage.persisted && (await nav.storage.persisted())) return true;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}
