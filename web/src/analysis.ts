// Pure analysis helpers: cost, degree days, energy signature, projection, verdict, profiles.

import { type DayRecord, addDays, dayOfYear, minusYears, rawRecords, seasonOf } from './aggregate';

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
  for (const r of rawRecords(records)) {
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
  for (const r of rawRecords(records)) {
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
/** First day with data in these records ('' when there is none). */
const firstDayOf = (records: DayRecord[]) => records.reduce((a, r) => (!a || r.day < a ? r.day : a), '');

/**
 * Year-end projection: actual so far + the rest of the year as it went in previous
 * years, scaled by how this year compares to them so far. Only previous years measured
 * from 1 January count (#240): a first year started in June has no winter in its « so far »
 * and would blow the ratio up. `firstDay` defaults to the first day of the records.
 */
export function projectYear(
  records: DayRecord[],
  lastDay: string,
  firstDay = firstDayOf(records),
): { projected: number; ytd: number; basis: number } | null {
  const year = Number(lastDay.slice(0, 4));
  const md = lastDay.slice(5);
  let ytd = 0;
  const prev = new Map<number, { ytd: number; rest: number }>();
  for (const r of records) {
    const y = Number(r.day.slice(0, 4));
    if (y === year) {
      if (r.day <= lastDay) ytd += r.kwh;
    } else if (y < year && firstDay <= `${y}-01-01`) {
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
 * A reference period is used only when the data covers it entirely (#240): on the first
 * anniversary of a collection started mid-month, the half month measured would make the
 * « expected » far too low.
 */
export function verdict(
  records: DayRecord[],
  from: string,
  to: string,
  weather: Weather | null,
  firstDay = firstDayOf(records),
): Verdict | null {
  const sum = (f: string, t: string, cat?: string) =>
    records.reduce((s, r) => s + (r.day >= f && r.day <= t && (!cat || r.cat === cat) ? r.kwh : 0), 0);
  const actual = sum(from, to);
  const refs: { total: number; heat: number; dju: number }[] = [];
  for (let k = 1; k <= 4; k++) {
    const f = minusYears(from, k);
    const t = minusYears(to, k);
    if (f < firstDay) break; // older references start even earlier
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
  // HP/HC files have two variable prices; single-price offers (Base) one, used for both.
  const single = col('PART_VARIABLE_TTC');
  const [iFrom, iTo, iKva, iFix, iHc, iHp] = [
    col('DATE_DEBUT'),
    col('DATE_FIN'),
    col('P_SOUSCRITE'),
    col('PART_FIXE_TTC'),
    single >= 0 ? single : col('PART_VARIABLE_HC_TTC'),
    single >= 0 ? single : col('PART_VARIABLE_HP_TTC'),
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
export type PriceAt = (day: string) => TrveRow | null;

export function energyCostTrve(
  records: DayRecord[],
  tariffs: TariffMap,
  rowsOrPrice: TrveRow[] | PriceAt,
  kva: number,
  off: 1 | 2,
  shares: { perRoom: Map<string, number>; overall: number },
): TrveCost {
  const priceAt: PriceAt = typeof rowsOrPrice === 'function' ? rowsOrPrice : (d) => trveAt(rowsOrPrice, kva, d);
  const on = off === 1 ? 2 : 1;
  let energy = 0;
  let estimatedKwh = 0;
  const cache = new Map<string, TrveRow | null>();
  for (const r of rawRecords(records)) {
    let p = cache.get(r.day);
    if (p === undefined) cache.set(r.day, (p = priceAt(r.day)));
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

export function subscriptionTrve(rowsOrPrice: TrveRow[] | PriceAt, kva: number, from: string, to: string): number {
  const priceAt: PriceAt = typeof rowsOrPrice === 'function' ? rowsOrPrice : (d) => trveAt(rowsOrPrice, kva, d);
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const p = priceAt(d);
    if (p) s += p.fixedYear / (Number(d.slice(0, 4)) % 4 === 0 ? 366 : 365);
  }
  return s;
}

// ------------------------------------------------------------------ offer comparator (Base / HP-HC / Tempo)
export interface TempoRow {
  from: string;
  to: string | null;
  kva: number;
  fixedYear: number;
  prices: Record<1 | 2 | 3, [number, number]>; // colour → [HC, HP] €/kWh
}

export function parseTempoCsv(text: string): TempoRow[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const c = (n: string) => head.indexOf(n);
  const num = (s: string) => Number((s ?? '').replace(',', '.'));
  return lines
    .slice(1)
    .map((l) => l.split(';'))
    .filter((v) => v[c('PART_FIXE_TTC')] && v[c('PART_VARIABLE_HPRouge_TTC')])
    .map((v) => ({
      from: frDate(v[c('DATE_DEBUT')])!,
      to: frDate(v[c('DATE_FIN')]),
      kva: Number(v[c('P_SOUSCRITE')]),
      fixedYear: num(v[c('PART_FIXE_TTC')]),
      prices: {
        1: [num(v[c('PART_VARIABLE_HCBleu_TTC')]), num(v[c('PART_VARIABLE_HPBleu_TTC')])] as [number, number],
        2: [num(v[c('PART_VARIABLE_HCBlanc_TTC')]), num(v[c('PART_VARIABLE_HPBlanc_TTC')])] as [number, number],
        3: [num(v[c('PART_VARIABLE_HCRouge_TTC')]), num(v[c('PART_VARIABLE_HPRouge_TTC')])] as [number, number],
      },
    }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

function rowAt<T extends { from: string; to: string | null; kva: number }>(rows: T[], kva: number, day: string): T | null {
  let found: T | null = null;
  for (const r of rows) if (r.kva === kva && r.from <= day && (!r.to || day <= r.to)) found = r;
  return found;
}

/** Energy of one day split into off-peak / peak kWh. */
export interface DaySplit {
  day: string;
  hc: number;
  hp: number;
}

/**
 * Daily HC/HP split. Intuis rooms: measured tariff columns, or the room's measured
 * share. Rest of the home (Linky total minus Intuis): assumed flat over 24 h, i.e. 8
 * off-peak hours out of 24.
 */
export function daySplits(
  records: DayRecord[],
  tariffs: TariffMap,
  off: 1 | 2,
  shares: { perRoom: Map<string, number>; overall: number },
  linky: Map<string, number> | null,
): DaySplit[] {
  const on = off === 1 ? 2 : 1;
  const byDay = new Map<string, { hc: number; hp: number; total: number }>();
  for (const r of rawRecords(records)) {
    const e = byDay.get(r.day) ?? { hc: 0, hp: 0, total: 0 };
    const t = tariffs.get(r.room)?.get(r.day);
    if (t && t[1] + t[2] > 0) (e.hc += t[off]), (e.hp += t[on] + t[0]);
    else {
      const s = shares.perRoom.get(r.room) ?? shares.overall;
      (e.hc += r.kwh * s), (e.hp += r.kwh * (1 - s));
    }
    e.total += r.kwh;
    byDay.set(r.day, e);
  }
  const days = linky ? [...linky.keys()] : [...byDay.keys()];
  return days.sort().map((day) => {
    const e = byDay.get(day) ?? { hc: 0, hp: 0, total: 0 };
    const rest = linky ? Math.max(0, (linky.get(day) ?? 0) - e.total) : 0;
    return { day, hc: e.hc + rest / 3, hp: e.hp + (rest * 2) / 3 };
  });
}

export interface OfferCost {
  energy: number;
  subscription: number;
  days: number; // days actually priced
}

export function compareOffers(
  splits: DaySplit[],
  kvaAt: (day: string) => number,
  base: TrveRow[],
  hphc: TrveRow[],
  tempo: TempoRow[],
  tempoDays: Map<string, number>,
): Record<'base' | 'hphc' | 'tempo', OfferCost> {
  const out = {
    base: { energy: 0, subscription: 0, days: 0 },
    hphc: { energy: 0, subscription: 0, days: 0 },
    tempo: { energy: 0, subscription: 0, days: 0 },
  };
  for (const s of splits) {
    const kva = kvaAt(s.day);
    const yearDays = Number(s.day.slice(0, 4)) % 4 === 0 ? 366 : 365;
    const b = rowAt(base, kva, s.day);
    const h = rowAt(hphc, kva, s.day);
    const t = rowAt(tempo, kva, s.day);
    const colour = tempoDays.get(s.day) as 1 | 2 | 3 | undefined;
    // Only days where all three offers can be priced, so totals stay comparable.
    if (!b || !h || !t || !colour) continue;
    out.base.energy += (s.hc + s.hp) * b.hp;
    out.base.subscription += b.fixedYear / yearDays;
    out.hphc.energy += s.hc * h.hc + s.hp * h.hp;
    out.hphc.subscription += h.fixedYear / yearDays;
    const [thc, thp] = t.prices[colour];
    out.tempo.energy += s.hc * thc + s.hp * thp;
    out.tempo.subscription += t.fixedYear / yearDays;
    out.base.days++, out.hphc.days++, out.tempo.days++;
  }
  return out;
}

// ------------------------------------------------------------------ anomalies (deterministic, S-4.8)
export interface Anomaly {
  day: string;
  kwh: number;
  expected: number;
  z: number; // residual / σ of the season
}

/**
 * Heating days far from the season's energy signature (|residual| > 2σ and > 3 kWh).
 * `exclude`: days not fully measured (lost or estimated, S-1.10), left out of the fit and the list.
 */
export function anomalies(records: DayRecord[], weather: Weather, exclude: Set<string> = new Set()): Anomaly[] {
  const out: Anomaly[] = [];
  for (const all of signaturePoints(records, weather).values()) {
    const pts = all.filter((p) => !exclude.has(p[2]));
    const fit = fitSeason(pts);
    if (!fit) continue;
    const heating = pts.filter(([t, k]) => t < 15 && k > 0.2);
    const res = heating.map(([t, k]) => k - (fit.slope * t + fit.intercept));
    const sigma = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, res.length - 2));
    heating.forEach(([t, k, day], i) => {
      const r = res[i];
      if (Math.abs(r) > 2 * sigma && Math.abs(r) > 3) out.push({ day, kwh: k, expected: fit.slope * t + fit.intercept, z: r / sigma });
    });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Days above a threshold, per module, over [from, to] (S-3.6). */
export function daysAbove(daily: Record<string, (number | null)[]>, col: number, threshold: number, from: string, to: string): number {
  let n = 0;
  for (const [d, v] of Object.entries(daily)) if (d >= from && d <= to && (v[col] ?? -Infinity) > threshold) n++;
  return n;
}

// ------------------------------------------------------------------ subscribed power inferred from Linky (S-2.8)
export const KVA_STEPS = [3, 6, 9, 12, 15, 18, 24, 30, 36];

export interface KvaChange {
  from: number; // kVA before
  to: number; // smallest standard power compatible with what was drawn after
  firstOver: string; // first day the max power exceeded `from`: the change happened on or before it
  lastWithin: string | null; // last day before that one with data (change happened after it, if the old power was really `from`)
}

/**
 * The Linky meter cuts at the subscribed power (plus a small tolerance), so the first
 * day the daily max power exceeds the declared power bounds the date of an upgrade.
 * Returns null when the data never exceeds `declared`.
 */
export function inferKvaChange(pmax: Map<string, number>, declared: number, tolerance = 0.3): KvaChange | null {
  const days = [...pmax.keys()].sort();
  const first = days.find((d) => pmax.get(d)! > declared + tolerance);
  if (!first) return null;
  const after = days.filter((d) => d >= first).map((d) => pmax.get(d)!);
  const peak = Math.max(...after);
  const to = KVA_STEPS.find((k) => k >= peak - tolerance) ?? 36;
  const before = days.filter((d) => d < first);
  return { from: declared, to, firstOver: first, lastWithin: before.length ? before[before.length - 1] : null };
}
