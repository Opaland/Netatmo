// #204 + #356: the home's location (typed by the owner, kept encrypted) and the « Panneaux
// solaires » simulator. Pure functions: no DOM, no state, unit-tested (solar.test.ts) and fuzzed
// (fuzz.test.ts: parseLocation, parsePvgisFile, parseSolarDoc).
//
// Privacy (#204, #261): the location is the most sensitive datum of the project. It is written
// only to the repository SECRET HOME_LOCATION_JSON (sealed in the browser), copied by the nightly
// collection into the encrypted solar.enc.json, and sent to PVGIS rounded to 0.01° (≈ 1 km).
// Nothing here logs, exports or puts it in an address.
//
// Simulation (#356): the real Linky curve at the half hour, confronted with a production profile
// (PVGIS hourly year, per kWc), for a few sizes and four scenarios. Every price and efficiency
// comes from the owner (SolarAssumptions): none is written here.
import { type Curve, halfHourCounts, localMidnight } from './curve';

// ------------------------------------------------------------------ the home's location
/** One roof that could carry panels. Azimuth: compass degrees (0 north, 90 east, 180 south). */
export interface Roof {
  name: string;
  azimuth: number;
  tilt: number; // degrees from horizontal
  kwc: number; // peak power the roof can carry
  loss: number; // % lost: cables, inverter, near shading (« masques »)
}

/** Decimals kept on the coordinates: 1 ≈ 10 km (the commune), 2 ≈ 1 km, 3 ≈ 100 m. */
export const PRECISIONS = { 1: 'à la commune près (≈ 10 km)', 2: 'à environ 1 km', 3: 'à environ 100 m' } as const;
export type Precision = 1 | 2 | 3;

export interface HomeLocation {
  v: 1;
  lat: number;
  lon: number;
  precision: Precision;
  commune: string; // free label, may be empty
  roofs: Roof[];
}

export const MAX_ROOFS = 6;
export const NAME_MAX = 40;
export const COMMUNE_MAX = 60;
/** Decimals sent to a third party (PVGIS): never finer than ≈ 1 km (#204). */
export const THIRD_PARTY_DECIMALS = 2;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
/** Printable text: control characters dropped, spaces folded, trimmed, cut at `max`. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  // never half of a UTF-16 pair at the cut
  return Array.from(s).slice(0, max).join('');
}
const own = (o: object, k: string): unknown => (Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);
const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A roof as typed or read back, or null when a field is missing or out of range. */
export function parseRoof(v: unknown): Roof | null {
  if (!isObj(v)) return null;
  const name = cleanText(own(v, 'name'), NAME_MAX);
  const azimuth = num(own(v, 'azimuth'));
  const tilt = num(own(v, 'tilt'));
  const kwc = num(own(v, 'kwc'));
  const loss = num(own(v, 'loss'));
  if (!name || azimuth === null || tilt === null || kwc === null || loss === null) return null;
  if (azimuth < 0 || azimuth >= 360 || tilt < 0 || tilt > 90 || kwc <= 0 || kwc > 36 || loss < 0 || loss > 60) return null;
  return { name, azimuth: Math.round(azimuth), tilt: Math.round(tilt), kwc: round(kwc, 2), loss: round(loss, 1) };
}

/**
 * The location as stored (HOME_LOCATION_JSON, solar.enc.json) or typed, or null. Same rules as
 * the collector (collector/solar.py parse_location), both checked against
 * web/src/__fixtures__/home-location.json.
 */
export function parseLocation(v: unknown): HomeLocation | null {
  if (!isObj(v)) return null;
  if (own(v, 'v') !== 1) return null;
  const p = own(v, 'precision');
  if (p !== 1 && p !== 2 && p !== 3) return null;
  const lat = num(own(v, 'lat'));
  const lon = num(own(v, 'lon'));
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const commune = own(v, 'commune') === undefined ? '' : cleanText(own(v, 'commune'), COMMUNE_MAX);
  if (commune === null) return null;
  const rawRoofs = own(v, 'roofs');
  if (!Array.isArray(rawRoofs) || !rawRoofs.length || rawRoofs.length > MAX_ROOFS) return null;
  const roofs = rawRoofs.map(parseRoof);
  if (roofs.some((r) => r === null)) return null;
  return { v: 1, lat: round(lat, p), lon: round(lon, p), precision: p, commune, roofs: roofs as Roof[] };
}

