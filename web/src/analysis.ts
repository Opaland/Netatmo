// Pure analysis helpers: cost, degree days, energy signature, projection, verdict, profiles.

import { type DayRecord, addDays, dayOfYear, minusYears, seasonOf } from './aggregate';

// ------------------------------------------------------------------ cost
export interface Prices {
  base: number | null; // €/kWh, single tariff (and days without tariff detail)
  t1: number | null; // €/kWh, tariff column $1
  t2: number | null; // €/kWh, tariff column $2
  sub: number | null; // € per month, subscription
}
export const NO_PRICES: Prices = { base: null, t1: null, t2: null, sub: null };
export const hasPrices = (p: Prices) => p.base !== null || p.t1 !== null || p.t2 !== null;

/** Tariff detail: room -> day -> [kWh $0, kWh $1, kWh $2]. */
export type TariffMap = Map<string, Map<string, [number, number, number]>>;

/** Energy cost of the records (subscription excluded). */
export function energyCost(records: DayRecord[], tariffs: TariffMap, p: Prices): number {
  const base = p.base ?? p.t1 ?? p.t2 ?? 0;
  let eur = 0;
  for (const r of records) {
    const t = tariffs.get(r.room)?.get(r.day);
    if (t && (p.t1 !== null || p.t2 !== null)) {
      eur += t[0] * base + t[1] * (p.t1 ?? base) + t[2] * (p.t2 ?? base);
    } else {
      eur += r.kwh * base;
    }
  }
  return eur;
}

export function subscriptionCost(from: string, to: string, p: Prices): number {
  if (!p.sub) return 0;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  return (p.sub * 12 * days) / 365.25;
}

/** Which tariff column is "heures creuses": the one where the water heater runs most. */
export function offPeakColumn(tariffs: TariffMap, waterRooms: string[]): 1 | 2 | null {
  let c1 = 0;
  let c2 = 0;
  for (const room of waterRooms) for (const t of tariffs.get(room)?.values() ?? []) (c1 += t[1]), (c2 += t[2]);
  if (c1 + c2 === 0) return null;
  return c2 >= c1 ? 2 : 1;
}

export function tariffSplit(records: DayRecord[], tariffs: TariffMap): [number, number, number, number] {
  // [$0, $1, $2, without detail]
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of records) {
    const t = tariffs.get(r.room)?.get(r.day);
    if (t) (out[0] += t[0]), (out[1] += t[1]), (out[2] += t[2]);
    else out[3] += r.kwh;
  }
  return out;
}

// ------------------------------------------------------------------ weather
export type Weather = Map<string, [number, number, number]>; // day -> [min, max, mean]
export const DJU_BASE = 18;

/** Degree days (méthode météo : base 18 °C, moyenne de min et max). */
export function dju(w: [number, number, number]): number {
  return Math.max(0, DJU_BASE - (w[0] + w[1]) / 2);
}

export function djuBetween(weather: Weather, from: string, to: string): { dju: number; days: number } {
  let s = 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weather.get(d);
    if (w) (s += dju(w)), n++;
  }
  return { dju: s, days: n };
}

/** DJU per (year, month) and the average month over all complete years. */
export function monthlyDju(weather: Weather): { byYear: Map<number, number[]>; normal: number[] } {
  const byYear = new Map<number, number[]>();
  const count = new Map<number, number[]>();
  for (const [day, w] of weather) {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(5, 7)) - 1;
    if (!byYear.has(y)) byYear.set(y, new Array(12).fill(0)), count.set(y, new Array(12).fill(0));
    byYear.get(y)![m] += dju(w);
    count.get(y)![m]++;
  }
  const normal = new Array(12).fill(0).map((_, m) => {
    const full = [...byYear.keys()].filter((y) => count.get(y)![m] >= 28);
    return full.length ? full.reduce((s, y) => s + byYear.get(y)![m], 0) / full.length : 0;
  });
  return { byYear, normal };
}

// ------------------------------------------------------------------ signature
export interface Fit {
  slope: number; // kWh per °C (negative: colder → more)
  intercept: number;
  r2: number;
  balance: number | null; // °C where heating reaches zero
  n: number;
}

export function linearFit(points: [number, number][]): Fit | null {
  const n = points.length;
  if (n < 10) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) (sx += x), (sy += y), (sxx += x * x), (sxy += x * y), (syy += y * y);
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = points.reduce((s, [x, y]) => s + (y - (slope * x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, balance: slope < 0 ? -intercept / slope : null, n };
}

/** Daily heating kWh vs outdoor mean temperature, grouped by heating season. */
export function signaturePoints(records: DayRecord[], weather: Weather): Map<string, [number, number, string][]> {
  const perDay = new Map<string, number>();
  for (const r of records) if (r.cat === 'heating') perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.kwh);
  const out = new Map<string, [number, number, string][]>();
  for (const [day, kwh] of perDay) {
    const w = weather.get(day);
    if (!w) continue;
    const s = seasonOf(day);
    if (!out.has(s)) out.set(s, []);
    out.get(s)!.push([w[2], kwh, day]);
  }
  return out;
}

