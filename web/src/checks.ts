// Pure helpers for three checks: water heater in off-peak hours (S-2.10), lower setpoint
// simulation (S-4.11) and data quality per month (S-1.10). No DOM here.
import { type DayRecord, addDays } from './aggregate';
import { type Fit, type Hourly, type TariffMap, type Weather, fitSeason } from './analysis';

// ------------------------------------------------------------------ S-2.10 water heater HC share
export interface HcMonth {
  month: string; // YYYY-MM
  off: number; // kWh in the off-peak column
  peak: number; // kWh in the peak column
  share: number | null; // off / (off + peak)
}
export interface HcShare {
  off: number;
  peak: number;
  share: number | null;
  months: HcMonth[];
}

/** Off-peak share of the water heater(s) between from and to (days with tariff detail only). */
export function waterHeaterHc(tariffs: TariffMap, rooms: string[], off: 1 | 2, from: string, to: string): HcShare {
  const on = off === 1 ? 2 : 1;
  const byMonth = new Map<string, HcMonth>();
  for (const room of rooms) {
    for (const [day, t] of tariffs.get(room) ?? []) {
      if (day < from || day > to || t[1] + t[2] <= 0) continue;
      const m = day.slice(0, 7);
      const e = byMonth.get(m) ?? { month: m, off: 0, peak: 0, share: null };
      e.off += t[off];
      e.peak += t[on];
      byMonth.set(m, e);
    }
  }
  const months = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  for (const m of months) m.share = m.off + m.peak > 0 ? m.off / (m.off + m.peak) : null;
  const o = months.reduce((s, m) => s + m.off, 0);
  const p = months.reduce((s, m) => s + m.peak, 0);
  return { off: o, peak: p, share: o + p > 0 ? o / (o + p) : null, months };
}

export interface HcVerdict {
  ok: boolean;
  text: string;
}

/** Compared on the rounded percentage, so a month shown as "90 %" is never flagged under 90 %. */
export const belowThreshold = (share: number | null, threshold: number) =>
  share !== null && Math.round(share * 100) < Math.round(threshold * 100);

/** "95 % en heures creuses : bien réglé" or a hint to check the day/night contactor. */
export function hcVerdict(share: number, threshold = 0.9): HcVerdict {
  const p = Math.round(share * 100);
  if (!belowThreshold(share, threshold)) return { ok: true, text: `${p} % en heures creuses : bien réglé` };
  return {
    ok: false,
    text: `${100 - p} % en heures pleines : vérifiez le contacteur jour/nuit ou la programmation de l'Aqua Manager`,
  };
}

/** Extra cost of the peak-hour kWh compared with heating them all in off-peak hours. */
export const peakExtraCost = (peakKwh: number, hp: number, hc: number) => Math.max(0, peakKwh * (hp - hc));

/** Average kWh per hour of the day, month by month (heatmap rows = months). */
export function hourByMonth(hourly: Hourly, rooms: Set<string>, from: string, to: string): { months: string[]; grid: number[][] } {
  const sums = new Map<string, number[]>();
  const days = new Map<string, Set<string>>();
  for (const room of rooms) {
    for (const [key, kwh] of hourly.get(room) ?? []) {
      const day = key.slice(0, 10);
      if (day < from || day > to) continue;
      const m = day.slice(0, 7);
      if (!sums.has(m)) sums.set(m, new Array(24).fill(0)), days.set(m, new Set());
      sums.get(m)![Number(key.slice(11, 13))] += kwh;
      days.get(m)!.add(day);
    }
  }
  const months = [...sums.keys()].sort();
  return { months, grid: months.map((m) => sums.get(m)!.map((v) => v / Math.max(1, days.get(m)!.size))) };
}

// ------------------------------------------------------------------ S-4.11 setpoint simulation
export const ADEME_PER_DEGREE = 0.07; // rule of thumb: about 7 % of heating per °C

export interface SetpointSim {
  season: string;
  slope: number; // kWh per °C of difference (positive)
  balance: number; // °C, no heating above
  days: number; // days of the season with weather
  modelKwh: number; // heating predicted by the signature at the current setpoint
  newKwh: number; // with the balance point shifted by dT
  savedKwh: number; // modelKwh - newKwh (negative when raising the setpoint)
  pct: number; // savedKwh / modelKwh × 100
  ademePct: number; // rule of thumb, same sign as pct
}

/**
 * Lowering the indoor setpoint by ΔT lowers the balance temperature (where heating
 * stops) by ΔT: kWh(day) = slope × max(0, balance + dT − T_out). dT < 0 = lower setpoint.
 */
