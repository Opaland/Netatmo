// Comfort (S-11.1, S-11.2, S-11.3) and radiator ↔ station comparison (S-3.8).
// Pure functions: no DOM, no state. The view lives in views/comfort.ts.
import { addDays } from './aggregate';
import { foldName, isBedroom } from './household';

export interface StationModule {
  name: string;
  type: string;
  indoor: boolean;
}
export interface Night {
  n: number;
  co2_max: number | null;
  h_co2_1000: number;
  h_co2_1400: number;
  h_co2_1500: number;
}
export interface DayHours {
  n: number;
  humid: number;
  cold?: number;
}
/** module -> "YYYY-MM-DDTHH" -> [°C, %, ppm | null] */
export type StationHourly = Map<string, Map<string, [number | null, number | null, number | null]>>;

/** Hours of a full night (22 h → 7 h, 7 h excluded). */
export const FULL_NIGHT = 9;

// ------------------------------------------------------------------ modules
const fold = foldName;

/** #234: one bedroom rule for the whole app, defined in household.ts. */
export { isBedroom };
/** Unheated spaces: they count as "indoor" for Netatmo but not as heated rooms. */
export const isUnheated = (name: string) => /\b(cave|cellier|sous[- ]?sol|garage|grenier|buanderie|veranda|abri|atelier)/.test(fold(name));
export const isCellar = (name: string) => /\b(cave|cellier|sous[- ]?sol)/.test(fold(name));
export const isOutdoor = (m: StationModule) => !m.indoor || m.type === 'NAModule1';

/** Indoor modules that are heated rooms (not outdoor, not a cellar-like space). */
export function heatedModules(modules: Record<string, StationModule>): string[] {
  return Object.keys(modules).filter((k) => !isOutdoor(modules[k]) && !isUnheated(modules[k].name));
}

/**
 * Every indoor module, whatever its name: the choices offered to link a room to the station.
 * A module named « Cave » may well sit in a bedroom: the name only drives the suggestion.
 */
export function indoorModules(modules: Record<string, StationModule>): string[] {
  return Object.keys(modules).filter((k) => !isOutdoor(modules[k]));
}

/** Modules whose night CO₂ matters: indoor, not unheated spaces (unless linked to a room); bedrooms first. */
export function co2Modules(modules: Record<string, StationModule>, nightly: Record<string, unknown> = {}, linked: Iterable<string> = []): string[] {
  const link = new Set(linked);
  const keys = indoorModules(modules).filter((k) => (link.has(k) || !isUnheated(modules[k].name)) && nightly[k] !== undefined);
  return [...keys.filter((k) => isBedroom(modules[k].name)), ...keys.filter((k) => !isBedroom(modules[k].name))];
}

// ------------------------------------------------------------------ S-11.1 night CO₂
export interface NightRow extends Night {
  day: string;
  complete: boolean;
}

/**
 * The `count` nights ending at `last` (the night of D is stored under D). Missing nights are
 * `null`; nights with fewer than 9 hourly readings are kept but flagged incomplete.
 */
export function lastNights(nightly: Record<string, Night>, last: string, count = 30): (NightRow | null)[] {
  const out: (NightRow | null)[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = addDays(last, -i);
    const n = nightly[day];
    out.push(n ? { ...n, day, complete: n.n >= FULL_NIGHT } : null);
  }
  return out;
}

/** Last night present in the aggregates (or null). */
export function lastNightDay(nightly: Record<string, Night>): string | null {
  const days = Object.keys(nightly).sort();
  return days.length ? days[days.length - 1] : null;
}

export interface NightSummary {
  complete: number;
  incomplete: number;
  missing: number;
  over1000: number;
  over1400: number;
  maxPpm: number | null;
  meanHours1000: number;
}

