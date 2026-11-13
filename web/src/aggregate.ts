// Pure data functions: filtering, bucketing and year-over-year helpers. No DOM here.

import { textCell } from './csv';

export type Category = 'heating' | 'water_heater' | 'ignore';

export interface Room {
  id: string;
  name: string;
  category: Category;
  module_types: string[];
}

export interface Meta {
  home: { id: string; name: string; timezone: string };
  rooms: Room[];
  years: number[];
  first_day: string | null;
  last_day: string | null;
  updated: string;
  hourly_years?: number[];
  station_hourly_years?: number[];
  room30_years?: number[]; // S-1.26: YYYY.room30.enc.json, per-room half hours (loaded on demand)
  has_tariffs?: boolean;
  has_temps?: boolean;
  has_linky?: boolean;
  has_roomstate?: boolean; // E13: roomstate.enc.json (hourly room states, daily aggregates)
  has_ha?: boolean; // S-1.18: ha.enc.json (Home Assistant import, daily aggregates per sensor)
  weather_source?: string | null;
  contract?: unknown; // S-12.1: shared contract periods, validated in contract.ts
  catch_up?: unknown; // #569: what the catch-up asked and got back, read by data-quality.ts catchUpOf
}

export interface DayRecord {
  day: string; // YYYY-MM-DD (local day of the home)
  room: string;
  cat: Category;
  kwh: number;
  /** S-12.2 household view: the raw records a merged « Chambres » day is made of. */
  parts?: DayRecord[];
}

/**
 * The raw per-room records behind these records (#238, #239): a merged « Chambres » day is
 * replaced by its bedrooms. Every computation that looks a room up in another per-room
 * document (tariff detail, estimated days, room states) works on these.
 */
