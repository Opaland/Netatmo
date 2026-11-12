// Fetching the encrypted files and remembering the derived key on this device.

import { type DayRecord, type Meta, toRecords } from './aggregate';
import { loadOffers, loadTempo } from './offers';
import { type Hourly, type TariffMap, type TempoRow, type TrveRow, type Weather, parseTrveCsv } from './analysis';
import type { ShellyDoc } from './breakdown';
import type { Coverage } from './checks';
import { type DevicesDoc, type StationHealth, type TempoCheck, fillTempo } from './devices';
import type { DayHours, Night, StationHourly } from './comfort';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';
import { migrateSealed, recordSealParams } from './sealed-notes';
import type { Room30, Room30Doc } from './room30';
import { type RememberedKey, freshKey } from './session';
import { askPersistence, writeMark } from './storage';
import { KEY_DB } from './scope';
import { track } from './ready';

export type Source = 'data' | 'demo';

/**
 * #353: folder of a source. In the demo only, `?fixture=<name>` in the address opens a named
 * test fixture (`demo-fixtures/<name>/`, made by `python -m collector fixtures` next to the build
 * for the end-to-end tests, never deployed). Real data always come from `data/`.
 */
export function dataDir(source: Source, search: string = typeof location === 'undefined' ? '' : location.search): string {
  if (source !== 'demo') return source;
  const name = new URLSearchParams(search).get('fixture');
  return name && /^[a-z0-9-]{1,40}$/.test(name) ? `demo-fixtures/${name}` : 'demo';
}

export interface Dataset {
  source: Source;
  key: CryptoKey;
  meta: Meta;
  records: DayRecord[];
  tariffs: TariffMap;
  temps: Map<string, Map<string, [number, number | null]>>; // room -> day -> [measured, setpoint]
  weather: Weather | null;
  /** S-3.12 (#221): day -> [mean wind km/h, gust km/h | null] and day -> rain mm (Open-Meteo). */
  wind?: Map<string, [number, number | null]>;
  rain?: Map<string, number>;
  /** #452: day -> global radiation MJ/m² (Open-Meteo), for the days with little sun. */
  sun?: Map<string, number>;
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
  shelly?: ShellyDoc | null; // S-1.17: Shelly plugs, daily Wh (small document)
  devices?: DevicesDoc | null; // v1.5: health of the devices (devices.enc.json, small document)
  pmaxAt?: Map<string, string>; // #219: day -> local HH:MM of the Linky peak
  linkyIndex?: Record<string, Record<string, number>>; // #277: rate period -> day -> index (Wh)
  tempoCheck?: TempoCheck; // #278: gateway colours vs the public Tempo calendar (days filled from the gateway)
  roomMap?: Map<string, string>; // S-12.2: rooms merged by the household view (hourly documents follow it)
}

export interface Station {
  modules: Record<string, { name: string; type: string; indoor: boolean }>;
  daily: Record<string, Record<string, [number, number, number, number | null, number | null]>>; // [min, max, mean, hum, co2]
  nightly?: Record<string, Record<string, Night>>; // module -> night D (22 h → 7 h) -> CO₂ hours (S-11.1)
  hours?: Record<string, Record<string, DayHours>>; // module -> day -> humid / cold hours (S-11.2, S-11.3)
  health?: StationHealth; // #215: module -> day -> [battery %, signal, answering]
  pressure?: Record<string, Record<string, [number, number | null, number | null, number | null]>>; // #220: [mean, min, max, trend] hPa
  noise?: Record<string, Record<string, { n: number; loud: number }>>; // #220 (opt-in): noisy hours per day
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
  pseudonyms?: Record<string, string>; // S-5.7: "Pièce A" -> real name, kept here, never sent
  usage?: InsightUsage; // S-5.8
}