export function summarizeNights(rows: (NightRow | null)[]): NightSummary {
  const full = rows.filter((r): r is NightRow => !!r && r.complete);
  const maxes = full.map((r) => r.co2_max).filter((v): v is number => v !== null);
  return {
    complete: full.length,
    incomplete: rows.filter((r) => r && !r.complete).length,
    missing: rows.filter((r) => !r).length,
    over1000: full.filter((r) => r.h_co2_1000 > 0).length,
    over1400: full.filter((r) => r.h_co2_1400 > 0).length,
    maxPpm: maxes.length ? Math.max(...maxes) : null,
    meanHours1000: full.length ? full.reduce((s, r) => s + r.h_co2_1000, 0) / full.length : 0,
  };
}

/** One sentence verdict; `level` drives the icon colour (good / neutral / bad). */
export function nightVerdict(s: NightSummary): { level: 'low' | 'mid' | 'high'; text: string } {
  if (!s.complete) return { level: 'mid', text: 'Pas encore de nuit complète relevée.' };
  const of = `sur ${s.complete}`;
  if (s.over1400 >= Math.max(1, s.complete / 3))
    return { level: 'high', text: `${s.over1400} nuit${s.over1400 > 1 ? 's' : ''} ${of} au-dessus de 1 400 ppm : aérer avant le coucher et laisser la porte entrouverte.` };
  if (s.over1400 > 0)
    return { level: 'mid', text: `${s.over1400} nuit${s.over1400 > 1 ? 's' : ''} ${of} au-dessus de 1 400 ppm : aérer avant le coucher.` };
  if (s.over1000 > 0)
    return { level: 'mid', text: `Aucune nuit au-dessus de 1 400 ppm ; ${s.over1000} ${of} dépassent 1 000 ppm (air un peu confiné).` };
  return { level: 'low', text: `Air correct : aucune nuit ${of} au-dessus de 1 000 ppm.` };
}

// ------------------------------------------------------------------ S-11.2 cellar humidity
/** Dew point (°C) by the Magnus formula (Sonntag 1990 coefficients, valid −45…60 °C). */
export function dewPoint(t: number, rh: number): number | null {
  if (!(rh > 0) || rh > 100) return null;
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(rh / 100) + (a * t) / (b + t);
  return (b * g) / (a - g);
}

/**
 * Longest run of consecutive days (in [from, to]) whose daily mean humidity is above `threshold`,
 * and the run still going on at `to` (0 if none).
 */
export function humidRuns(
  daily: Record<string, (number | null)[]>,
  threshold: number,
  from: string,
  to: string,
): { longest: number; longestEnd: string | null; current: number } {
  let run = 0;
  let longest = 0;
  let longestEnd: string | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const h = daily[d]?.[3];
    if (h !== null && h !== undefined && h > threshold) {
      run++;
      if (run > longest) (longest = run), (longestEnd = d);
    } else if (daily[d] || d !== to) run = 0; // today may not be collected yet: keep the run
  }
  return { longest, longestEnd, current: run };
}

/** Consecutive days ending at `to` (today may be missing) with at least `minHours` humid hours. */
export function wetStreak(hours: Record<string, DayHours>, to: string, minHours = 12): number {
  let d = hours[to] ? to : addDays(to, -1);
  let n = 0;
  while ((hours[d]?.humid ?? 0) >= minHours) n++, (d = addDays(d, -1));
  return n;
}

// ------------------------------------------------------------------ S-11.3 hours under a threshold
/** Per day: hours with a temperature, and hours strictly below `threshold`. */
export function hoursBelow(hourly: Map<string, [number | null, number | null, number | null]> | undefined, threshold: number) {
  const out = new Map<string, { n: number; cold: number }>();
  for (const [h, v] of hourly ?? []) {
    const t = v[0];
    if (t === null || t === undefined) continue;
    const day = h.slice(0, 10);
    const cur = out.get(day) ?? { n: 0, cold: 0 };
    cur.n++;
    if (t < threshold) cur.cold++;
    out.set(day, cur);
  }
  return out;
}

/** Heating season of a day: Nov–Mar, named by the year it starts (Jan 2026 → 2025). null outside. */
export function seasonOf(day: string): number | null {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m >= 11 ? y : m <= 3 ? y - 1 : null;
}

