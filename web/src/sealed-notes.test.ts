// #139 (B1): the notes kept on this device survive a rekey (same passphrase, new salt or new
// derivation), and a note no key opens any more is kept, never overwritten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Argon2Info, type KeyInfo, deriveKey, sealLocal } from './crypto';
import { loadNote, noteKey, saveNote, writeSealed } from './local-store';
import { NS } from './scope';
import { eraseUnreadable, migrateSealed, recordSealParams, sealedEntries, unreadableNotes } from './sealed-notes';
import vector from './__fixtures__/kdf-vector.json';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const PASS = vector.passphrase;
const before: KeyInfo = { salt: btoa('sel-avant-rekey!'), iter: 600_000 }; // PBKDF2, as today
const after = vector.keyinfo as Argon2Info; // after `rekey --kdf argon2id`, same passphrase
const ID = (v: unknown) => v;

let store: Storage;
beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});
afterEach(() => vi.unstubAllGlobals());

describe('#139 notes de cet appareil après un rekey', () => {
  it('même phrase, nouveau sel et Argon2id : les notes sont rescellées avec la nouvelle clé, rien ne se perd', async () => {
    const k1 = await deriveKey(PASS, before);
    recordSealParams('data', before); // recorded at an earlier unlock
    await saveNote('invoices', 'data', k1, [{ kwh: 1234 }]);
    await writeSealed(`${NS}:absences:data`, k1, { days: ['2026-01-02'] });
    store.setItem(`${NS}:theme`, 'sombre'); // not a sealed note: left alone

    const k2 = await deriveKey(PASS, after);
    expect(await loadNote('invoices', 'data', k2, ID, 'perdu')).toBe('perdu'); // the new key alone cannot open it
    expect(await migrateSealed('data', PASS, after, k2)).toEqual([]);
    expect(await loadNote('invoices', 'data', k2, ID, 'perdu')).toEqual([{ kwh: 1234 }]);
    expect(await loadNote('absences', 'data', k2, ID, 'perdu')).toEqual({ days: ['2026-01-02'] });
    expect(store.getItem(`${NS}:theme`)).toBe('sombre');
    expect(unreadableNotes('data')).toEqual([]);
    // the next unlock derives nothing more: the parameters recorded are today's
    const derive = vi.fn(deriveKey);
    expect(await migrateSealed('data', PASS, after, k2, derive)).toEqual([]);
    expect(derive).not.toHaveBeenCalled();
  });

  it('phrase changée : la note illisible est gardée telle quelle, jamais écrasée, et signalée', async () => {
    const k1 = await deriveKey('ancienne phrase fictive', before);
    recordSealParams('data', before);
    await saveNote('works', 'data', k1, { done: ['isolation'] });
    const raw = store.getItem(noteKey('works', 'data'));

    const other: KeyInfo = { salt: btoa('sel-tout-nouveau'), iter: 600_000 };
    const k3 = await deriveKey('nouvelle phrase fictive', other);
    expect(await migrateSealed('data', 'nouvelle phrase fictive', other, k3)).toEqual([noteKey('works', 'data')]);
    expect(unreadableNotes('data')).toEqual([noteKey('works', 'data')]);
    expect(await loadNote('works', 'data', k3, ID, 'repli')).toBe('repli');
    expect(await saveNote('works', 'data', k3, { done: [] })).toBe(false); // the view says « jusqu'au verrouillage »
    expect(store.getItem(noteKey('works', 'data'))).toBe(raw);
    // erased only on request (the banner's button), then saving works again
    eraseUnreadable('data');
    expect(store.getItem(noteKey('works', 'data'))).toBeNull();
    expect(await saveNote('works', 'data', k3, { done: [] })).toBe(true);
  });

  it('sans paramètres retenus (version d’avant #139) : rien n’est écrasé, la note est signalée', async () => {
    const k1 = await deriveKey(PASS, before);
    await saveNote('invoices', 'data', k1, [1]);
    const k2 = await deriveKey(PASS, after);
    expect(await migrateSealed('data', PASS, after, k2)).toEqual([noteKey('invoices', 'data')]);
    expect(await writeSealed(noteKey('invoices', 'data'), k2, [2])).toBe(false);
    expect(await loadNote('invoices', 'data', k1, ID, null)).toEqual([1]);
  });

  it('ne regarde que les notes du jeu ouvert (la démo garde les siennes)', async () => {
    const k = await deriveKey(PASS, before);
    store.setItem(`${NS}:invoices:demo`, JSON.stringify(await sealLocal([1], k)));
    store.setItem(`${NS}:invoices:data`, JSON.stringify(await sealLocal([2], k)));
    store.setItem(`${NS}:prefs:data`, JSON.stringify({ iv: 'x', ct: 'y', other: 1 }));
    expect(sealedEntries('data')).toEqual([`${NS}:invoices:data`]);
  });
});
