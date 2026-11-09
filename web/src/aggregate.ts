// Pure data functions: filtering, bucketing and year-over-year helpers. No DOM here.

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
  has_tariffs?: boolean;
  has_temps?: boolean;
  has_linky?: boolean;
  has_roomstate?: boolean; // E13: roomstate.enc.json (hourly room states, daily aggregates)
  weather_source?: string | null;
  contract?: unknown; // S-12.1: shared contract periods, validated in contract.ts
}

export interface DayRecord {
  day: string; // YYYY-MM-DD (local day of the home)
  room: string;
  cat: Category;
  kwh: number;
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface Filter {
  cats: Set<Category>;
  rooms: Set<string> | null; // null = all rooms
}

export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const CATEGORY_LABEL: Record<Category, string> = { heating: 'Chauffage', water_heater: 'Chauffe-eau', ignore: 'Ignoré' };

/** Flatten {year: {daily: {room: {day: Wh}}}} into kWh records. */
export function toRecords(meta: Meta, years: Record<string, Record<string, Record<string, number>>>): DayRecord[] {
  const cat = new Map(meta.rooms.map((r) => [r.id, r.category] as const));
  const out: DayRecord[] = [];
  for (const daily of Object.values(years)) {
    for (const [room, days] of Object.entries(daily)) {
      const c = cat.get(room) ?? 'heating';
      if (c === 'ignore') continue;
      for (const [day, wh] of Object.entries(days)) out.push({ day, room, cat: c, kwh: wh / 1000 });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
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

/** Running total per day of year (index 0 = 1 Jan); null after the last day with data. */
export function cumulativeByYear(records: DayRecord[], lastDay: string): Map<number, (number | null)[]> {
  const daily = new Map<number, number[]>();
  for (const r of records) {
    const y = Number(r.day.slice(0, 4));
    let arr = daily.get(y);
    if (!arr) daily.set(y, (arr = new Array(366).fill(0)));
    arr[dayOfYear(r.day)] += r.kwh;
  }
  const out = new Map<number, (number | null)[]>();
  for (const [y, arr] of daily) {
    const stop = y === Number(lastDay.slice(0, 4)) ? dayOfYear(lastDay) : 365;
    let acc = 0;
    out.set(
      y,
      arr.map((v, i) => (i > stop ? null : (acc += v))),
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
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ['date;piece;categorie;kwh'];
  for (const r of records) {
    lines.push([r.day, esc(name.get(r.room) ?? r.room), CATEGORY_LABEL[r.cat], r.kwh.toFixed(3).replace('.', ',')].join(';'));
  }
  return lines.join('\n') + '\n';
}
