// S-11.4 (#220): pressure and noise of the main module of the station (« Air et confort »).
// Pure functions, no DOM. Formats: collector/station.py (station.pressure, station.noise).
import { addDays } from './aggregate';
import type { Weather } from './analysis';

export interface PressureDoc {
  modules: Record<string, { type: string }>;
  pressure?: Record<string, Record<string, [number, number | null, number | null, number | null]>>;
  noise?: Record<string, Record<string, { n: number; loud: number }>>;
}

/**
 * hPa per day under which the pressure reads « stable ». A presentation threshold chosen by
 * judgement (a weather front moves it by 5 to 10 hPa a day); it changes no computed number.
 */
export const STABLE_HPA = 1;
/** dB: an hour counts as noisy above this mean (same threshold as collector/station.py NOISY_ABOVE). */
export const NOISY_DB = 55;

/** The main module (NAMain): the one that measures pressure and noise. */
export function mainKey(doc: PressureDoc): string | null {
  return Object.keys(doc.modules).find((k) => doc.modules[k].type === 'NAMain') ?? null;
}

export type Trend = 'up' | 'down' | 'stable' | null;
export const trendOf = (t: number | null | undefined): Trend => (t === null || t === undefined ? null : t >= STABLE_HPA ? 'up' : t <= -STABLE_HPA ? 'down' : 'stable');

export interface PressureRow {
  day: string;
  outdoor: number | null; // mean °C
  pressure: number | null; // mean hPa
  trend: number | null; // vs the day before
  loud: number | null; // noisy hours (opt-in)
  noiseHours: number | null; // hours read that day
}

export interface PressureSummary {
  rows: PressureRow[]; // the last `days` days, newest first
  mean: number | null; // mean pressure over `window` days
  meanLoud: number | null; // noisy hours per day over `window` days (days fully read)
  loudDays: number; // days with noise read
  hasNoise: boolean;
}

/** The last `days` days up to `last`, and the means over `window` days. Null without pressure nor noise. */
export function pressureSummary(doc: PressureDoc | null, weather: Weather | null, last: string, days = 7, window = 30): PressureSummary | null {
  if (!doc) return null;
  const key = mainKey(doc);
  if (!key) return null;
  const p = doc.pressure?.[key] ?? {};
  const noise = doc.noise?.[key] ?? {};
  const hasNoise = Object.keys(noise).length > 0;
  if (!Object.keys(p).length && !hasNoise) return null;
  const rows: PressureRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(last, -i);
    const v = p[d];
    const nz = noise[d];
    rows.push({ day: d, outdoor: weather?.get(d)?.[2] ?? null, pressure: v?.[0] ?? null, trend: v?.[3] ?? null, loud: nz ? nz.loud : null, noiseHours: nz ? nz.n : null });
  }
  const means: number[] = [];
  const louds: number[] = [];
  for (let i = 0; i < window; i++) {
    const d = addDays(last, -i);
    if (typeof p[d]?.[0] === 'number') means.push(p[d][0]);
    // a day read in part (today, a gap) would lower the mean: only full days count
    if (noise[d] && noise[d].n >= 20) louds.push(noise[d].loud);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return { rows, mean: avg(means), meanLoud: avg(louds), loudDays: louds.length, hasNoise };
}
