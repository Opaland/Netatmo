// S-3.7: energy signature on the indoor − outdoor difference, with 95 % intervals.
// kWh(day) = slope × (T_in − T_out) + intercept. The slope (kWh per degree of difference)
// reflects the losses of the house (insulation, air renewal) whatever the thermostat does;
// the threshold −intercept / slope is the difference covered by free gains (sun, people,
// appliances): no heating below it. Pure functions, no DOM.
import { type DayRecord, seasonOf } from './aggregate';
import type { Weather } from './analysis';
import { type StationModule, heatedModules, indoorModules, isOutdoor } from './comfort';

export const MIN_DAYS = 30;

export interface CiFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  slopeCi: [number, number];
  threshold: number | null; // x where the line reaches zero
  thresholdCi: [number, number] | null;
}

/** Two-sided 95 % Student quantile (Cornish-Fisher expansion, exact enough for df ≥ 5). */
export function t975(df: number): number {
  const z = 1.959964;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3;
}

/**
 * Least squares with the 95 % interval of the slope and of the zero crossing (delta
 * method: Var(x0) ≈ [Var(b) + 2 x0 Cov(a, b) + x0² Var(a)] / a²). Null under `min` points.
 */
export function fitWithCi(points: [number, number][], min = MIN_DAYS): CiFit | null {
  const n = points.length;
  if (n < Math.max(3, min)) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) (sxx += (x - mx) ** 2), (sxy += (x - mx) * (y - my)), (syy += (y - my) ** 2);
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = points.reduce((s, [x, y]) => s + (y - slope * x - intercept) ** 2, 0);
  const s2 = sse / (n - 2);
  const t = t975(n - 2);
  const varA = s2 / sxx;
  const varB = s2 * (1 / n + mx ** 2 / sxx);
  const cov = (-mx * s2) / sxx;
  const ea = t * Math.sqrt(varA);
  let threshold: number | null = null;
  let thresholdCi: [number, number] | null = null;
  // a zero crossing only makes sense when the slope is clearly away from zero
  if (slope !== 0 && Math.abs(slope) > ea) {
    threshold = -intercept / slope;
    const v = (varB + 2 * threshold * cov + threshold ** 2 * varA) / slope ** 2;
    const e = t * Math.sqrt(Math.max(0, v));
    thresholdCi = [threshold - e, threshold + e];
  }
  return { slope, intercept, r2: syy > 0 ? 1 - sse / syy : 0, n, slopeCi: [slope - ea, slope + ea], threshold, thresholdCi };
}

export interface StationDaily {
  modules: Record<string, StationModule>;
  daily: Record<string, Record<string, (number | null)[]>>; // [min, max, mean, hum, co2]
}

/**
 * Indoor module standing for "the house": the one linked to the heating room that
 * consumes most (comfort mapping), else the main station (NAMain) if heated, else the
 * first heated indoor module.
 */
export function indoorModule(st: StationDaily, mapping: Map<string, string>, records: DayRecord[]): string | null {
  const heated = heatedModules(st.modules);
  // a module linked to a heated room counts, whatever its name (« Cave » in a bedroom)
  const indoor = indoorModules(st.modules);
  const per = new Map<string, number>();
  for (const r of records) if (r.cat === 'heating' && mapping.has(r.room)) per.set(r.room, (per.get(r.room) ?? 0) + r.kwh);
  const top = [...per].sort((a, b) => b[1] - a[1]).map(([room]) => mapping.get(room)!).find((k) => indoor.includes(k));
  if (!top && !heated.length) return null;
  return top ?? heated.find((k) => st.modules[k].type === 'NAMain') ?? heated[0];
}

export interface SigPoint {
  day: string;
  kwh: number; // heating
  tOut: number;
  tIn: number | null;
}

/**
 * Heating days (outdoor < 15 °C, some heating) per season, without uncertain days
 * (lost or estimated). Outdoor: station outdoor module, else the weather file.
 */
export function signatureDays(
  records: DayRecord[],
  weather: Weather | null,
  st: StationDaily | null,
  indoor: string | null,
  exclude: Set<string>,
): Map<string, SigPoint[]> {
  const heat = new Map<string, number>();
  for (const r of records) if (r.cat === 'heating') heat.set(r.day, (heat.get(r.day) ?? 0) + r.kwh);
  const outKey = st ? Object.keys(st.modules).find((k) => isOutdoor(st.modules[k])) : undefined;
  const out = new Map<string, SigPoint[]>();
  for (const [day, kwh] of heat) {
    if (exclude.has(day) || kwh <= 0.2) continue;
    const tOut = (outKey ? st!.daily[outKey]?.[day]?.[2] : null) ?? weather?.get(day)?.[2] ?? null;
    if (tOut === null || tOut >= 15) continue;
    const tIn = indoor ? (st!.daily[indoor]?.[day]?.[2] ?? null) : null;
    const s = seasonOf(day);
    if (!out.has(s)) out.set(s, []);
    out.get(s)!.push({ day, kwh, tOut, tIn });
  }
  return out;
}

export interface SeasonSignatures {
  season: string;
  outdoor: CiFit | null; // kWh vs T_out, every heating day
  delta: CiFit | null; // kWh vs (T_in − T_out), days with an indoor reading
  days: number; // heating days of the season
  deltaDays: number; // of which with an indoor reading
}

export function seasonSignatures(days: Map<string, SigPoint[]>): SeasonSignatures[] {
  return [...days.keys()].sort().map((season) => {
    const pts = days.get(season)!;
    const withIn = pts.filter((p) => p.tIn !== null);
    return {
      season,
      outdoor: fitWithCi(pts.map((p) => [p.tOut, p.kwh])),
      delta: fitWithCi(withIn.map((p) => [p.tIn! - p.tOut, p.kwh])),
      days: pts.length,
      deltaDays: withIn.length,
    };
  });
}
