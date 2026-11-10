// S-3.12 (#221): the wind (and the rain) in the energy signature. Pure functions, no DOM.
//
// On the heating days of a season (the same days as the signature: outdoor below 15 °C, some
// heating, lost or estimated days left out), two least-squares fits on the SAME days:
//   kWh = a + b × DJU                    (degree days, base 18 °C: the cold alone)
//   kWh = a + b × DJU + c × wind         (mean wind of the day, km/h, Open-Meteo)
// and, when the rain is known, a third one with + d × rain (mm). The gain of explanation is the
// R² before → after, and the share of what the cold alone left unexplained that the wind
// explains: (R²₂ − R²₁) / (1 − R²₁). An effect is called real only when its 95 % interval
// (Student, n − k degrees of freedom) does not contain 0; otherwise the app says « pas d'effet
// mesurable » and shows no number as if it were one.
import { DJU_BASE } from './analysis';
import { MIN_DAYS, type SigPoint, t975 } from './indoorsig';

export interface MultiFit {
  coef: number[]; // intercept first
  se: number[]; // standard error of each coefficient
  r2: number;
  n: number;
}

/** Inverse of a small symmetric matrix (Gauss–Jordan with partial pivoting); null if singular. */
export function invert(m: number[][]): number[][] | null {
  const k = m.length;
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const div = a[c][c];
    for (let j = 0; j < 2 * k; j++) a[c][j] /= div;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) for (let j = 0; j < 2 * k; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(k));
}

/** Ordinary least squares, `x` without the intercept column. Null under k + 3 points or if singular. */
export function ols(x: number[][], y: number[]): MultiFit | null {
  const n = y.length;
  const k = (x[0]?.length ?? 0) + 1;
  if (n < k + 3 || x.length !== n) return null;
  const rows = x.map((r) => [1, ...r]);
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: k }, (_, i) => rows.reduce((s, r, t) => s + r[i] * y[t], 0));
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const mean = y.reduce((s, v) => s + v, 0) / n;
  let sse = 0;
  let sst = 0;
  rows.forEach((r, t) => {
    const fit = r.reduce((s, v, j) => s + v * coef[j], 0);
    sse += (y[t] - fit) ** 2;
    sst += (y[t] - mean) ** 2;
  });
  const s2 = sse / (n - k);
  return { coef, se: inv.map((row, j) => Math.sqrt(Math.max(0, s2 * row[j]))), r2: sst > 0 ? 1 - sse / sst : 0, n };
}

export interface Effect {
  /** kWh per day for one unit (km/h of mean wind, mm of rain), all else equal. */
  slope: number;
  ci: [number, number];
  /** The 95 % interval excludes 0. */
  real: boolean;
}

export interface WindSignature {
  season: string;
  n: number; // heating days with the wind known
  r2Before: number; // degree days alone, same days
  r2After: number; // degree days + wind
  /** Share of what the cold alone left unexplained that the wind explains (0 to 1). */
  gain: number;
  wind: Effect;
  /** Wind of the season: 10th and 90th percentiles of the daily mean (km/h). */
  windRange: [number, number];
  /** Degree days + wind + rain, when the rain is known on at least MIN_DAYS of these days. */
  rain: (Effect & { r2: number; n: number }) | null;
}

const effect = (f: MultiFit, j: number): Effect => {
  const e = t975(f.n - f.coef.length) * f.se[j];
  const slope = f.coef[j];
  return { slope, ci: [slope - e, slope + e], real: e > 0 && Math.abs(slope) > e };
};

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** The signature of one season with and without the wind (null under MIN_DAYS days with the wind). */
export function windSignature(
  season: string,
  points: SigPoint[],
  wind: Map<string, [number, number | null]>,
  rain: Map<string, number> = new Map(),
): WindSignature | null {
  const pts = points.filter((p) => wind.has(p.day));
  if (pts.length < MIN_DAYS) return null;
  const dju = (p: SigPoint) => Math.max(0, DJU_BASE - p.tOut);
  const y = pts.map((p) => p.kwh);
  const before = ols(pts.map((p) => [dju(p)]), y);
  const after = ols(pts.map((p) => [dju(p), wind.get(p.day)![0]]), y);
  if (!before || !after) return null;
  const withRain = pts.filter((p) => rain.has(p.day));
  const rf = withRain.length >= MIN_DAYS ? ols(withRain.map((p) => [dju(p), wind.get(p.day)![0], rain.get(p.day)!]), withRain.map((p) => p.kwh)) : null;
  const winds = pts.map((p) => wind.get(p.day)![0]).sort((a, b) => a - b);
  return {
    season,
    n: pts.length,
    r2Before: before.r2,
    r2After: after.r2,
    gain: before.r2 < 1 ? Math.max(0, (after.r2 - before.r2) / (1 - before.r2)) : 0,
    wind: effect(after, 2),
    windRange: [quantile(winds, 0.1), quantile(winds, 0.9)],
    rain: rf ? { ...effect(rf, 3), r2: rf.r2, n: rf.n } : null,
  };
}

/** One per season with enough days, oldest first. */
export function windSignatures(days: Map<string, SigPoint[]>, wind: Map<string, [number, number | null]>, rain?: Map<string, number>): WindSignature[] {
  return [...days.keys()]
    .sort()
    .map((s) => windSignature(s, days.get(s)!, wind, rain))
    .filter((w): w is WindSignature => w !== null);
}