export function rawRecords(records: DayRecord[]): DayRecord[] {
  return records.some((r) => r.parts) ? records.flatMap((r) => r.parts ?? [r]) : records;
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface Filter {
  cats: Set<Category>;
  rooms: Set<string> | null; // null = all rooms
}

export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const CATEGORY_LABEL: Record<Category, string> = { heating: 'Chauffage', water_heater: 'Chauffe-eau', ignore: 'Ignoré' };

/** #532: a day read from the file of `year`, when the day was already read from another file:
 * kept only when `year` is the day's own year (else the first read stays). One rule for every
 * section of the year files (energy, tariffs, temperatures), as the collector's own_year_first. */
export const keepFromYear = (seen: boolean, day: string, year: string): boolean => !seen || day.slice(0, 4) === year;

/** {room: {day: v}} of one year file into `into`, by keepFromYear. The keys may be days, hours or
 * half hours ("YYYY-MM-DD…"): their first four characters are their year. `as` converts a value
 * (Wh to kWh for the hours). #550: the fine series (hours, half hours, station, curve) too. */
export function mergeYear<V, W = V>(
  o: Record<string, Record<string, V>> | undefined,
  year: string | number,
  into: Map<string, Map<string, W>>,
  as: (v: V) => W = (v) => v as unknown as W,
): void {
  for (const [room, days] of Object.entries(o ?? {})) {
    const m = into.get(room) ?? new Map<string, W>();
    mergeFlatYear(days, year, m, as);
    into.set(room, m);
  }
}

/** {key: v} of one year file into `into`, by keepFromYear (the Linky curve has no room level). */
export function mergeFlatYear<V, W = V>(o: Record<string, V> | undefined, year: string | number, into: Map<string, W>, as: (v: V) => W = (v) => v as unknown as W): void {
  const y = String(year);
  for (const [k, v] of Object.entries(o ?? {})) if (keepFromYear(into.has(k), k, y)) into.set(k, as(v));
}

/**
 * Flatten {year: {daily: {room: {day: Wh}}}} into kWh records. #532: a room-day found in two year
 * files is one record, never two added: the file of the day's own year wins, else the first read
 * (the rule of the collector, storage.py `own_year_first`; the data audit names such days).
 */
export function toRecords(meta: Meta, years: Record<string, Record<string, Record<string, number>>>): DayRecord[] {
  const cat = new Map(meta.rooms.map((r) => [r.id, r.category] as const));
  const seen = new Map<string, DayRecord>();
  for (const [year, daily] of Object.entries(years)) {
    for (const [room, days] of Object.entries(daily)) {
      const c = cat.get(room) ?? 'heating';
      if (c === 'ignore') continue;
      for (const [day, wh] of Object.entries(days)) {
        const k = `${room}|${day}`;
        if (keepFromYear(seen.has(k), day, year)) seen.set(k, { day, room, cat: c, kwh: wh / 1000 });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function applyFilter(records: DayRecord[], f: Filter): DayRecord[] {
  return records.filter((r) => f.cats.has(r.cat) && (!f.rooms || f.rooms.has(r.room)));
}

// ------------------------------------------------------------------ dates
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** Same calendar day one year earlier (29 Feb → 28 Feb). */
export function minusYears(day: string, n = 1): string {
  const y = Number(day.slice(0, 4)) - n;
  const md = day.slice(5);
  return md === '02-29' ? `${y}-02-28` : `${y}-${md}`;
}

export function dayOfYear(day: string): number {
  const d = toDate(day);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const d = toDate(day);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

export function bucketKey(day: string, g: Granularity): string {
  switch (g) {
    case 'day':
      return day;
    case 'week':
      return weekStart(day);
    case 'month':
      return day.slice(0, 7);
    case 'year':
      return day.slice(0, 4);
  }
}

export function bucketLabel(key: string, g: Granularity): string {
  if (g === 'year') return key;
  if (g === 'month') return `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const d = toDate(key);
  const base = `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${key.slice(0, 4)}`;
  return g === 'week' ? `sem. du ${base}` : base;
}

/** Every bucket between two days, in order, including empty ones. */
export function bucketKeys(from: string, to: string, g: Granularity): string[] {
  // Day-by-day walk: a few thousand iterations at most, and correct for every granularity.
  const keys: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(d, g);
    if (k !== keys[keys.length - 1]) keys.push(k);
  }
  return keys;
}

// ------------------------------------------------------------------ aggregation
export interface SeriesSet {
  keys: string[];
  groups: Map<string, number[]>; // group id -> value per key
}

/** Sum records per bucket, split by `groupOf` (category, room, or a single group). */
export function aggregate(
  records: DayRecord[],
  from: string,
  to: string,
  g: Granularity,
  groupOf: (r: DayRecord) => string,
): SeriesSet {
  const keys = bucketKeys(from, to, g);
  const index = new Map(keys.map((k, i) => [k, i]));
  const groups = new Map<string, number[]>();
  for (const r of records) {
    if (r.day < from || r.day > to) continue;
    const i = index.get(bucketKey(r.day, g));
    if (i === undefined) continue;
    const id = groupOf(r);
    let arr = groups.get(id);
    if (!arr) groups.set(id, (arr = new Array(keys.length).fill(0)));
    arr[i] += r.kwh;
  }
  return { keys, groups };
}

export function total(records: DayRecord[], from: string, to: string): number {
  let s = 0;
  for (const r of records) if (r.day >= from && r.day <= to) s += r.kwh;
  return s;
}

export function totalsBy<K extends string>(records: DayRecord[], from: string, to: string, key: (r: DayRecord) => K) {
  const m = new Map<K, number>();
  for (const r of records) if (r.day >= from && r.day <= to) m.set(key(r), (m.get(key(r)) ?? 0) + r.kwh);
  return m;
}

/** Monthly totals per calendar year: year -> 12 values (null for months with no data at all). */
export function monthlyByYear(records: DayRecord[]): Map<number, (number | null)[]> {
  const out = new Map<number, (number | null)[]>();
  for (const r of records) {
    const y = Number(r.day.slice(0, 4));
    const m = Number(r.day.slice(5, 7)) - 1;
    let arr = out.get(y);
    if (!arr) out.set(y, (arr = new Array(12).fill(null)));
    arr[m] = (arr[m] ?? 0) + r.kwh;
  }
  return out;
}

/** Heating seasons run September → August; key "2024-2025". */
export function seasonOf(day: string): string {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
export const SEASON_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]; // month indexes, Sept first

export function monthlyBySeason(records: DayRecord[]): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  for (const r of records) {
    const s = seasonOf(r.day);
    const i = SEASON_MONTHS.indexOf(Number(r.day.slice(5, 7)) - 1);
    let arr = out.get(s);
    if (!arr) out.set(s, (arr = new Array(12).fill(null)));
    arr[i] = (arr[i] ?? 0) + r.kwh;
  }
  return out;
}

/**
 * Index of a day on a leap-year axis (#245): 1 Jan = 0, 29 Feb = 59, 1 Mar = 60 in every
 * year, so that the same date lines up across leap and non-leap years.
 */
export function leapDayIndex(day: string): number {
  const y = Number(day.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return dayOfYear(day) + (!leap && day.slice(5) >= '03-01' ? 1 : 0);
}

/**
 * Running total per day on a leap-year axis (index 0 = 1 Jan, 59 = 29 Feb, 365 = 31 Dec);
 * null before the first and after the last day with data. In a non-leap year, 29 Feb repeats 28 Feb (#245).
 * `breaks`: days drawn as a gap (estimated or lost days, #297) while the total goes on.
 */
export function cumulativeByYear(records: DayRecord[], lastDay: string, breaks?: Set<string>): Map<number, (number | null)[]> {
  const daily = new Map<number, number[]>();
  let first = '';
  for (const r of records) {
    const y = Number(r.day.slice(0, 4));
    let arr = daily.get(y);
    if (!arr) daily.set(y, (arr = new Array(366).fill(0)));
    arr[leapDayIndex(r.day)] += r.kwh;
    if (!first || r.day < first) first = r.day;
  }
  const gaps = new Map<number, Set<number>>();
  for (const d of breaks ?? []) {
    const y = Number(d.slice(0, 4));
    if (!gaps.has(y)) gaps.set(y, new Set());
    gaps.get(y)!.add(leapDayIndex(d));
  }
  const out = new Map<number, (number | null)[]>();
  for (const [y, arr] of daily) {
    const stop = y === Number(lastDay.slice(0, 4)) ? leapDayIndex(lastDay) : 365;
    // first data year: nothing is drawn before the collection started
    const start = y === Number(first.slice(0, 4)) ? leapDayIndex(first) : 0;
    const g = gaps.get(y);
    let acc = 0;
    out.set(
      y,
      arr.map((v, i) => {
        acc += v;
        return i > stop || i < start || g?.has(i) ? null : acc;
      }),
    );
  }
  return out;
}

export function pctChange(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

// ------------------------------------------------------------------ CSV
export function toCsv(records: DayRecord[], rooms: Room[]): string {
  const name = new Map(rooms.map((r) => [r.id, r.name]));
  const lines = ['date;piece;categorie;kwh'];
  for (const r of records) {
    lines.push([r.day, textCell(name.get(r.room) ?? r.room, ';'), CATEGORY_LABEL[r.cat], r.kwh.toFixed(3).replace('.', ',')].join(';'));
  }
  return lines.join('\n') + '\n';
}