export interface InsightUsage {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd: number;
  cost_eur: number;
  served_by?: string[];
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
    return await decryptEnvelope<T>(await getJson<Envelope>(`${dataDir(source)}/${name}.enc.json`), key);
  } catch (err) {
    if (err instanceof NoData) return null;
    throw err;
  }
}

export async function keyInfo(source: Source): Promise<KeyInfo> {
  return getJson<KeyInfo>(`${dataDir(source)}/keyinfo.json`);
}

export async function unlock(source: Source, passphrase: string): Promise<CryptoKey> {
  const info = await keyInfo(source);
  const key = await deriveKey(passphrase, info);
  // Validate immediately so a typo is reported on the unlock screen.
  await decryptEnvelope(await getJson<Envelope>(`${dataDir(source)}/meta.enc.json`), key);
  // #139: notes of this device sealed before a rekey are carried over to the new key (same passphrase).
  await migrateSealed(source, passphrase, info, key);
  return key;
}

/** #139: a remembered key opened the data: the device's notes are sealed with today's keyinfo.json. */
export async function noteSealParams(source: Source): Promise<void> {
  try {
    recordSealParams(source, await keyInfo(source));
  } catch {
    /* offline: recorded at the next unlock */
  }
}

const toMap2 = <V>(o: Record<string, Record<string, V>> | undefined, into: Map<string, Map<string, V>>) => {
  for (const [room, days] of Object.entries(o ?? {})) {
    const m = into.get(room) ?? new Map<string, V>();
    for (const [d, v] of Object.entries(days)) m.set(d, v);
    into.set(room, m);
  }
};