export function simulateSetpoint(weather: Weather, from: string, to: string, fit: Fit, dT: number, season = ''): SetpointSim | null {
  if (fit.balance === null || fit.slope >= 0) return null;
  const slope = -fit.slope;
  let model = 0;
  let next = 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weather.get(d);
    if (!w) continue;
    days++;
    model += slope * Math.max(0, fit.balance - w[2]);
    next += slope * Math.max(0, fit.balance + dT - w[2]);
  }
  if (!days || model <= 0) return null;
  const saved = model - next;
  return {
    season,
    slope,
    balance: fit.balance,
    days,
    modelKwh: model,
    newKwh: next,
    savedKwh: saved,
    pct: (saved / model) * 100,
    ademePct: -dT * ADEME_PER_DEGREE * 100,
  };
}

/** Last complete heating season (September → August) with a usable signature, else the latest usable one. */
export function referenceSeason(
  sig: Map<string, [number, number, string][]>,
  lastDay: string,
): { season: string; fit: Fit; from: string; to: string; complete: boolean } | null {
  const seasons = [...sig.keys()].sort().reverse();
  let fallback: { season: string; fit: Fit; from: string; to: string; complete: boolean } | null = null;
  for (const s of seasons) {
    const fit = fitSeason(sig.get(s)!);
    if (!fit || fit.balance === null || fit.slope >= 0) continue;
    const from = `${s.slice(0, 4)}-09-01`;
    const end = `${s.slice(5, 9)}-08-31`;
    const complete = end <= lastDay;
    const cand = { season: s, fit, from, to: complete ? end : lastDay, complete };
    if (complete) return cand;
    fallback ??= cand;
  }
  return fallback;
}

/** Share of each heating room in the season's heating kWh. */
export function roomShares(records: DayRecord[], from: string, to: string): Map<string, number> {
  const per = new Map<string, number>();
  let all = 0;
  for (const r of records) {
    if (r.cat !== 'heating' || r.day < from || r.day > to) continue;
    per.set(r.room, (per.get(r.room) ?? 0) + r.kwh);
    all += r.kwh;
  }
  return new Map([...per].map(([k, v]) => [k, all > 0 ? v / all : 0]));
}

// ------------------------------------------------------------------ S-1.10 data quality
/** room -> "YYYY-MM" -> [days with a real value, days estimated, days missing]. */
export type Coverage = Map<string, Map<string, [number, number, number]>>;

/**
 * Same computation as the collector (storage.month_coverage), for archives saved before
 * it existed: a room counts from its first stored day to the archive's last day.
 */
export function computeCoverage(records: DayRecord[], estimated: Set<string>, lastDay: string): Coverage {
  const days = new Map<string, Set<string>>();
  for (const r of records) {
    if (!days.has(r.room)) days.set(r.room, new Set());
    days.get(r.room)!.add(r.day);
  }
  const out: Coverage = new Map();
  for (const [room, set] of days) {
    const first = [...set].reduce((a, b) => (b < a ? b : a));
    const months = new Map<string, [number, number, number]>();
    for (let d = first; d <= lastDay; d = addDays(d, 1)) {
      const m = d.slice(0, 7);
      const cell = months.get(m) ?? [0, 0, 0];
      cell[estimated.has(`${room}|${d}`) ? 1 : set.has(d) ? 0 : 2]++;
      months.set(m, cell);
    }
    out.set(room, months);
  }
  return out;
}

export interface MonthGap {
  month: string;
  estimated: number; // days estimated, worst room
  missing: number; // days missing, worst room
  rooms: string[]; // rooms with at least one estimated or missing day
}

/** Months where at least one room has an estimated or a missing day, most recent first. */
export function gapMonths(cov: Coverage, rooms: Set<string> | null = null): MonthGap[] {
  const out = new Map<string, MonthGap>();
  for (const [room, months] of cov) {
    if (rooms && !rooms.has(room)) continue;
    for (const [m, [, est, miss]] of months) {
      if (!est && !miss) continue;
      const g = out.get(m) ?? { month: m, estimated: 0, missing: 0, rooms: [] };
      g.estimated = Math.max(g.estimated, est);
      g.missing = Math.max(g.missing, miss);
      g.rooms.push(room);
      out.set(m, g);
    }
  }
  return [...out.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Days where one of the given rooms is estimated or missing (between its first and last day). */
export function uncertainDays(records: DayRecord[], estimated: Set<string>, from: string, to: string): Set<string> {
  const out = new Set<string>();
  const byRoom = new Map<string, Set<string>>();
  const first = new Map<string, string>();
  const last = new Map<string, string>();
  for (const r of records) {
    if (!byRoom.has(r.room)) byRoom.set(r.room, new Set());
    byRoom.get(r.room)!.add(r.day);
    if (!first.has(r.room) || r.day < first.get(r.room)!) first.set(r.room, r.day);
    if (!last.has(r.room) || r.day > last.get(r.room)!) last.set(r.room, r.day);
    if (r.day >= from && r.day <= to && estimated.has(`${r.room}|${r.day}`)) out.add(r.day);
  }
  for (const [room, set] of byRoom) {
    const end = last.get(room)! < to ? last.get(room)! : to;
    for (let d = first.get(room)! > from ? first.get(room)! : from; d <= end; d = addDays(d, 1)) if (!set.has(d)) out.add(d);
  }
  return out;
}
