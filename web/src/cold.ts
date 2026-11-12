// S-12.5: prolonged cold in a living room. Pure functions, same rule as the collector
// (collector/cold.py): a room is « cold » when its daily mean temperature stayed below the
// threshold on its last `days` measured days (a daily mean = 24 h), and « without recent
// reading » when its last reading is more than 2 days older than the archive.
import type { Dataset } from './data';

export interface Sensor {
  id: string;
  name: string;
  kind: 'radiateur' | 'station';
  means: Map<string, number>; // day -> mean °C
}

/**
 * Rooms with a daily temperature: Intuis heating rooms with data (radiator probe) and indoor
 * station modules. Give it the RAW dataset (#242): the collector knows only raw ids, never
 * « Chambres », and a mean of bedrooms would hide a cold one.
 */
export function coldSensors(d: Pick<Dataset, 'meta' | 'records' | 'temps' | 'station'>): Sensor[] {
  const withData = new Set(d.records.map((r) => r.room));
  const out: Sensor[] = [];
  for (const r of d.meta.rooms) {
    const t = d.temps.get(r.id);
    if (r.category !== 'heating' || !withData.has(r.id) || !t?.size) continue;
    out.push({ id: r.id, name: r.name, kind: 'radiateur', means: new Map([...t].map(([day, v]) => [day, v[0]])) });
  }
  for (const [id, m] of Object.entries(d.station?.modules ?? {})) {
    if (!m.indoor) continue;
    const means = new Map<string, number>();
    for (const [day, v] of Object.entries(d.station!.daily[id] ?? {})) if (typeof v[2] === 'number') means.set(day, v[2]);
    if (means.size) out.push({ id, name: m.name, kind: 'station', means });
  }
  return out;
}

export interface ColdConfig {
  threshold: number; // °C
  days: number; // consecutive days (1 = 24 h)
  rooms: string[]; // Intuis room ids or station module ids, in pseudonym order (Pièce A, B…)
}

export const COLD_THRESHOLDS = [8, 10, 12, 14, 16, 17, 18];
export const COLD_DAYS = [1, 2, 3];
export const COLD_MAX_ROOMS = 10;

/** Validated configuration, or null (disabled, unset or invalid). Mirrors parse_cold_alert. */
export function parseColdConfig(raw: unknown): ColdConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // #359: a number or a numeric string only; Number() of an object with an own `toString` throws
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
  const threshold = num(o.threshold);
  const days = o.days === undefined ? 1 : num(o.days);
  if (!Number.isFinite(threshold) || threshold < 5 || threshold > 22) return null;
  if (!Number.isInteger(days) || days < 1 || days > 7) return null;
  if (!Array.isArray(o.rooms)) return null;
  const rooms = [...new Set(o.rooms.filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 64))];
  if (!rooms.length || rooms.length > COLD_MAX_ROOMS) return null;
  return { threshold, days, rooms };
}

/**
 * #359: the draft kept on this device while the alert is being chosen (rooms may be empty).
 * Unlike parseColdConfig it never refuses the whole draft for one bad field: each field falls
 * back to its default. Before, `days` was taken as stored (a string or 99 went through).
 */
export function parseColdDraft(raw: unknown): ColdConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.threshold !== 'number' || !Number.isFinite(o.threshold) || o.threshold < 5 || o.threshold > 22) return null;
  if (!Array.isArray(o.rooms)) return null;
  const days = COLD_DAYS.includes(o.days as number) ? (o.days as number) : 1;
  const rooms = [...new Set(o.rooms.filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 64))];
  return { threshold: o.threshold, days, rooms };
}

/** The repository secret COLD_ALERT_JSON for this configuration (#497). */
export function coldJson(c: ColdConfig): string {
  return JSON.stringify({ threshold: c.threshold, days: c.days, rooms: c.rooms });
}

/** « Pièce A », « Pièce B »… by position in the configuration (the public issue only shows these). */
export const coldPseudonym = (i: number) => `Pièce ${String.fromCharCode(65 + (i % 26))}`;

export type ColdStatus = 'cold' | 'ok' | 'stale';

export interface ColdResult {
  status: ColdStatus;
  lastDay: string | null;
  streak: number; // consecutive days below the threshold, ending on lastDay
  lastMean: number | null;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Status of one room from its daily means (day -> °C). `archiveLast`: last day of the archive. */
export function coldStatus(means: Map<string, number>, threshold: number, days: number, archiveLast: string): ColdResult {
  const list = [...means].filter(([, v]) => Number.isFinite(v)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!list.length) return { status: 'stale', lastDay: null, streak: 0, lastMean: null };
  const [lastDay, lastMean] = list[list.length - 1];
  if (lastDay < addDays(archiveLast, -2)) return { status: 'stale', lastDay, streak: 0, lastMean };
  let streak = 0;
  let expected = lastDay;
  for (let i = list.length - 1; i >= 0; i--) {
    const [d, v] = list[i];
    if (d !== expected || v >= threshold) break;
    streak++;
    expected = addDays(d, -1);
  }
  return { status: streak >= days ? 'cold' : 'ok', lastDay, streak, lastMean };
}
