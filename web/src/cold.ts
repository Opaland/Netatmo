// S-12.5: prolonged cold in a living room. Pure functions, same rule as the collector
// (collector/cold.py): a room is « cold » when its daily mean temperature stayed below the
// threshold on its last `days` measured days (a daily mean = 24 h), and « without recent
// reading » when its last reading is more than 2 days older than the archive.

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
  const threshold = Number(o.threshold);
  const days = o.days === undefined ? 1 : Number(o.days);
  if (!Number.isFinite(threshold) || threshold < 5 || threshold > 22) return null;
  if (!Number.isInteger(days) || days < 1 || days > 7) return null;
  if (!Array.isArray(o.rooms)) return null;
  const rooms = [...new Set(o.rooms.filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 64))];
  if (!rooms.length || rooms.length > COLD_MAX_ROOMS) return null;
  return { threshold, days, rooms };
}

/** The repository variable COLD_ALERT_JSON for this configuration. */
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