/** The JSON written to the secret: fixed key order, so that two equal locations compare equal. */
export function locationJson(l: HomeLocation): string {
  return JSON.stringify({
    v: 1,
    lat: l.lat,
    lon: l.lon,
    precision: l.precision,
    commune: l.commune,
    roofs: l.roofs.map((r) => ({ name: r.name, azimuth: r.azimuth, tilt: r.tilt, kwc: r.kwc, loss: r.loss })),
  });
}

/** Compass azimuth in words, for the form and the hypotheses (« sud-est »). */
export function azimuthWord(a: number): string {
  const words = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  return words[Math.round((((a % 360) + 360) % 360) / 45) % 8];
}

/** PVGIS azimuth (« aspect »): 0 south, −90 east, 90 west. */
export const pvgisAspect = (compass: number) => (((Math.round(compass) - 180 + 540) % 360) - 180);

// ------------------------------------------------------------------ production profiles
/** Wh produced per kWc, per UTC hour, for each day of a typical year (« MM-DD » → 24 values). */
export type HourProfile = Record<string, number[]>;

export interface ProfileRoof {
  name: string;
  kwc: number;
  hours: HourProfile;
}
/** solar.enc.json (collector) or an imported PVGIS file (kept encrypted on this device). */
export interface SolarDoc {
  source: 'pvgis' | 'import' | 'demo';
  year: number | null; // year of the weather behind the profile
  database: string; // e.g. PVGIS-SARAH3
  fetched: string; // YYYY-MM-DD
  location: HomeLocation | null; // absent for an imported file
  roofs: ProfileRoof[];
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** At most this many Wh per kWc in one hour (a kWc gives ≈ 1 kW in full sun). */
const MAX_WH_PER_KWC_HOUR = 1500;

function parseHours(v: unknown): HourProfile | null {
  if (!isObj(v)) return null;
  const out: HourProfile = {};
  for (const k of Object.keys(v)) {
    if (!MMDD.test(k)) continue;
    const row = own(v, k);
    if (!Array.isArray(row) || row.length !== 24) continue;
    const vals = row.map((x) => num(x));
    if (vals.some((x) => x === null || x < 0 || x > MAX_WH_PER_KWC_HOUR)) continue;
    Object.defineProperty(out, k, { value: vals as number[], enumerable: true, writable: true, configurable: true });
  }
  return Object.keys(out).length >= 300 ? out : null;
}

/** The decrypted solar document, validated (a broken one is null, never an exception). */
export function parseSolarDoc(v: unknown): SolarDoc | null {
  if (!isObj(v)) return null;
  const source = own(v, 'source');
  if (source !== 'pvgis' && source !== 'import' && source !== 'demo') return null;
  const rawRoofs = own(v, 'roofs');
  if (!Array.isArray(rawRoofs) || !rawRoofs.length || rawRoofs.length > MAX_ROOFS) return null;
  const roofs: ProfileRoof[] = [];
  for (const r of rawRoofs) {
    if (!isObj(r)) return null;
    const name = cleanText(own(r, 'name'), NAME_MAX);
    const kwc = num(own(r, 'kwc'));
    const hours = parseHours(own(r, 'hours'));
    if (!name || kwc === null || kwc <= 0 || kwc > 36 || !hours) return null;
    roofs.push({ name, kwc, hours });
  }
  const year = num(own(v, 'year'));
  const fetched = own(v, 'fetched');
  return {
    source,
    year: year !== null && Number.isInteger(year) && year > 1990 && year < 2100 ? year : null,
    database: cleanText(own(v, 'database'), 40) ?? '',
    fetched: typeof fetched === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fetched) ? fetched : '',
    location: parseLocation(own(v, 'location')),
    roofs,
  };
}

