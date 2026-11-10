// #20: « Réglages du graphique », one sheet for every chart of the app (chart-sheet.ts), saved on
// this device with the rest of the display settings (app.ts state.chart). The period stays the
// one of the screen (a single period per screen, docs/design/architecture-cible.md § 2): the
// sheet only changes how the charts are drawn. Pure, for the unit tests; charts.ts applies it.

export interface ChartPrefs {
  /** A point on every value of a curve (default: only where a value would be lost, #304). */
  points: boolean;
  /** Value axis from 0 for curves that follow their data (°C, ppm, %), unless the chart has its own range. */
  zero: boolean;
  /** Show the « Un an plus tôt » series of the charts that have one. */
  lastYear: boolean;
  /** Day-by-day curves smoothed over 7 days (the raw values stay in the table and the summary). */
  smooth: boolean;
}

export const CHART_DEFAULT: ChartPrefs = { points: false, zero: false, lastYear: true, smooth: false };

/** Saved preferences, validated (an older or damaged value falls back field by field). */
export function chartPrefs(v: unknown): ChartPrefs {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const b = (k: keyof ChartPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : CHART_DEFAULT[k]);
  return { points: b('points'), zero: b('zero'), lastYear: b('lastYear'), smooth: b('smooth') };
}

/** Smoothing window, in values (days), and the shortest curve it applies to (a month of days). */
export const SMOOTH_DAYS = 7;
export const SMOOTH_MIN = 28;

/**
 * Trailing mean over `n` values, gaps kept as gaps (a missing day is never drawn), and the mean
 * taken over the values present in the window only when at least half of it is there.
 */
export function movingAverage(data: (number | null)[], n = SMOOTH_DAYS): (number | null)[] {
  return data.map((v, i) => {
    if (v === null) return null;
    const win = data.slice(Math.max(0, i - n + 1), i + 1).filter((x): x is number => x !== null);
    if (win.length < Math.ceil(n / 2)) return v;
    return Math.round((win.reduce((s, x) => s + x, 0) / win.length) * 100) / 100;
  });
}

/** Should a line chart of `count` values be smoothed? Day-by-day curves only (30 days and more). */
export const smoothable = (p: ChartPrefs, count: number) => p.smooth && count >= SMOOTH_MIN;

/** The series kept: « Un an plus tôt » goes when the reader turned it off (never all of them). */
export function keepLastYear<S extends { lastYear?: boolean }>(series: S[], p: ChartPrefs): S[] {
  if (p.lastYear) return series;
  const kept = series.filter((s) => !s.lastYear);
  return kept.length ? kept : series;
}

/** Value axis from 0? `byDefault`: the chart's own rule (kWh, €); `ownRange`: bounds set by the chart. */
export const zeroAxis = (p: ChartPrefs, byDefault: boolean, ownRange: boolean) => byDefault || (p.zero && !ownRange);
