// Fetching the encrypted files and remembering the derived key on this device.

import { type DayRecord, type Meta, toRecords } from './aggregate';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';

export type Source = 'data' | 'demo';

export interface Dataset {
  source: Source;
  meta: Meta;
  records: DayRecord[];
}

export class NoData extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (resp.status === 404) throw new NoData(url);
  if (!resp.ok) throw new Error(`${url} : HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function keyInfo(source: Source): Promise<KeyInfo> {
  return getJson<KeyInfo>(`${source}/keyinfo.json`);
}

export async function unlock(source: Source, passphrase: string): Promise<CryptoKey> {
  const key = await deriveKey(passphrase, await keyInfo(source));
  // Validate immediately so a typo is reported on the unlock screen.
  await decryptEnvelope(await getJson<Envelope>(`${source}/meta.enc.json`), key);
  return key;
}

export async function load(source: Source, key: CryptoKey): Promise<Dataset> {
  const meta = await decryptEnvelope<Meta>(await getJson<Envelope>(`${source}/meta.enc.json`), key);
  const years = await Promise.all(
    meta.years.map(async (y) => {
      const env = await getJson<Envelope>(`${source}/${y}.enc.json`);
      const { daily } = await decryptEnvelope<{ daily: Record<string, Record<string, number>> }>(env, key);
      return [String(y), daily] as const;
    }),
  );
  return { source, meta, records: toRecords(meta, Object.fromEntries(years)) };
}

// ------------------------------------------------------------ remembered key (IndexedDB)
const DB = 'intuis-history';
const STORE = 'keys';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberKey(source: Source, key: CryptoKey): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(key, source));
  } catch {
    /* private browsing: just don't remember */
  }
}

export async function recallKey(source: Source): Promise<CryptoKey | null> {
  try {
    return ((await tx('readonly', (s) => s.get(source))) as CryptoKey | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function forgetKeys(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
