// #139 (B1): the private notes kept on this device (invoices, works, absences, appliances…) are
// sealed with the data key (crypto.ts sealLocal). A `rekey` draws a new salt and may change the
// derivation: with the SAME passphrase the key changes, and the notes would no longer open.
//
// So the device remembers the PUBLIC derivation parameters (salt + KDF, the content of
// keyinfo.json, no secret) with which its notes were sealed. At the next unlock with the
// passphrase, a note the new key cannot open is opened with the key re-derived from the same
// passphrase and those old parameters, then sealed again with the new key. When that fails too
// (the passphrase itself changed), the note is kept as it is, never overwritten (local-store.ts
// writeSealed), and the app says so (showUnreadableNotes) with a way to erase them on purpose.
import { type KeyInfo, deriveKey, keyInfoFields, openLocal, sealLocal } from './crypto';
import { plural } from './glossary';
import { NS } from './scope';

const paramsKey = (source: string) => `${NS}:sealed-with:${source}`;

type Sealed = { iv: string; ct: string };
const isSealed = (v: unknown): v is Sealed =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 2 && typeof (v as Sealed).iv === 'string' && typeof (v as Sealed).ct === 'string';

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: nothing kept, nothing lost */
  }
}

/** The sealed entries of one dataset on this device: `<NS>:<name>:<source>` holding exactly {iv, ct}. */
export function sealedEntries(source: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${NS}:`) || !k.endsWith(`:${source}`)) continue;
      try {
        if (isSealed(JSON.parse(get(k) ?? ''))) out.push(k);
      } catch {
        /* not JSON: not a sealed note */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/** True when `raw` is absent, not a sealed note, or opens with `key`: writing over it loses nothing. */
export async function opensWith(raw: string | null, key: CryptoKey): Promise<boolean> {
  if (!raw) return true;
  let sealed: unknown;
  try {
    sealed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!isSealed(sealed)) return true;
  try {
    await openLocal(sealed, key);
    return true;
  } catch {
    return false;
  }
}

/** Remember the derivation the notes of `source` are sealed with (public: salt and KDF). */
export function recordSealParams(source: string, info: KeyInfo) {
  try {
    set(paramsKey(source), JSON.stringify(keyInfoFields(info)));
  } catch {
    /* a keyinfo.json the app refuses: the unlock already said so */
  }
}

function recordedParams(source: string): KeyInfo | null {
  try {
    const raw = get(paramsKey(source));
    return raw ? keyInfoFields(JSON.parse(raw) as KeyInfo) : null;
  } catch {
    return null;
  }
}

let unreadable: { source: string; keys: string[] } = { source: '', keys: [] };

/**
 * After an unlock with the passphrase: notes sealed with the previous derivation are opened with
 * the key re-derived from the same passphrase and sealed again with `key`. Returns the notes that
 * open with neither (kept untouched). `derive` is injected by the tests.
 */
export async function migrateSealed(source: string, passphrase: string, info: KeyInfo, key: CryptoKey, derive = deriveKey): Promise<string[]> {
  const prev = recordedParams(source);
  const changed = !!prev && JSON.stringify(prev) !== JSON.stringify(keyInfoFields(info));
  let oldKey: Promise<CryptoKey | null> | null = null;
  const lost: string[] = [];
  for (const k of sealedEntries(source)) {
    const raw = get(k);
    if (await opensWith(raw, key)) continue;
    if (changed) {
      oldKey ??= derive(passphrase, prev!).catch(() => null);
      const old = await oldKey;
      if (old) {
        try {
          const value = await openLocal<unknown>(JSON.parse(raw!), old);
          set(k, JSON.stringify(await sealLocal(value, key)));
          continue;
        } catch {
          /* sealed with another passphrase: kept below */
        }
      }
    }
    lost.push(k);
  }
  recordSealParams(source, info);
  unreadable = { source, keys: lost };
  return lost;
}

/** Notes of `source` that the last unlock could not open (kept, never overwritten). */
export const unreadableNotes = (source: string) => (unreadable.source === source ? unreadable.keys : []);

/** Erase those notes, on the person's request only (the banner's button). */
export function eraseUnreadable(source: string) {
  for (const k of unreadableNotes(source)) set(k, null);
  unreadable = { source: '', keys: [] };
}

/** Agreement of the words around a count (the count itself: glossary.ts plural). */
const agree = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** The banner shown above the app while such notes exist (outside #app, like the update banner). */
export function showUnreadableNotes(source: string, doc: Document = document) {
  doc.getElementById('notes-banner')?.remove();
  const n = unreadableNotes(source).length;
  if (!n) return;
  const box = doc.createElement('div');
  box.id = 'notes-banner';
  box.className = 'update-banner';
  box.setAttribute('role', 'status');
  const p = doc.createElement('p');
  const strong = doc.createElement('strong');
  strong.textContent = `${plural(n, 'note gardée', 'notes gardées')} sur cet appareil ne ${agree(n, 's’ouvre', 's’ouvrent')} pas avec cette phrase de passe.`;
  // #518: shorter, and how to get it back (README, « Les notes de l'appareil »)
  p.append(
    strong,
    ` ${agree(n, 'Écrite', 'Écrites')} avec une autre phrase (factures, travaux, absences…), ${agree(n, 'elle est gardée telle quelle', 'elles sont gardées telles quelles')}. Pour ${agree(n, 'la', 'les')} retrouver : remettre les données d’avant le changement de clé (retour arrière), puis déverrouiller ici : guide du dépôt, « Les notes de l’appareil ». D’ici là, une nouvelle saisie du même genre ne dure que jusqu’au verrouillage.`,
  );
  const b = button(doc, 'notes-erase', 'btn secondary', agree(n, 'Effacer cette note…', 'Effacer ces notes…'));
  // #518: erasing is final (the note could still open after going back): asked again, in the
  // banner, with the destructive button of the design system; « Garder » takes the focus.
  const ask = doc.createElement('div');
  ask.id = 'notes-confirm';
  ask.className = 'notes-confirm';
  ask.hidden = true;
  ask.setAttribute('role', 'group');
  ask.setAttribute('aria-label', 'Confirmer l’effacement');
  const q = doc.createElement('p');
  q.textContent = `Effacer définitivement ? ${agree(n, 'Elle ne pourra plus être retrouvée', 'Elles ne pourront plus être retrouvées')}, même en revenant à l’ancienne phrase.`;
  const yes = button(doc, 'notes-erase-yes', 'btn danger', 'Effacer définitivement');
  const no = button(doc, 'notes-erase-no', 'btn secondary', 'Garder');
  ask.replaceChildren(q, yes, no);
  b.addEventListener('click', () => {
    ask.hidden = false;
    b.hidden = true;
    no.focus();
  });
  no.addEventListener('click', () => {
    ask.hidden = true;
    b.hidden = false;
    b.focus();
  });
  yes.addEventListener('click', () => {
    eraseUnreadable(source);
    box.remove();
  });
  box.replaceChildren(p, b, ask);
  doc.body.insertBefore(box, doc.getElementById('app'));
}

function button(doc: Document, id: string, cls: string, text: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.id = id;
  b.className = cls;
  b.textContent = text;
  return b;
}

export const hideUnreadableNotes = (doc: Document = document) => doc.getElementById('notes-banner')?.remove();