/**
 * A PVGIS « hourly data » file downloaded by the owner (re.jrc.ec.europa.eu, CSV or JSON), as one
 * profile per kWc. Only the hourly power and the nominal power are read: the latitude and the
 * longitude the file carries are NOT kept. Several years are averaged day by day.
 * Returns an error message (French, shown as is) when the file is not one.
 */
export function parsePvgisFile(text: unknown): { roof: ProfileRoof; year: number | null; database: string } | { error: string } {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Fichier vide.' };
  if (text.length > 20_000_000) return { error: 'Fichier trop gros pour un relevé PVGIS.' };
  let peak: number | null = null;
  let database = '';
  const series: [string, number][] = []; // « YYYYMMDD:HHMM », W
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      return { error: 'JSON illisible.' };
    }
    const inputs = isObj(doc) ? own(doc, 'inputs') : undefined;
    const module = isObj(inputs) ? own(inputs, 'pv_module') : undefined;
    peak = isObj(module) ? num(own(module, 'peak_power')) : null;
    const meteo = isObj(inputs) ? own(inputs, 'meteo_data') : undefined;
    database = (isObj(meteo) && cleanText(own(meteo, 'radiation_db'), 40)) || '';
    const outputs = isObj(doc) ? own(doc, 'outputs') : undefined;
    const hourly = isObj(outputs) ? own(outputs, 'hourly') : undefined;
    if (!Array.isArray(hourly)) return { error: 'Ce JSON n’a pas de production horaire (outputs.hourly) : choisissez « Données horaires » dans PVGIS.' };
    for (const h of hourly) {
      if (!isObj(h)) continue;
      const t = own(h, 'time');
      const p = num(own(h, 'P'));
      if (typeof t === 'string' && p !== null) series.push([t, p]);
    }
  } else {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const m = /^Nominal power of the PV system.*?:\s*([\d.]+)/i.exec(line);
      if (m) peak = Number(m[1]);
      const db = /^Radiation database:\s*(\S+)/i.exec(line);
      if (db) database = cleanText(db[1], 40) ?? '';
      const row = /^(\d{8}:\d{4}),\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*(,|$)/i.exec(line);
      if (row) series.push([row[1], Number(row[2])]);
    }
  }
  if (!series.length) return { error: 'Aucune production horaire trouvée : choisissez « Données horaires » (CSV ou JSON) dans PVGIS, avec « Production PV » cochée.' };
  if (peak === null || !Number.isFinite(peak) || peak <= 0 || peak > 1000) return { error: 'Puissance crête (kWc) introuvable dans le fichier.' };
  const sums: Record<string, number[]> = {};
  const counts: Record<string, number[]> = {};
  const years = new Set<number>();
  for (const [t, w] of series) {
    const m = /^(\d{4})(\d{2})(\d{2}):(\d{2})\d{2}$/.exec(t);
    if (!m || !Number.isFinite(w) || w < 0) continue;
    const key = `${m[2]}-${m[3]}`;
    const hour = Number(m[4]);
    if (!MMDD.test(key) || hour > 23) continue;
    years.add(Number(m[1]));
    if (!Object.hasOwn(sums, key)) {
      sums[key] = new Array(24).fill(0);
      counts[key] = new Array(24).fill(0);
    }
    sums[key][hour] += w / peak; // W over one hour → Wh, per kWc
    counts[key][hour] += 1;
  }
  const hours: HourProfile = {};
  for (const k of Object.keys(sums)) hours[k] = sums[k].map((s, h) => (counts[k][h] ? Math.min(MAX_WH_PER_KWC_HOUR, Math.round((s / counts[k][h]) * 10) / 10) : 0));
  if (Object.keys(hours).length < 300) return { error: 'Moins de 300 jours dans le fichier : il faut une année complète d’heures.' };
  return { roof: { name: 'Fichier PVGIS importé', kwc: 1, hours }, year: years.size === 1 ? [...years][0] : null, database };
}

