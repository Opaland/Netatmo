// S-1.10 (suite): days lost at Intuis rebuilt *apart* from the measured data, and real days
// that look implausibly low ("suspects"). Pure functions, no DOM: the view lives in
// views/reconstitution.ts and is loaded on demand.
//
// Two ways to rebuild what the lost rooms consumed on a lost day:
// - Linky: whole-home kWh of that day − the other usages (median of "Linky − Intuis" over
//   nearby complete days) − what the rooms still recorded that day;
// - signature: heating signature of the season × outdoor temperature, times the share of
//   the lost heating rooms; for a water heater, its median over nearby complete days.
// Linky is a measurement, so it wins when it is there; the signature is the fallback.
import { type Category, type DayRecord, addDays, rawRecords, seasonOf } from './aggregate';
import { type Fit, type Weather, fitSeason } from './analysis';

/** day -> rooms without a value that day (between the room's first and last stored day). */
export function lostDays(records: DayRecord[]): Map<string, Set<string>> {
  const byRoom = new Map<string, Set<string>>();
  for (const r of rawRecords(records)) {
    if (!byRoom.has(r.room)) byRoom.set(r.room, new Set());
    byRoom.get(r.room)!.add(r.day);
  }
  const out = new Map<string, Set<string>>();
  for (const [room, set] of byRoom) {
    const sorted = [...set].sort();
    for (let d = sorted[0]; d <= sorted[sorted.length - 1]; d = addDays(d, 1)) {
      if (set.has(d)) continue;
      if (!out.has(d)) out.set(d, new Set());
      out.get(d)!.add(room);
    }
  }
  return out;
}