/** Fit only heating days (outdoor below 15 °C and some consumption). */
export function fitSeason(points: [number, number, string][]): Fit | null {
  return linearFit(points.filter(([t, k]) => t < 15 && k > 0.2).map(([t, k]) => [t, k]));
}

// ------------------------------------------------------------------ projection & verdict
/**
 * Year-end projection: actual so far + the rest of the year as it went in previous
 * years, scaled by how this year compares to them so far.
 */
export function projectYear(records: DayRecord[], lastDay: string): { projected: number; ytd: number; basis: number } | null {
  const year = Number(lastDay.slice(0, 4));
  const md = lastDay.slice(5);
  let ytd = 0;
  const prev = new Map<number, { ytd: number; rest: number }>();
  for (const r of records) {
    const y = Number(r.day.slice(0, 4));
    if (y === year) {
      if (r.day <= lastDay) ytd += r.kwh;
    } else if (y < year) {
      const p = prev.get(y) ?? { ytd: 0, rest: 0 };
      if (r.day.slice(5) <= md) p.ytd += r.kwh;
      else p.rest += r.kwh;
      prev.set(y, p);
    }
  }
  const usable = [...prev.values()].filter((p) => p.ytd > 0 && p.rest > 0);
  if (!usable.length) return null;
  const ratio = usable.reduce((s, p) => s + p.rest / p.ytd, 0) / usable.length;
  return { projected: ytd * (1 + ratio), ytd, basis: usable.length };
}

export type Level = 'low' | 'normal' | 'high';
export interface Verdict {
  level: Level;
  pct: number; // actual vs expected, %
  actual: number;
  expected: number;
  climate: boolean; // expected corrected by degree days
}

/**
 * This period vs the same calendar period of previous years. With weather, the
 * heating part is compared at equal climate (kWh per DJU of previous years × DJU now).
 */
export function verdict(records: DayRecord[], from: string, to: string, weather: Weather | null): Verdict | null {
  const sum = (f: string, t: string, cat?: string) =>
    records.reduce((s, r) => s + (r.day >= f && r.day <= t && (!cat || r.cat === cat) ? r.kwh : 0), 0);
  const actual = sum(from, to);
  const refs: { total: number; heat: number; dju: number }[] = [];
  for (let k = 1; k <= 4; k++) {
    const f = minusYears(from, k);
    const t = minusYears(to, k);
    const total = sum(f, t);
    if (total <= 0) continue;
    refs.push({ total, heat: sum(f, t, 'heating'), dju: weather ? djuBetween(weather, f, t).dju : 0 });
  }
  if (!refs.length || actual <= 0) return null;
  let expected = refs.reduce((s, r) => s + r.total, 0) / refs.length;
  let climate = false;
  if (weather) {
    const now = djuBetween(weather, from, to).dju;
    const withDju = refs.filter((r) => r.dju > 5);
    if (now > 0 && withDju.length) {
      const perDju = withDju.reduce((s, r) => s + r.heat / r.dju, 0) / withDju.length;
      const other = withDju.reduce((s, r) => s + (r.total - r.heat), 0) / withDju.length;
      expected = perDju * now + other;
      climate = true;
    }
  }
  const p = ((actual - expected) / expected) * 100;
  return { level: p > 10 ? 'high' : p < -10 ? 'low' : 'normal', pct: p, actual, expected, climate };
}

// ------------------------------------------------------------------ hourly profiles
export type Hourly = Map<string, Map<string, number>>; // room -> "YYYY-MM-DDTHH" -> kWh

/** Average kWh per (weekday Monday=0, hour) over the given days. */
export function weekHourGrid(hourly: Hourly, rooms: Set<string> | null, from: string, to: string): number[][] {
  const sum = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const days = new Set<string>();
  for (const [room, hours] of hourly) {
    if (rooms && !rooms.has(room)) continue;
    for (const [key, kwh] of hours) {
      const day = key.slice(0, 10);
      if (day < from || day > to) continue;
      days.add(day);
      const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
      sum[dow][Number(key.slice(11, 13))] += kwh;
    }
  }
  const perDow = new Array(7).fill(0);
  for (const d of days) perDow[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]++;
  return sum.map((row, i) => row.map((v) => (perDow[i] ? v / perDow[i] : 0)));
}

