// Fetching the encrypted files and remembering the derived key on this device.

import { type DayRecord, type Meta, toRecords } from './aggregate';
import { loadOffers, loadTempo } from './offers';
import { type Hourly, type TariffMap, type TempoRow, type TrveRow, type Weather, parseTrveCsv } from './analysis';
import type { Coverage } from './checks';
import type { DayHours, Night, StationHourly } from './comfort';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';
import { type RememberedKey, freshKey } from './session';

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
  coverage: Coverage | null; // room -> "YYYY-MM" -> [real, estimated, missing] days, from the collector (S-1.10)
  trve: TrveRow[]; // EDF regulated HP/HC tariff history (CRE open data)
  offers: Map<string, TrveRow[]>; // price history per supplier offer
  pmax: Map<string, number>; // day -> max power drawn (kVA), Linky
  tempo: { rows: TempoRow[]; days: Map<string, number> };
  station: Station | null;
}

export interface Station {
  modules: Record<string, { name: string; type: string; indoor: boolean }>;
  daily: Record<string, Record<string, [number, number, number, number | null, number | null]>>; // [min, max, mean, hum, co2]
  nightly?: Record<string, Record<string, Night>>; // module -> night D (22 h → 7 h) -> CO₂ hours (S-11.1)
  hours?: Record<string, Record<string, DayHours>>; // module -> day -> humid / cold hours (S-11.2, S-11.3)
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
  coverage?: Record<string, Record<string, [number, number, number]>>;
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
  const [years, weatherDoc, linkyDoc, insights, trve, station, offers, tempo] = await Promise.all([
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
    optional<{ daily?: Record<string, number>; pmax?: Record<string, number> }>(source, 'linky', key),
    optional<Insights>(source, 'insights', key),
    loadTrve(),
    optional<Station>(source, 'station', key),
    loadOffers(),
    loadTempo(),
  ]);
  const tariffs: TariffMap = new Map();
  const temps: Dataset['temps'] = new Map();
  const estimated = new Set<string>();
  let coverage: Coverage | null = null;
  for (const [, doc] of years) {
    if (doc.coverage) {
      coverage ??= new Map();
      for (const [room, months] of Object.entries(doc.coverage)) {
        const m = coverage.get(room) ?? new Map<string, [number, number, number]>();
        for (const [k, v] of Object.entries(months)) m.set(k, v);
        coverage.set(room, m);
      }
    }
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
    coverage,
    trve,
    offers,
    tempo,
    pmax: new Map(Object.entries(linkyDoc?.pmax ?? {})),
    station: station?.daily && Object.keys(station.daily).length ? station : null,
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

/** Station hourly readings (S-11): loaded only when the comfort view needs them. */
export async function loadStationHourly(ds: Dataset): Promise<StationHourly> {
  const out: StationHourly = new Map();
  const docs = await Promise.all(
    (ds.meta.station_hourly_years ?? []).map((y) =>
      optional<{ hourly?: Record<string, Record<string, [number | null, number | null, number | null]>> }>(ds.source, `${y}.station_h`, ds.key),
    ),
  );
  for (const doc of docs) {
    for (const [mod, hours] of Object.entries(doc?.hourly ?? {})) {
      const m = out.get(mod) ?? new Map();
      for (const [h, v] of Object.entries(hours)) m.set(h, v);
      out.set(mod, m);
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

/** S-8.11: the key is kept with the date it was remembered (REMEMBER_DAYS at most). */
export async function rememberKey(source: Source, key: CryptoKey, now = Date.now()): Promise<void> {
  try {
    const entry: RememberedKey = { key, at: now };
    await tx('readwrite', (s) => s.put(entry, source));
  } catch {
    /* private browsing: just don't remember */
  }
}

/** The remembered key, or null; an expired (or undated, v1.2) key is forgotten. */
export async function recallKey(source: Source, now = Date.now()): Promise<CryptoKey | null> {
  try {
    const entry = await tx('readonly', (s) => s.get(source));
    const key = freshKey(entry, now);
    if (!key && entry !== undefined) await tx('readwrite', (s) => s.delete(source));
    return key;
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