export async function load(source: Source, key: CryptoKey): Promise<Dataset> {
  const meta = await decryptEnvelope<Meta>(await getJson<Envelope>(`${dataDir(source)}/meta.enc.json`), key);
  const [years, weatherDoc, linkyDoc, insights, trve, station, offers, tempo, shelly, devices] = await Promise.all([
    Promise.all(
      meta.years.map(async (y) => {
        const doc = await decryptEnvelope<YearDoc>(await getJson<Envelope>(`${dataDir(source)}/${y}.enc.json`), key);
        return [String(y), doc] as const;
      }),
    ),
    optional<{
      source?: string;
      outdoor?: Record<string, [number, number, number]>;
      indoor?: Record<string, number>;
      wind?: Record<string, [number, number | null]>;
      rain?: Record<string, number>;
      sun?: Record<string, number>;
    }>(
      source,
      'weather',
      key,
    ),
    optional<{ daily?: Record<string, number>; pmax?: Record<string, number>; pmax_at?: Record<string, string>; index?: Record<string, Record<string, number>> }>(
      source,
      'linky',
      key,
    ),
    optional<Insights>(source, 'insights', key),
    loadTrve(),
    optional<Station>(source, 'station', key),
    loadOffers(),
    loadTempo(),
    optional<ShellyDoc>(source, 'shelly', key),
    optional<DevicesDoc>(source, 'devices', key),
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
  // #278: the gateway colour fills the days the public calendar lacks (only when both agree).
  const tempoCheck = fillTempo(tempo.days, devices?.tempo, meta.last_day ?? '9999-12-31');
  return {
    source,
    key,
    meta,
    records: toRecords(meta, Object.fromEntries(years.map(([y, d]) => [y, d.daily ?? {}]))),
    tariffs,
    temps,
    weather: outdoor && outdoor.size ? outdoor : null,
    wind: new Map(Object.entries(weatherDoc?.wind ?? {})),
    rain: new Map(Object.entries(weatherDoc?.rain ?? {})),
    sun: new Map(Object.entries(weatherDoc?.sun ?? {})),
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
    shelly,
    devices,
    pmaxAt: new Map(Object.entries(linkyDoc?.pmax_at ?? {})),
    linkyIndex: linkyDoc?.index,
    tempoCheck,
  };
}

// ------------------------------------------------------------ documents loaded on demand
// #255: the caches are keyed by the data key (shared by the raw dataset and its household
// view), so toggling the household view neither downloads nor decrypts anything again: the
// room merge of the hourly documents is applied afterwards. #232: emptied on lock.
type Cache<V> = WeakMap<CryptoKey, Map<string, Promise<V>>>;
let caches: { hourly: Cache<Hourly>; station: Cache<StationHourly>; roomState: Cache<import('./windows').RoomState | null>; curve: Cache<Map<string, number>>; ha: Cache<import('./ha').HaDoc | null>; room30: Cache<Room30>; volets: Cache<import('./shutters').VoletsDoc | null> };
/** Forget every decrypted document (on lock). */
export function clearDataCaches() {
  caches = { hourly: new WeakMap(), station: new WeakMap(), roomState: new WeakMap(), curve: new WeakMap(), ha: new WeakMap(), room30: new WeakMap(), volets: new WeakMap() };
  merged = new WeakMap();
}
let merged = new WeakMap<Hourly, WeakMap<Map<string, string>, Hourly>>();
clearDataCaches();

/** One load per (data key, name); a failed load is forgotten so that it can be tried again. */
function once<V>(cache: Cache<V>, ds: Dataset, name: string, fetch: () => Promise<V>): Promise<V> {
  let m = cache.get(ds.key);
  if (!m) cache.set(ds.key, (m = new Map()));
  let p = m.get(name);
  if (!p) {
    const own = m;
    p = track(fetch()); // #260: counted until settled (view ready signal)
    own.set(name, p);
    p.catch(() => own.get(name) === p && own.delete(name));
  }
  return p;
}

/**
 * Hourly documents are big (≈ 9 000 points per room and per year): loaded only when a view
 * needs them, once per dataset. `since` (YYYY-MM-DD) limits the load to the years from that
 * day on (#251): the Synthèse cards need 30 days, the Analyse 12 months; the research export
 * takes everything. A load already covering the asked years is reused.
 */
export function hourlyYears(ds: Dataset, since?: string): number[] {
  const all = (ds.meta as Meta & { hourly_years?: number[] }).hourly_years ?? [];
  const from = since ? Number(since.slice(0, 4)) : -Infinity;
  return all.filter((y) => y >= from);
}
export function loadHourly(ds: Dataset, since?: string): Promise<Hourly> {
  const years = hourlyYears(ds, since);
  let loads = caches.hourly.get(ds.key);
  if (!loads) caches.hourly.set(ds.key, (loads = new Map()));
  let p: Promise<Hourly> | undefined;
  for (const [k, q] of loads) {
    const have = new Set(k.split(','));
    if (years.every((y) => have.has(String(y)))) p = q;
  }
  p ??= once(caches.hourly, ds, years.join(','), () => fetchHourly(ds, years));
  return ds.roomMap?.size ? p.then((h) => mergeRooms(h, ds.roomMap!)) : p;
}

async function fetchHourly(ds: Dataset, years: number[]): Promise<Hourly> {
  const out: Hourly = new Map();
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

/** The household view of raw hourly data: merged rooms summed (once per raw data and room map). */
export function mergeRooms(h: Hourly, roomMap: Map<string, string>): Hourly {
  let per = merged.get(h);
  if (!per) merged.set(h, (per = new WeakMap()));
  let out = per.get(roomMap);
  if (out) return out;
  out = new Map();
  for (const [raw, hours] of h) {
    const room = roomMap.get(raw) ?? raw;
    if (room === raw) {
      out.set(room, hours);
      continue;
    }
    const m = new Map(out.get(room) ?? []);
    for (const [k, kwh] of hours) m.set(k, (m.get(k) ?? 0) + kwh);
    out.set(room, m);
  }
  per.set(roomMap, out);
  return out;
}

/** Station hourly readings (S-11): loaded only when the comfort view needs them. */
export function loadStationHourly(ds: Dataset): Promise<StationHourly> {
  return once(caches.station, ds, 'station', () => fetchStationHourly(ds));
}

async function fetchStationHourly(ds: Dataset): Promise<StationHourly> {
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

/** Daily room states from the hourly snapshots (E13, roomstate.enc.json), loaded on demand, once
 * per dataset (Confort, Analyse, Synthèse and the absences share it). */
export function loadRoomState(ds: Dataset): Promise<import('./windows').RoomState | null> {
  return once(caches.roomState, ds, 'roomstate', () => optional<import('./windows').RoomState>(ds.source, 'roomstate', ds.key));
}

/** Home Assistant daily aggregates (S-1.18, ha.enc.json), loaded on demand. */
export function loadHa(ds: Dataset): Promise<import('./ha').HaDoc | null> {
  return once(caches.ha, ds, 'ha', () => optional<import('./ha').HaDoc>(ds.source, 'ha', ds.key));
}

/** Shutter readings sent by the NAS (#200, volets.enc.json), loaded on demand; null without NAS. */
export function loadVolets(ds: Dataset): Promise<import('./shutters').VoletsDoc | null> {
  return once(caches.volets, ds, 'volets', () => optional<import('./shutters').VoletsDoc>(ds.source, 'volets', ds.key));
}

/** #204 + #356: solar.enc.json (location and production profile), null without one. Not
 * cached here: the views keep it with datasetDoc, forgotten on lock. */
export const loadSolarDoc = (ds: Dataset): Promise<unknown> => ((ds.meta as { has_solar?: boolean }).has_solar ? optional<unknown>(ds.source, 'solar', ds.key) : Promise.resolve(null));

/** Linky 30-min load curve (S-1.11), one document per year, loaded on demand, once per dataset
 * (the curve card and the breakdown card both need it). */
export function loadCurve(ds: Dataset): Promise<Map<string, number>> {
  return once(caches.curve, ds, 'curve', () => fetchCurve(ds));
}

async function fetchCurve(ds: Dataset): Promise<Map<string, number>> {
  const years = (ds.meta as Meta & { linky_curve_years?: number[] }).linky_curve_years ?? [];
  const docs = await Promise.all(years.map((y) => optional<{ curve?: Record<string, number> }>(ds.source, `${y}.linky30`, ds.key)));
  const out = new Map<string, number>();
  for (const doc of docs) for (const [k, wh] of Object.entries(doc?.curve ?? {})) out.set(k, wh);
  return out;
}

/**
 * Per-room half hours (S-1.26), one document per year (≈ 1.5 MB each): loaded only when a view
 * needs them, from the year of `since` on, once per dataset (a load covering the asked years is
 * reused). Raw rooms: the caller merges them for the household view if it shows energy.
 */
export function room30Years(ds: Dataset, since?: string): number[] {
  const from = since ? Number(since.slice(0, 4)) : -Infinity;
  return (ds.meta.room30_years ?? []).filter((y) => y >= from);
}
export function loadRoom30(ds: Dataset, since?: string): Promise<Room30> {
  const years = room30Years(ds, since);
  for (const [k, q] of caches.room30.get(ds.key) ?? []) {
    const have = new Set(k.split(','));
    if (years.every((y) => have.has(String(y)))) return q;
  }
  return once(caches.room30, ds, years.join(','), async () => {
    const docs = await Promise.all(years.map((y) => optional<Room30Doc>(ds.source, `${y}.room30`, ds.key)));
    return (await import('./room30')).mergeDocs(docs);
  });
}

// ------------------------------------------------------------ remembered key (IndexedDB)
// #229: scoped to the app's path (scope.ts).
const DB = KEY_DB;
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
    // S-7.9: remember that a key was kept (date only) and ask the browser not to evict it.
    writeMark({ source, at: now });
    void askPersistence();
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
  writeMark(null); // forgotten on purpose: no "erased by the browser" message next time
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