export function dayProfile(hourly: Hourly, rooms: Set<string>, from: string, to: string): number[] {
  const grid = weekHourGrid(hourly, rooms, from, to);
  return new Array(24).fill(0).map((_, h) => grid.reduce((s, row) => s + row[h], 0) / 7);
}

// ------------------------------------------------------------------ waterfall
export function roomDeltas(records: DayRecord[], from: string, to: string): Map<string, { now: number; before: number }> {
  const fromB = minusYears(from);
  const toB = minusYears(to);
  const out = new Map<string, { now: number; before: number }>();
  for (const r of records) {
    const e = out.get(r.room) ?? { now: 0, before: 0 };
    if (r.day >= from && r.day <= to) e.now += r.kwh;
    else if (r.day >= fromB && r.day <= toB) e.before += r.kwh;
    out.set(r.room, e);
  }
  return out;
}

export { dayOfYear };

// ------------------------------------------------------------------ regulated tariff (EDF Tarif Bleu HP/HC)
/** One period of the CRE open-data file Option_HPHC.csv (prices TTC). */
export interface TrveRow {
  from: string; // YYYY-MM-DD
  to: string | null; // inclusive, null = still in force
  kva: number;
  fixedYear: number; // € per year (abonnement)
  hc: number; // €/kWh heures creuses
  hp: number; // €/kWh heures pleines
}

const frDate = (s: string) => (s ? `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : null);
const frNum = (s: string) => Number(s.replace(',', '.'));

export function parseTrveCsv(text: string): TrveRow[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const col = (name: string) => head.indexOf(name);
  const [iFrom, iTo, iKva, iFix, iHc, iHp] = [
    col('DATE_DEBUT'),
    col('DATE_FIN'),
    col('P_SOUSCRITE'),
    col('PART_FIXE_TTC'),
    col('PART_VARIABLE_HC_TTC'),
    col('PART_VARIABLE_HP_TTC'),
  ];
  return lines
    .slice(1)
    .map((l) => l.split(';'))
    .filter((c) => c[iFrom] && c[iHc] && c[iHp])
    .map((c) => ({
      from: frDate(c[iFrom])!,
      to: frDate(c[iTo]),
      kva: Number(c[iKva]),
      fixedYear: frNum(c[iFix]),
      hc: frNum(c[iHc]),
      hp: frNum(c[iHp]),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

export function trveAt(rows: TrveRow[], kva: number, day: string): TrveRow | null {
  let found: TrveRow | null = null;
  for (const r of rows) if (r.kva === kva && r.from <= day && (!r.to || day <= r.to)) found = r;
  return found;
}

/** Share of off-peak energy per room (from days with tariff detail), plus the overall share. */
export function offPeakShares(tariffs: TariffMap, off: 1 | 2): { perRoom: Map<string, number>; overall: number } {
  const perRoom = new Map<string, number>();
  let allOff = 0;
  let all = 0;
  for (const [room, days] of tariffs) {
    let o = 0;
    let t = 0;
    for (const v of days.values()) (o += v[off]), (t += v[0] + v[1] + v[2]);
    if (t > 0) perRoom.set(room, o / t);
    allOff += o;
    all += t;
  }
  return { perRoom, overall: all > 0 ? allOff / all : 0.3 };
}

export interface TrveCost {
  energy: number;
  estimatedKwh: number; // kWh priced with an estimated HP/HC split
}

/** Energy cost day by day at the regulated price in force that day. */
export function energyCostTrve(
  records: DayRecord[],
  tariffs: TariffMap,
  rows: TrveRow[],
  kva: number,
  off: 1 | 2,
  shares: { perRoom: Map<string, number>; overall: number },
): TrveCost {
  const on = off === 1 ? 2 : 1;
  let energy = 0;
  let estimatedKwh = 0;
  const cache = new Map<string, TrveRow | null>();
  for (const r of records) {
    let p = cache.get(r.day);
    if (p === undefined) cache.set(r.day, (p = trveAt(rows, kva, r.day)));
    if (!p) continue;
    const t = tariffs.get(r.room)?.get(r.day);
    if (t && t[1] + t[2] > 0) {
      energy += t[off] * p.hc + (t[on] + t[0]) * p.hp;
    } else {
      const s = shares.perRoom.get(r.room) ?? shares.overall;
      energy += r.kwh * (s * p.hc + (1 - s) * p.hp);
      estimatedKwh += r.kwh;
    }
  }
  return { energy, estimatedKwh };
}

export function subscriptionTrve(rows: TrveRow[], kva: number, from: string, to: string): number {
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const p = trveAt(rows, kva, d);
    if (p) s += p.fixedYear / (Number(d.slice(0, 4)) % 4 === 0 ? 366 : 365);
  }
  return s;
}