/**
 * #294: « jours à moyenne sous le seuil » of a winter (Nov → Mar, `season` = the year it
 * starts): the one definition of a cold day, used by Pièces and Confort for every source
 * (station module or radiator probe). `means`: day → mean temperature of the day.
 */
export function coldWinterDays(means: Iterable<[string, number | null | undefined]>, season: number, threshold: number): { under: number; n: number } | null {
  let n = 0;
  let under = 0;
  for (const [d, m] of means) {
    if (typeof m !== 'number' || !Number.isFinite(m) || seasonOf(d) !== season) continue;
    n++;
    if (m < threshold) under++;
  }
  return n ? { under, n } : null;
}

export function sumSeason(perDay: Map<string, { n: number; cold: number }>, season: number) {
  let hours = 0;
  let days = 0;
  let n = 0;
  for (const [d, v] of perDay) {
    if (seasonOf(d) !== season) continue;
    hours += v.cold;
    n += v.n;
    if (v.cold > 0) days++;
  }
  return n ? { hours, days, n } : null;
}

// ------------------------------------------------------------------ S-3.8 room ↔ module mapping
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'et', 'piece', 'module']);
function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w));
}
const bigrams = (s: string) => {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
};
function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const rest = [...b];
  let common = 0;
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i >= 0) common++, rest.splice(i, 1);
  }
  return (2 * common) / (a.length + b.length);
}

/** 0…1: word overlap (plural- and accent-insensitive), refined by letter pairs. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  return 0.7 * dice(ta, tb) + 0.3 * dice(bigrams(ta.join(' ')), bigrams(tb.join(' ')));
}

/** Greedy one-to-one suggestion: best pairs first, above `min`. */
export function suggestMapping(rooms: { id: string; name: string }[], modules: Record<string, StationModule>, min = 0.6): Record<string, string> {
  const candidates = heatedModules(modules);
  const pairs: [number, string, string][] = [];
  for (const r of rooms) for (const k of candidates) pairs.push([nameSimilarity(r.name, modules[k].name), r.id, k]);
  pairs.sort((x, y) => y[0] - x[0]);
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const [score, room, k] of pairs) {
    if (score < min) break;
    if (out[room] !== undefined || used.has(k)) continue;
    out[room] = k;
    used.add(k);
  }
  return out;
}

/**
 * Saved choices win ('' = deliberately unlinked); rooms without a saved choice take the
 * suggestion unless its module is already linked by a saved choice.
 */
export function effectiveMapping(
  rooms: { id: string; name: string }[],
  modules: Record<string, StationModule>,
  saved: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  const valid = new Set(indoorModules(modules)); // any indoor module, « Cave » included; never the outdoor one
  const taken = new Set(Object.values(saved).filter((k) => valid.has(k)));
  const suggested = suggestMapping(rooms, modules);
  for (const r of rooms) {
    if (r.id in saved) {
      if (valid.has(saved[r.id])) out.set(r.id, saved[r.id]);
    } else if (suggested[r.id] && !taken.has(suggested[r.id])) out.set(r.id, suggested[r.id]);
  }
  return out;
}

// ------------------------------------------------------------------ S-3.8 radiator vs station
export interface OffsetStats {
  n: number;
  mean: number; // radiator − station, °C
  sd: number;
  stable: boolean;
  months: { month: string; radiator: number; station: number; offset: number; n: number }[];
  recent: { mean: number; n: number } | null; // last 30 days with both readings
  setpoint: number | null; // mean setpoint over the same days
}

const MIN_DAYS = 20;
const STABLE_SD = 1; // day-to-day spread: mostly the noise of two probes

/**
 * Daily radiator temperature vs station daily mean over heating-season days in [from, to].
 * Stable = enough days, bounded day-to-day spread and every monthly mean within ±0,5 °C of the
 * overall mean (a drift between months is what makes a setpoint shift unreliable).
 */