/** One profile per kWc for the whole installation: roofs weighted by the power they carry. */
export function combinedProfile(roofs: ProfileRoof[]): HourProfile {
  const total = roofs.reduce((s, r) => s + r.kwc, 0);
  const out: HourProfile = {};
  if (!(total > 0)) return out;
  const keys = new Set(roofs.flatMap((r) => Object.keys(r.hours)));
  for (const k of keys) {
    const row = new Array(24).fill(0);
    for (const r of roofs) {
      const src = r.hours[k] ?? r.hours[fallbackDay(k)] ?? null;
      if (!src) continue;
      for (let h = 0; h < 24; h++) row[h] += (src[h] * r.kwc) / total;
    }
    out[k] = row;
  }
  return out;
}
const fallbackDay = (mmdd: string) => (mmdd === '02-29' ? '02-28' : mmdd);

/** Sum of the roofs' peak powers (kWc). */
export const roofsKwc = (roofs: { kwc: number }[]) => Math.round(roofs.reduce((s, r) => s + r.kwc, 0) * 100) / 100;

/** Yearly production of 1 kWc of the profile (kWh). */
export function yearlyPerKwc(p: HourProfile): number {
  let wh = 0;
  for (const k of Object.keys(p)) if (k !== '02-29') wh += p[k].reduce((a, b) => a + b, 0);
  return wh / 1000;
}

// ------------------------------------------------------------------ simulation days
const HALF = 30 * 60000;

/**
 * Production of 1 kWc in each local half hour of `day` (Wh): the UTC hour of the profile that
 * holds that half hour, halved. The profile's year is not the curve's: the same calendar day
 * is used (29 February → 28).
 */
export function dayProduction(p: HourProfile, tz: string, day: string): number[] {
  const start = localMidnight(tz, day);
  const out: number[] = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(start + i * HALF);
    const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const row = p[key] ?? p[fallbackDay(key)];
    out.push(row ? row[d.getUTCHours()] / 2 : 0);
  }
  return out;
}

export interface SimDay {
  day: string;
  wh: number[]; // 48 local half hours, Wh drawn from the grid today (Linky)
  prod: number[]; // 48 local half hours, Wh per kWc
  shiftable: number; // Wh of the day that piloting may move to the sun (water heater, car)
  rebuilt: boolean; // no curve that day: the Linky total spread like an average day
}

export interface SimWindow {
  days: SimDay[];
  from: string;
  to: string;
  curveDays: number;
  rebuiltDays: number;
}