/** Days that are not fully measured: a room lost, or a room estimated from a monthly total. */
export function uncertainSet(lost: Map<string, Set<string>>, estimated: Set<string>): Set<string> {
  const out = new Set(lost.keys());
  for (const k of estimated) out.add(k.slice(k.indexOf('|') + 1));
  return out;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface DayIndex {
  perDay: Map<string, Map<string, number>>; // day -> room -> kWh
  cat: Map<string, Category>;
  total: (day: string) => number;
  heating: (day: string) => number;
}

function index(records: DayRecord[]): DayIndex {
  const perDay = new Map<string, Map<string, number>>();
  const cat = new Map<string, Category>();
  for (const r of rawRecords(records)) {
    cat.set(r.room, r.cat);
    if (!perDay.has(r.day)) perDay.set(r.day, new Map());
    const m = perDay.get(r.day)!;
    m.set(r.room, (m.get(r.room) ?? 0) + r.kwh);
  }
  const sum = (day: string, only?: Category) => {
    let s = 0;
    for (const [room, k] of perDay.get(day) ?? []) if (!only || cat.get(room) === only) s += k;
    return s;
  };
  return { perDay, cat, total: (d) => sum(d), heating: (d) => sum(d, 'heating') };
}

/** Season fits on complete days only (lost or estimated days would bias the line). */
export function cleanFits(records: DayRecord[], weather: Weather, uncertain: Set<string>): Map<string, Fit> {
  const idx = index(records);
  const pts = new Map<string, [number, number, string][]>();
  for (const day of idx.perDay.keys()) {
    const w = weather.get(day);
    if (!w || uncertain.has(day)) continue;
    const s = seasonOf(day);
    if (!pts.has(s)) pts.set(s, []);
    pts.get(s)!.push([w[2], idx.heating(day), day]);
  }
  const out = new Map<string, Fit>();
  for (const [s, p] of pts) {
    const fit = fitSeason(p);
    if (fit && fit.slope < 0) out.set(s, fit);
  }
  return out;
}

/** The season's fit, else the nearest season with one. */
function fitFor(fits: Map<string, Fit>, day: string): Fit | null {
  const s = seasonOf(day);
  if (fits.has(s)) return fits.get(s)!;
  let best: [number, Fit] | null = null;
  for (const [k, f] of fits) {
    const gap = Math.abs(Number(k.slice(0, 4)) - Number(s.slice(0, 4)));
    if (!best || gap < best[0]) best = [gap, f];
  }
  return best?.[1] ?? null;
}

/** Heating kWh the signature predicts at this outdoor mean temperature. */
export function predictHeating(fit: Fit, tOut: number): number {
  if (tOut >= 15 || (fit.balance !== null && tOut >= fit.balance)) return 0;
  return Math.max(0, fit.slope * tOut + fit.intercept);
}

export interface Rebuilt {
  day: string;
  rooms: string[]; // rooms lost that day
  kwh: number; // kWh rebuilt for those rooms (the value shown, never added to the measured data)
  byRoom: Map<string, number>;
  method: 'linky' | 'signature';
  linky: number | null; // Linky-based estimate, when possible
  signature: number | null; // signature-based estimate, when possible
}

export interface RebuildOptions {
  weather: Weather | null;
  linky: Map<string, number>;
  estimated: Set<string>;
  window?: number; // days around the lost day used as reference (default 21)
  minRef?: number; // reference days needed for the Linky method (default 5)
}

/** Complete days (every room measured, nothing estimated) within ±window days. */
function nearby(day: string, window: number, idx: DayIndex, uncertain: Set<string>): string[] {
  const out: string[] = [];
  for (let k = -window; k <= window; k++) {
    const d = addDays(day, k);
    if (k !== 0 && idx.perDay.has(d) && !uncertain.has(d)) out.push(d);
  }
  return out;
}

/** "Linky − Intuis" on nearby complete days: the other usages of the home (median). */
function otherUsage(refs: string[], idx: DayIndex, linky: Map<string, number>, minRef: number): number | null {
  const v = refs.filter((d) => linky.has(d)).map((d) => linky.get(d)! - idx.total(d));
  return v.length >= minRef ? median(v) : null;
}

export function rebuildLost(records: DayRecord[], opts: RebuildOptions): Rebuilt[] {
  const window = opts.window ?? 21;
  const minRef = opts.minRef ?? 5;
  const idx = index(records);
  const lost = lostDays(records);
  const uncertain = uncertainSet(lost, opts.estimated);
  const fits = opts.weather ? cleanFits(records, opts.weather, uncertain) : new Map<string, Fit>();
  const out: Rebuilt[] = [];
  for (const day of [...lost.keys()].sort()) {
    const rooms = [...lost.get(day)!].sort();
    const refs = nearby(day, window, idx, uncertain);
    // Per lost room, a signature-based (heating) or typical (water heater) value.
    const typical = new Map<string, number>();
    let sigOk = true;
    const w = opts.weather?.get(day);
    const fit = w ? fitFor(fits, day) : null;
    const heatRefs = refs.filter((d) => idx.heating(d) > 0.2);
    for (const room of rooms) {
      if (idx.cat.get(room) === 'water_heater') {
        const m = median(refs.map((d) => idx.perDay.get(d)!.get(room) ?? 0));
        if (m === null) sigOk = false;
        typical.set(room, m ?? 0);
      } else {
        // share of this room in the heating of nearby complete heating days
        const all = heatRefs.reduce((s, d) => s + idx.heating(d), 0);
        const mine = heatRefs.reduce((s, d) => s + (idx.perDay.get(d)!.get(room) ?? 0), 0);
        const share = all > 0 ? mine / all : null;
        if (!fit || !w || share === null) {
          sigOk = false;
          typical.set(room, mine / Math.max(1, heatRefs.length));
        } else typical.set(room, predictHeating(fit, w[2]) * share);
      }
    }
    const signature = sigOk ? [...typical.values()].reduce((a, b) => a + b, 0) : null;
    let linkyEst: number | null = null;
    if (opts.linky.has(day)) {
      const other = otherUsage(refs, idx, opts.linky, minRef);
      if (other !== null) linkyEst = Math.max(0, opts.linky.get(day)! - other - idx.total(day));
    }
    const kwh = linkyEst ?? signature;
    if (kwh === null) continue;
    const weights = [...typical.values()].reduce((a, b) => a + b, 0);
    const byRoom = new Map(rooms.map((r) => [r, weights > 0 ? (kwh * typical.get(r)!) / weights : kwh / rooms.length]));
    out.push({ day, rooms, kwh, byRoom, method: linkyEst !== null ? 'linky' : 'signature', linky: linkyEst, signature });
  }
  return out;
}

// ------------------------------------------------------------------ suspects
export interface Suspect {
  day: string;
  kwh: number; // heating recorded
  expected: number; // heating predicted by the signature
  ratio: number; // kwh / expected
  linky: number | null; // Intuis total implied by Linky (null without Linky)
  recorded: number; // Intuis total recorded (heating + water heater)
}

export const SUSPECT_RATIO = 0.35;

/**
 * Real days (nothing lost or estimated) where heating is far below the signature on a cold
 * day. With Linky, a day where the meter confirms the low value (absence, hors-gel) is not
 * suspect: only days where Linky says more energy went to the radiators are kept.
 */
export function suspectDays(
  records: DayRecord[],
  opts: RebuildOptions & { ratio?: number; minExpected?: number },
): Suspect[] {
  if (!opts.weather) return [];
  const ratio = opts.ratio ?? SUSPECT_RATIO;
  const minExpected = opts.minExpected ?? 5;
  const window = opts.window ?? 21;
  const minRef = opts.minRef ?? 5;
  const idx = index(records);
  const uncertain = uncertainSet(lostDays(records), opts.estimated);
  const fits = cleanFits(records, opts.weather, uncertain);
  // first pass: low days, excluded from the reference days of each other
  const low: Suspect[] = [];
  for (const day of [...idx.perDay.keys()].sort()) {
    const w = opts.weather.get(day);
    const fit = fitFor(fits, day);
    if (!w || !fit || uncertain.has(day)) continue;
    const expected = predictHeating(fit, w[2]);
    const kwh = idx.heating(day);
    if (expected >= minExpected && kwh < ratio * expected) {
      low.push({ day, kwh, expected, ratio: kwh / expected, linky: null, recorded: idx.total(day) });
    }
  }
  const lowSet = new Set(low.map((s) => s.day));
  const excluded = new Set([...uncertain, ...lowSet]);
  return low.filter((s) => {
    if (!opts.linky.has(s.day)) return true;
    const other = otherUsage(nearby(s.day, window, idx, excluded), idx, opts.linky, minRef);
    if (other === null) return true;
    s.linky = Math.max(0, opts.linky.get(s.day)! - other);
    // Linky agrees with the low value (absence): not a data problem.
    return s.linky > s.recorded + Math.max(3, 0.5 * (s.expected - s.kwh));
  });
}

// ------------------------------------------------------------------ totals
export interface YearRebuild {
  year: string;
  measured: number;
  rebuilt: number;
  days: number;
  linky: number; // days rebuilt from Linky
  signature: number; // days rebuilt from the signature
}

/** Per year: measured kWh, rebuilt kWh (kept apart) and how many days each method rebuilt. */
export function rebuildTotals(records: DayRecord[], rebuilt: Rebuilt[]): YearRebuild[] {
  const out = new Map<string, YearRebuild>();
  const get = (y: string) => {
    if (!out.has(y)) out.set(y, { year: y, measured: 0, rebuilt: 0, days: 0, linky: 0, signature: 0 });
    return out.get(y)!;
  };
  for (const r of records) get(r.day.slice(0, 4)).measured += r.kwh;
  for (const r of rebuilt) {
    const e = get(r.day.slice(0, 4));
    e.rebuilt += r.kwh;
    e.days++;
    e[r.method]++;
  }
  return [...out.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
}