export function offsetStats(
  radiator: Map<string, [number, number | null]> | undefined,
  station: Record<string, (number | null)[]> | undefined,
  from: string,
  to: string,
): OffsetStats | null {
  if (!radiator || !station) return null;
  const diffs: [string, number, number, number | null][] = [];
  for (const [d, [m, sp]] of radiator) {
    if (d < from || d > to || seasonOf(d) === null) continue;
    const s = station[d]?.[2];
    if (s === null || s === undefined || m === null || m === undefined) continue;
    diffs.push([d, m, s, sp]);
  }
  if (!diffs.length) return null;
  diffs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const n = diffs.length;
  const mean = diffs.reduce((a, x) => a + (x[1] - x[2]), 0) / n;
  const sd = Math.sqrt(diffs.reduce((a, x) => a + (x[1] - x[2] - mean) ** 2, 0) / Math.max(1, n - 1));
  const byMonth = new Map<string, { r: number; s: number; n: number }>();
  for (const [d, r, s] of diffs) {
    const k = d.slice(0, 7);
    const cur = byMonth.get(k) ?? { r: 0, s: 0, n: 0 };
    cur.r += r;
    cur.s += s;
    cur.n++;
    byMonth.set(k, cur);
  }
  const months = [...byMonth.entries()].map(([month, v]) => ({
    month,
    radiator: v.r / v.n,
    station: v.s / v.n,
    offset: (v.r - v.s) / v.n,
    n: v.n,
  }));
  const solid = months.filter((m) => m.n >= 7);
  const stable = n >= MIN_DAYS && sd <= STABLE_SD && solid.every((m) => Math.abs(m.offset - mean) <= 0.5);
  const recentFrom = addDays(to, -29);
  const rec = diffs.filter((x) => x[0] >= recentFrom);
  const sps = diffs.map((x) => x[3]).filter((v): v is number => v !== null);
  return {
    n,
    mean,
    sd,
    stable,
    months,
    recent: rec.length ? { mean: rec.reduce((a, x) => a + (x[1] - x[2]), 0) / rec.length, n: rec.length } : null,
    setpoint: sps.length ? sps.reduce((a, b) => a + b, 0) / sps.length : null,
  };
}

const f1 = (v: number) => v.toFixed(1).replace('.', ',').replace('-', '−');
export const signed = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1).replace('.', ',')}`;
};

/** Advice sentences (never an action on the radiators). */
export function offsetAdvice(o: OffsetStats, target = 19): string[] {
  const out: string[] = [];
  if (o.recent && o.recent.n >= 15 && Math.abs(o.recent.mean) > 1.5)
    out.push(
      `Sonde à vérifier : sur les 30 derniers jours, le radiateur et la station diffèrent de ${signed(o.recent.mean)} °C en moyenne (plus de 1,5 °C). Radiateur près d'une fenêtre, d'une source de chaleur, ou station mal placée ?`,
    );
  if (o.n < MIN_DAYS) {
    out.push(`Pas encore assez de jours de chauffe communs (${o.n}) pour juger l'écart.`);
    return out;
  }
  if (!o.stable) {
    out.push(`L'écart varie trop (d'un mois à l'autre ou d'un jour à l'autre, écart-type ${f1(o.sd)} °C) pour suggérer un décalage de consigne.`);
    return out;
  }
  if (Math.abs(o.mean) < 0.3) {
    out.push(`Écart stable et faible (${signed(o.mean)} °C) : la sonde du radiateur reflète bien la pièce.`);
    return out;
  }
  const warmer = o.mean > 0;
  out.push(
    `Écart stable : la sonde du radiateur lit ${signed(o.mean)} °C par rapport à la station (${warmer ? 'plus chaud' : 'plus froid'}). Pour obtenir ${target} °C à la station, il faudrait régler la consigne vers ${f1(target + o.mean)} °C${
      o.setpoint !== null ? ` ; avec la consigne moyenne actuelle (${f1(o.setpoint)} °C), la station lit environ ${f1(o.setpoint - o.mean)} °C` : ''
    }. Suggestion seulement : l'application ne pilote pas les radiateurs.`,
  );
  return out;
}