const DAY_MS = 86400000;
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The 48 Wh of one local day of the curve, or null when a half hour is missing. */
function curveDay(curve: Curve, tz: string, day: string): number[] | null {
  const out: number[] = [];
  const counts = halfHourCounts(tz, day);
  for (let i = 0; i < 48; i++) {
    const key = `${day}T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
    const wh = curve.get(key);
    if (wh === undefined) {
      if (counts && counts.get(key.slice(11)) === undefined) {
        out.push(0); // spring DST: this half hour does not exist
        continue;
      }
      return null;
    }
    out.push(wh);
  }
  return out;
}

/**
 * The last 365 days ending at the last day with a Linky reading: each day from the curve when
 * whole, else from the Linky daily total spread like the average curve day (weekday / weekend),
 * else left out. `shiftable(day)` gives the Wh piloting may move that day.
 */
export function simWindow(curve: Curve, daily: Map<string, number>, tz: string, profile: HourProfile, shiftable: (day: string) => number): SimWindow | null {
  const known = [...curve.keys()].map((k) => k.slice(0, 10));
  const last = [known.reduce((a, b) => (a > b ? a : b), ''), [...daily.keys()].reduce((a, b) => (a > b ? a : b), '')].reduce((a, b) => (a > b ? a : b));
  if (!last) return null;
  const from = addDay(last, -364);
  const whole = new Map<string, number[]>();
  for (const day of new Set(known)) {
    if (day < from || day > last) continue;
    const row = curveDay(curve, tz, day);
    if (row) whole.set(day, row);
  }
  if (!whole.size) return null;
  // average shape (share of the day per half hour), weekdays and weekends apart
  const shape = (weekend: boolean) => {
    const acc = new Array(48).fill(0);
    let n = 0;
    for (const [day, row] of whole) {
      const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
      if ((wd === 0 || wd === 6) !== weekend) continue;
      const tot = row.reduce((a, b) => a + b, 0);
      if (tot <= 0) continue;
      for (let i = 0; i < 48; i++) acc[i] += row[i] / tot;
      n++;
    }
    return n ? acc.map((x) => x / n) : null;
  };
  const shapes = { week: shape(false), end: shape(true) };
  const days: SimDay[] = [];
  let rebuilt = 0;
  for (let day = from; day <= last; day = addDay(day, 1)) {
    let wh = whole.get(day) ?? null;
    let isRebuilt = false;
    if (!wh) {
      const kwh = daily.get(day);
      const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
      const s = (wd === 0 || wd === 6 ? shapes.end : shapes.week) ?? shapes.week ?? shapes.end;
      if (kwh === undefined || !(kwh >= 0) || !s) continue;
      wh = s.map((x) => x * kwh * 1000);
      isRebuilt = true;
      rebuilt++;
    }
    days.push({ day, wh, prod: dayProduction(profile, tz, day), shiftable: Math.max(0, shiftable(day)), rebuilt: isRebuilt });
  }
  return { days, from, to: last, curveDays: whole.size, rebuiltDays: rebuilt };
}

// ------------------------------------------------------------------ simulation
/** Everything the owner decides (#356): no default is written in the code. */
export interface SolarAssumptions {
  priceHp: number; // €/kWh bought outside off-peak hours
  priceHc: number; // €/kWh bought in off-peak hours
  feedIn: number; // €/kWh paid for the surplus sent to the grid
  costPerKwc: number; // € per kWc installed (panels, inverter, fitting, connection)
  batteryCostPerKwh: number; // € per kWh of battery installed
  batteryEfficiency: number; // round trip, 0–1 (e.g. 0.9)
}

export interface Scenario {
  pilot: boolean; // water heater (and car) moved to the hours of sun
  battery: number; // kWh, 0 = none
}

export interface SimOptions {
  kwc: number;
  scenario: Scenario;
  /** Power of what piloting switches on (kW): the water heater, the car. */
  pilotKw: number;
  /** Share (0..1) of each half hour (0–47) that is off-peak in the contract (offpeak.ts, #428). */
  offPeak: readonly number[];
  a: SolarAssumptions;
}

export interface SimResult {
  production: number; // kWh
  selfConsumed: number; // kWh produced and not sent to the grid (battery losses included)
  surplus: number; // kWh sent to the grid
  bought: number; // kWh bought with the panels
  boughtBefore: number; // kWh bought without panels
  moved: number; // kWh moved by piloting
  fromBattery: number; // kWh given back by the battery
  saving: number; // € over the window: purchases avoided + surplus sold
  cost: number; // € installed (panels + battery)
}

/** One run of the window for one size and one scenario. Pilot first, then the battery. */
export function simulate(w: Pick<SimWindow, 'days'>, o: SimOptions): SimResult {
  const r: SimResult = { production: 0, selfConsumed: 0, surplus: 0, bought: 0, boughtBefore: 0, moved: 0, fromBattery: 0, saving: 0, cost: 0 };
  const eff = Math.min(1, Math.max(0, o.a.batteryEfficiency));
  const cap = Math.max(0, o.scenario.battery) * 1000; // Wh
  const halfMax = Math.max(0, o.pilotKw) * 500; // Wh a pilot load can take in one half hour
  let soc = 0; // Wh stored
  let before = 0;
  let after = 0;
  for (const d of w.days) {
    const cons = d.wh.slice();
    const prod = d.prod.map((p) => p * o.kwc);
    if (o.scenario.pilot && d.shiftable > 0 && halfMax > 0) {
      // only what the night really drew can be moved
      const night = cons.reduce((s, x, i) => s + x * (o.offPeak[i] ?? 0), 0);
      let left = Math.min(d.shiftable, night);
      const want = left;
      for (let i = 0; i < 48 && left > 0; i++) {
        const free = Math.min(prod[i] - cons[i], halfMax, left);
        if (free > 0) {
          cons[i] += free;
          left -= free;
        }
      }
      const moved = want - left;
      if (moved > 0) {
        if (night > 0) for (let i = 0; i < 48; i++) cons[i] -= (cons[i] * (o.offPeak[i] ?? 0) * moved) / night;
        r.moved += moved;
      }
    }
    for (let i = 0; i < 48; i++) {
      const f = o.offPeak[i] ?? 0;
      const price = f * o.a.priceHc + (1 - f) * o.a.priceHp;
      before += d.wh[i] * price;
      r.boughtBefore += d.wh[i];
      let net = prod[i] - cons[i];
      if (cap > 0 && eff > 0) {
        if (net > 0) {
          const charge = Math.min(net, (cap - soc) / eff);
          soc += charge * eff;
          net -= charge;
        } else if (net < 0) {
          const give = Math.min(-net, soc);
          soc -= give;
          net += give;
          r.fromBattery += give;
        }
      }
      r.production += prod[i];
      if (net > 0) {
        r.surplus += net;
        r.saving += (net / 1000) * o.a.feedIn;
      } else {
        r.bought -= net;
        after += -net * price;
      }
    }
  }
  r.saving += (before - after) / 1000;
  r.selfConsumed = r.production - r.surplus;
  for (const k of ['production', 'selfConsumed', 'surplus', 'bought', 'boughtBefore', 'moved', 'fromBattery'] as const) r[k] /= 1000;
  r.cost = o.kwc * o.a.costPerKwc + o.scenario.battery * o.a.batteryCostPerKwh;
  return r;
}

/** The sizes compared (#356: the two shelters carry ≈ 4.5 to 5 kWc). */
export const SIZES = [3, 4.5, 6];
/** The scenarios compared, piloting before the battery (#356 § 3). */
export const SCENARIOS: (Scenario & { label: string })[] = [
  { pilot: false, battery: 0, label: 'Sans pilotage' },
  { pilot: true, battery: 0, label: 'Avec pilotage' },
  { pilot: true, battery: 5, label: 'Pilotage + batterie 5 kWh' },
  { pilot: true, battery: 10, label: 'Pilotage + batterie 10 kWh' },
];

/** Simple payback in years (installed cost / yearly saving), or null when it never pays. */
export const payback = (cost: number, yearlySaving: number) => (yearlySaving > 0 && cost > 0 ? cost / yearlySaving : null);

/** What the owner types in the simulator: each field a number in its bounds, or null (not typed). */
export interface SolarInputs {
  priceHp: number | null; // €/kWh
  priceHc: number | null; // €/kWh
  feedIn: number | null; // €/kWh
  costPerKwc: number | null; // €
  batteryCostPerKwh: number | null; // €
  batteryEfficiency: number | null; // % round trip
  heaterKw: number | null; // kW of the water heater
  evKwhWeek: number | null; // kWh a week charged at home, today at night
  evKw: number | null; // kW of the charge
}
/** Field, label (French, shown when missing), bounds. */
export const INPUT_FIELDS: [keyof SolarInputs, string, number, number][] = [
  ['priceHp', 'prix du kWh en heures pleines', 0, 5],
  ['priceHc', 'prix du kWh en heures creuses', 0, 5],
  ['feedIn', 'tarif de rachat du surplus', 0, 5],
  ['costPerKwc', 'coût installé par kWc', 1, 20000],
  ['batteryCostPerKwh', 'coût de la batterie par kWh', 1, 20000],
  ['batteryEfficiency', 'rendement de la batterie', 1, 100],
  ['heaterKw', 'puissance du chauffe-eau', 0.1, 12],
  ['evKwhWeek', 'recharge de la voiture par semaine', 0, 500],
  ['evKw', 'puissance de recharge', 1, 22],
];
export const NO_INPUTS: SolarInputs = Object.fromEntries(INPUT_FIELDS.map(([k]) => [k, null])) as unknown as SolarInputs;

/** The inputs read back (localStorage, a form): unknown keys and values out of bounds dropped. */
export function parseSolarInputs(v: unknown): SolarInputs {
  const out: SolarInputs = { ...NO_INPUTS };
  if (!isObj(v)) return out;
  for (const [k, , min, max] of INPUT_FIELDS) {
    const x = num(own(v, k));
    if (x !== null && x >= min && x <= max) out[k] = x;
  }
  return out;
}

export interface ScenarioRow {
  label: string;
  scenario: Scenario;
  /** Over one year (the window scaled to 365 days), null when an input it needs is missing. */
  year: SimResult | null;
  missing: string[];
  /** Saving in € a year, null without the prices. */
  saving: number | null;
  payback: number | null;
}
export interface SizeRows {
  kwc: number;
  rows: ScenarioRow[];
}

/** Labels of the inputs a scenario needs and the owner has not typed. */
export function missingFor(sc: Scenario, i: SolarInputs, hasShiftable: boolean): string[] {
  const m: string[] = [];
  if (sc.pilot && !hasShiftable) m.push('un usage à piloter (chauffe-eau ou recharge)');
  if (sc.pilot && i.heaterKw === null && !(i.evKwhWeek && i.evKw)) m.push('puissance du chauffe-eau');
  if (sc.battery && i.batteryEfficiency === null) m.push('rendement de la batterie');
  return m;
}
const MONEY: (keyof SolarInputs)[] = ['priceHp', 'priceHc', 'feedIn'];
export const moneyMissing = (i: SolarInputs) => INPUT_FIELDS.filter(([k]) => MONEY.includes(k) && i[k] === null).map(([, l]) => l);

/**
 * Every size × scenario over the window, scaled to one year (365 / days of the window). The car
 * charge typed is added to what piloting may move (it is supposed in the curve, at night).
 */
export function runAll(w: SimWindow, i: SolarInputs, offPeak: readonly number[], sizes = SIZES): SizeRows[] {
  const evDay = i.evKwhWeek && i.evKw ? (i.evKwhWeek * 1000) / 7 : 0;
  const days = evDay ? w.days.map((d) => ({ ...d, shiftable: d.shiftable + evDay })) : w.days;
  const hasShiftable = days.some((d) => d.shiftable > 0);
  const scale = w.days.length ? 365 / w.days.length : 0;
  const prices = !moneyMissing(i).length;
  const a: SolarAssumptions = {
    priceHp: i.priceHp ?? 0,
    priceHc: i.priceHc ?? 0,
    feedIn: i.feedIn ?? 0,
    costPerKwc: i.costPerKwc ?? 0,
    batteryCostPerKwh: i.batteryCostPerKwh ?? 0,
    batteryEfficiency: (i.batteryEfficiency ?? 0) / 100,
  };
  const pilotKw = (i.heaterKw ?? 0) + (evDay ? (i.evKw ?? 0) : 0);
  return sizes.map((kwc) => ({
    kwc,
    rows: SCENARIOS.map(({ label, ...scenario }) => {
      const missing = missingFor(scenario, i, hasShiftable);
      if (missing.length) return { label, scenario, year: null, missing, saving: null, payback: null };
      const r = simulate({ days }, { kwc, scenario, pilotKw, offPeak, a });
      const year = { ...r };
      for (const k of ['production', 'selfConsumed', 'surplus', 'bought', 'boughtBefore', 'moved', 'fromBattery', 'saving'] as const) year[k] = r[k] * scale;
      const costKnown = i.costPerKwc !== null && (!scenario.battery || i.batteryCostPerKwh !== null);
      return { label, scenario, year, missing, saving: prices ? year.saving : null, payback: prices && costKnown ? payback(r.cost, year.saving) : null };
    }),
  }));
}
