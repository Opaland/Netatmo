// Linky 30-minute load curve (S-1.11): pure computations, no DOM.
// Curve keys are the LOCAL start of each half hour ("YYYY-MM-DDTHH:MM", home timezone).
// On the autumn DST day the repeated local half hours are summed by the collector into one
// key (two real half hours), and on the spring day the skipped ones are absent: every
// conversion to watts divides by the number of real half hours behind a key.

import type { Hourly } from './analysis';
import { memo, setKey } from './memo';

export type Curve = Map<string, number>; // "YYYY-MM-DDTHH:MM" -> Wh over that half hour

export const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const HALF_HOUR = 30 * 60000;
const DAY = 86400000;

// ------------------------------------------------------------------ time zone helpers
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, ms: number): number[] {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute)];
}

/** Local time minus UTC, in minutes, at that instant. */
function offsetMin(tz: string, ms: number): number {
  const [y, mo, d, h, mi] = parts(tz, ms);
  return (Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60000) * 60000) / 60000;
}

/** UTC instant of local midnight starting `day` in `tz`. */
export function localMidnight(tz: string, day: string): number {
  const naive = Date.parse(`${day}T00:00:00Z`);
  let t = naive - offsetMin(tz, naive) * 60000;
  t = naive - offsetMin(tz, t) * 60000;
  return t;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

const multCache = new Map<string, Map<string, number> | null>();
/**
 * Number of real half hours behind each local "HH:MM" key of that day; null when the day is
 * a plain 24-hour day (every key = 1). Autumn DST day: 02:00 and 02:30 count twice.
 */
export function halfHourCounts(tz: string, day: string): Map<string, number> | null {
  const k = `${tz}|${day}`;
  if (multCache.has(k)) return multCache.get(k)!;
  const start = localMidnight(tz, day);
  const end = localMidnight(tz, nextDay(day));
  let out: Map<string, number> | null = null;
  if (end - start !== DAY) {
    out = new Map();
    for (let t = start; t < end; t += HALF_HOUR) {
      const [, , , h, mi] = parts(tz, t);
      const key = `${String(h).padStart(2, '0')}:${mi < 30 ? '00' : '30'}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  multCache.set(k, out);
  return out;
}

// #568: the gap allowed between the half hours of a day and the day's total, the audit's
// (collector/audit.py `tolerance`, THRESHOLDS ecart_absolu / ecart_relatif): both test suites
// read __fixtures__/somme-jour.json, so that the two cannot drift apart.
export const DAY_GAP_WH = 100;
export const DAY_GAP_SHARE = 0.05;
export const dayGapExceeded = (fineWh: number, dayWh: number): boolean => Math.abs(fineWh - dayWh) > Math.max(DAY_GAP_WH, DAY_GAP_SHARE * Math.abs(dayWh));

/** Total (Wh) of the curve of a local day when every half hour of that day is there, else null. */
export function curveDayWh(curve: Curve, tz: string, day: string): number | null {
  let sum = 0;
  for (const s of halfHourCounts(tz, day)?.keys() ?? SLOTS) {
    const v = curve.get(`${day}T${s}`);
    if (v === undefined) return null;
    sum += v;
  }
  return sum;
}

export interface CurveVsDay {
  day: string;
  dayKwh: number; // the meter's total of the day: it is the one that counts
  curveKwh: number | null; // the half hours added up, null when some are missing
  halves: number; // half hours present
  expected: number; // half hours of that local day (46 on the spring change)
  ok: boolean; // the half hours make the day (within DAY_GAP_*)
}

/** #568: a day's curve against the meter's day total (null: no day total to compare with). */
export function curveVsDay(curve: Curve, tz: string, day: string, dayKwh: number | undefined): CurveVsDay | null {
  if (dayKwh === undefined || !Number.isFinite(dayKwh)) return null;
  const wh = curveDayWh(curve, tz, day);
  const halves = [...curve.keys()].filter((k) => k.startsWith(`${day}T`)).length;
  return { day, dayKwh, curveKwh: wh === null ? null : wh / 1000, halves, expected: halfHourCounts(tz, day)?.size ?? 48, ok: wh !== null && !dayGapExceeded(wh, dayKwh * 1000) };
}

const kwh1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** An energy said so that a small one is not « 0,0 kWh »: in Wh under 1 kWh. */
const energy = (kwh: number) => (Math.abs(kwh) < 1 ? `${nf0.format(kwh * 1000)}\u00a0Wh` : `${kwh1.format(kwh)}\u00a0kWh`);

/**
 * #568: the half hours of the curve were read before the reading of the 2026 format (a step given
 * once at the top, one quantity among several); days stored before it keep the former reading
 * until the owner has them fetched again.
 */
export const CURVE_READING_SINCE = '2026-11-13';

/**
 * #568: what the « Une journée » card says under a day's curve. The meter's total of the day is
 * the one that counts; the curve is said incomplete when a half hour is missing, or not to make
 * the day when its half hours add up to something else.
 */
export function dayNote(c: CurveVsDay | null): string {
  if (!c) return '';
  const head = `Total du jour (compteur) : ${energy(c.dayKwh)}`;
  if (c.curveKwh === null) {
    if (!c.halves) return `${head}. Pas de courbe ce jour-là : le total du jour fait foi.`;
    const n = `${c.halves} demi-heure${c.halves > 1 ? 's' : ''} sur ${c.expected}`;
    return `${head}. Courbe incomplète ce jour-là (${n}) : le total du jour fait foi.`;
  }
  if (c.ok) return `${head}, que la courbe retrouve.`;
  const old = c.day < CURVE_READING_SINCE ? ' Ce jour a été rangé avec l’ancienne lecture de la courbe, pas encore reprise.' : '';
  return `${head}. Les demi-heures de la courbe font ${energy(c.curveKwh)} : elles ne retrouvent pas le total du jour, qui fait foi ; la courbe de ce jour est à lire avec prudence.${old}`;
}

/** Average power in W over the half hour(s) behind one curve key. */
export function watts(tz: string, key: string, wh: number): number {
  const n = halfHourCounts(tz, key.slice(0, 10))?.get(key.slice(11, 16)) ?? 1;
  return (wh * 2) / n;
}

const isWeekend = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Last day with curve points. */
export function lastCurveDay(curve: Curve): string | null {
  let last: string | null = null;
  for (const k of curve.keys()) if (!last || k > last) last = k;
  return last ? last.slice(0, 10) : null;
}

export interface TypicalDay {
  weekday: (number | null)[]; // 48 slots, W
  weekend: (number | null)[];
  days: { weekday: number; weekend: number };
}

/** Average power per half hour (W) over [from, to], weekdays and weekends apart. */
export function typicalDay(curve: Curve, tz: string, from: string, to: string): TypicalDay {
  const sum = { weekday: new Array(48).fill(0), weekend: new Array(48).fill(0) };
  const cnt = { weekday: new Array(48).fill(0), weekend: new Array(48).fill(0) };
  const days = { weekday: new Set<string>(), weekend: new Set<string>() };
  for (const [key, wh] of curve) {
    const day = key.slice(0, 10);
    if (day < from || day > to) continue;
    const i = SLOTS.indexOf(key.slice(11, 16));
    if (i < 0) continue;
    const g = isWeekend(day) ? 'weekend' : 'weekday';
    sum[g][i] += watts(tz, key, wh);
    cnt[g][i] += 1;
    days[g].add(day);
  }
  const avg = (g: 'weekday' | 'weekend') => sum[g].map((s, i) => (cnt[g][i] ? s / cnt[g][i] : null));
  return { weekday: avg('weekday'), weekend: avg('weekend'), days: { weekday: days.weekday.size, weekend: days.weekend.size } };
}

/**
 * Same average for hourly room data (kWh per local hour), spread over the two half hours of
 * each hour, restricted to the days present in the curve so both sides compare.
 */
export function typicalHourly(
  hourly: Hourly,
  rooms: Set<string>,
  tz: string,
  days: Set<string>,
): { weekday: number[]; weekend: number[] } {
  const perDay = new Map<string, number[]>(); // day -> 24 hours W
  let lastH = '';
  for (const [room, hours] of hourly) {
    if (!rooms.has(room)) continue;
    for (const [key, kwh] of hours) {
      const day = key.slice(0, 10);
      if (day > lastH) lastH = day;
      if (!days.has(day)) continue;
      const h = Number(key.slice(11, 13));
      const n = halfHourCounts(tz, day)?.get(`${key.slice(11, 13)}:00`) ?? 1;
      const row = perDay.get(day) ?? new Array(24).fill(0);
      row[h] += (kwh * 1000) / n;
      perDay.set(day, row);
    }
  }
  const out = { weekday: new Array(48).fill(0), weekend: new Array(48).fill(0) };
  const n = { weekday: 0, weekend: 0 };
  for (const day of days) {
    if (day > lastH) continue; // hourly data not collected yet for that day: not a zero
    const g = isWeekend(day) ? 'weekend' : 'weekday';
    n[g] += 1;
    const row = perDay.get(day);
    if (row) for (let i = 0; i < 48; i++) out[g][i] += row[i >> 1];
  }
  for (const g of ['weekday', 'weekend'] as const) if (n[g]) out[g] = out[g].map((v) => v / n[g]);
  return out;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Power measured by the radiators and the water heater, W per local hour, to subtract from the curve. */
export interface Measured {
  byHour: Map<string, number>; // "YYYY-MM-DDTHH" -> W
  last: string; // last day covered by the hourly data
}

/** Over [from, to] only when given (the cards need 30 days, not the whole history). */
export function measuredWatts(hourly: Hourly, rooms: Set<string>, tz: string, from = '', to = '\uffff'): Measured {
  const byHour = new Map<string, number>();
  let last = '';
  for (const [room, hours] of hourly) {
    if (!rooms.has(room)) continue;
    for (const [key, kwh] of hours) {
      const day = key.slice(0, 10);
      if (day < from || day > to) continue;
      if (day > last) last = day;
      const n = halfHourCounts(tz, day)?.get(`${key.slice(11, 13)}:00`) ?? 1;
      byHour.set(key, (byHour.get(key) ?? 0) + (kwh * 1000) / n);
    }
  }
  return { byHour, last };
}

/**
 * Standby base load: 10th percentile of the night half hours (01:00–05:00) over [from, to], W.
 * With `minus`, the radiators and water heater measured that hour are taken out first (they
 * run at night in winter and in off-peak hours), and days not covered by them are skipped.
 */
export function talon(
  curve: Curve,
  tz: string,
  from: string,
  to: string,
  minus?: Measured,
): { watts: number; samples: number } | null {
  const vals: number[] = [];
  for (const [key, wh] of curve) {
    const day = key.slice(0, 10);
    const hh = key.slice(11, 16);
    if (day < from || day > to || hh < '01:00' || hh >= '05:00') continue;
    if (minus && day > minus.last) continue;
    vals.push(Math.max(0, watts(tz, key, wh) - (minus?.byHour.get(key.slice(0, 13)) ?? 0)));
  }
  const w = percentile(vals, 0.1);
  return w === null ? null : { watts: w, samples: vals.length };
}

/** Highest half hour in [from, to]: average power (W) and its key. */
export function peakHalfHour(curve: Curve, tz: string, from: string, to: string): { key: string; watts: number } | null {
  let best: { key: string; watts: number } | null = null;
  for (const [key, wh] of curve) {
    const day = key.slice(0, 10);
    if (day < from || day > to) continue;
    const w = watts(tz, key, wh);
    if (!best || w > best.watts) best = { key, watts: w };
  }
  return best;
}

/** One day's curve: labels "HH:MM" in order and W (null where missing). */
export function dayCurve(curve: Curve, tz: string, day: string): { labels: string[]; values: (number | null)[] } {
  const labels = SLOTS;
  return { labels, values: labels.map((s) => (curve.has(`${day}T${s}`) ? watts(tz, `${day}T${s}`, curve.get(`${day}T${s}`)!) : null)) };
}

/** Days of the window [last-29, last] that have curve points. */
export function windowDays(curve: Curve, last: string, n = 30): { from: string; days: Set<string> } {
  const from = addDays(last, -(n - 1));
  const days = new Set<string>();
  for (const k of curve.keys()) {
    const d = k.slice(0, 10);
    if (d >= from && d <= last) days.add(d);
  }
  return { from, days };
}

// ------------------------------------------------------------------ memoised (#251)
// The Synthèse rebuilds its Linky cards on every setState: the hourly data never change once
// loaded, so these scans are done once per (hourly data, rooms, window) and shared by the
// load-curve and the « autres usages » cards.
export function measuredWattsCached(hourly: Hourly, rooms: Set<string>, tz: string, from: string, to: string): Measured {
  return memo(hourly, `mw|${setKey(rooms)}|${tz}|${from}|${to}`, () => measuredWatts(hourly, rooms, tz, from, to));
}

export function typicalHourlyCached(hourly: Hourly, rooms: Set<string>, tz: string, days: Set<string>): { weekday: number[]; weekend: number[] } {
  return memo(hourly, `th|${setKey(rooms)}|${tz}|${setKey(days)}`, () => typicalHourly(hourly, rooms, tz, days));
}
