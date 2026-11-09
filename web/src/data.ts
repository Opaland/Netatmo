// Fetching the encrypted files and remembering the derived key on this device.

import { type DayRecord, type Meta, toRecords } from './aggregate';
import { type Hourly, type TariffMap, type TrveRow, type Weather, parseTrveCsv } from './analysis';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';

export type Source = 'data' | 'demo';

export interface Dataset {
  source: Source;
  key: CryptoKey;
  meta: Meta;
  records: DayRecord[];
  tariffs: TariffMap;
  temps: Map<string, Map<string, [number, number | null]>>; // room -> day -> [measured, setpoint]
  weather: Weather | null;
  indoor: Map<string, number>;
  linky: Map<string, number>; // day -> kWh, whole home
  insights: Insights | null;
  estimated: Set<string>; // "room|day" rebuilt from a monthly total
  trve: TrveRow[]; // EDF regulated HP/HC tariff history (CRE open data)
}

/** Public CRE file, refreshed at each deploy; bundled copy as fallback. */
async function loadTrve(): Promise<TrveRow[]> {
  try {
    const resp = await fetch('tarifs/Option_HPHC.csv', { cache: 'no-cache' });
    if (!resp.ok || (resp.headers.get('content-type') ?? '').includes('text/html')) return [];
    return parseTrveCsv(await resp.text());
  } catch {
    return [];
  }
}

export interface Insights {
  generated: string;
  model: string;
  period: string;
  markdown: string;
  verified?: boolean;
  facts?: unknown;
}

interface YearDoc {
  daily?: Record<string, Record<string, number>>;
  tariffs?: Record<string, Record<string, [number, number, number]>>;
  temps?: Record<string, Record<string, [number, number | null]>>;
  estimated?: Record<string, Record<string, number>>;
}

export class NoData extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { cache: 'no-cache' });
  // 404 on GitHub Pages; dev/preview servers answer missing files with index.html.
  if (resp.status === 404 || (resp.headers.get('content-type') ?? '').includes('text/html')) throw new NoData(url);
  if (!resp.ok) throw new Error(`${url} : HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

async function optional<T>(source: Source, name: string, key: CryptoKey): Promise<T | null> {
  try {
    return await decryptEnvelope<T>(await getJson<Envelope>(`${source}/${name}.enc.json`), key);
  } catch (err) {
    if (err instanceof NoData) return null;
    throw err;
  }
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

const toMap2 = <V>(o: Record<string, Record<string, V>> | undefined, into: Map<string, Map<string, V>>) => {
  for (const [room, days] of Object.entries(o ?? {})) {
    const m = into.get(room) ?? new Map<string, V>();
    for (const [d, v] of Object.entries(days)) m.set(d, v);
    into.set(room, m);
  }
};

export async function load(source: Source, key: CryptoKey): Promise<Dataset> {
  const meta = await decryptEnvelope<Meta>(await getJson<Envelope>(`${source}/meta.enc.json`), key);
  const [years, weatherDoc, linkyDoc, insights, trve] = await Promise.all([
    Promise.all(
      meta.years.map(async (y) => {
        const doc = await decryptEnvelope<YearDoc>(await getJson<Envelope>(`${source}/${y}.enc.json`), key);
        return [String(y), doc] as const;
      }),
    ),
    optional<{ source?: string; outdoor?: Record<string, [number, number, number]>; indoor?: Record<string, number> }>(
      source,
      'weather',
      key,
    ),
    optional<{ daily?: Record<string, number> }>(source, 'linky', key),
    optional<Insights>(source, 'insights', key),
    loadTrve(),
  ]);
  const tariffs: TariffMap = new Map();
  const temps: Dataset['temps'] = new Map();
  const estimated = new Set<string>();
  for (const [, doc] of years) {
    toMap2(doc.tariffs, tariffs);
    toMap2(doc.temps, temps);
    for (const [room, days] of Object.entries(doc.estimated ?? {})) for (const d of Object.keys(days)) estimated.add(`${room}|${d}`);
  }
  // Tariff values are stored in Wh like everything else: convert to kWh once.
  for (const days of tariffs.values()) for (const [d, v] of days) days.set(d, [v[0] / 1000, v[1] / 1000, v[2] / 1000]);
  const outdoor = weatherDoc?.outdoor ? new Map(Object.entries(weatherDoc.outdoor)) : null;
  return {
    source,
    key,
    meta,
    records: toRecords(meta, Object.fromEntries(years.map(([y, d]) => [y, d.daily ?? {}]))),
    tariffs,
    temps,
    weather: outdoor && outdoor.size ? outdoor : null,
    indoor: new Map(Object.entries(weatherDoc?.indoor ?? {})),
    linky: new Map(Object.entries(linkyDoc?.daily ?? {}).map(([d, wh]) => [d, wh / 1000])),
    insights,
    estimated,
    trve,
  };
}

/** Hourly documents are big: loaded only when the hourly view opens. */
export async function loadHourly(ds: Dataset): Promise<Hourly> {
  const out: Hourly = new Map();
  const years = (ds.meta as Meta & { hourly_years?: number[] }).hourly_years ?? [];
  const docs = await Promise.all(
    years.map((y) => optional<{ hourly?: Record<string, Record<string, number>> }>(ds.source, `${y}.hourly`, ds.key)),
  );
  for (const doc of docs) {
    for (const [room, hours] of Object.entries(doc?.hourly ?? {})) {
      const m = out.get(room) ?? new Map<string, number>();
      for (const [h, wh] of Object.entries(hours)) m.set(h, wh / 1000);
      out.set(room, m);
    }
  }
  return out;
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
