// S-9.6: evenings with the shutters closed, noted by hand on this device, and the
// comparison that makes the S-9.0 measurement possible: night heating with / without
// closed shutters, as a gap to the night signature, with its uncertainty.
// Pure functions except the two storage helpers (localStorage, never sent anywhere).
import { addDays } from './aggregate';
import { type Fit, type Hourly, type Weather, linearFit } from './analysis';
import { lsKey } from './scope';

const LS_KEY = lsKey('shutters');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Evenings noted « volets fermés » on this device, sorted. */
export function loadNotes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    return Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && DAY.test(d)))].sort() : [];
  } catch {
    return [];
  }
}

export function saveNotes(days: Iterable<string>): string[] {
  const list = [...new Set([...days].filter((d) => DAY.test(d)))].sort();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: kept for this visit only */
  }
  return list;
}

/** CSV export (`;` separator, for Excel), one line per noted evening. */
export function notesCsv(days: string[]): string {
  return ['date;volets_fermes', ...days.map((d) => `${d};1`)].join('\r\n') + '\r\n';
}

/** Dates found in an exported CSV (or any text: one YYYY-MM-DD per line, value 0 drops it). */
export function parseNotesCsv(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*"?(\d{4}-\d{2}-\d{2})"?\s*(?:[;,]\s*"?(\w+)"?)?/);
    if (m && !['0', 'non', 'false'].includes((m[2] ?? '1').toLowerCase())) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}

// ------------------------------------------------------------------ comparison
/** Hours of the night that follows evening D: D 22 h → D+1 7 h (9 hours). */
export function nightHours(evening: string): string[] {
  const next = addDays(evening, 1);
  return [`${evening}T22`, `${evening}T23`, ...Array.from({ length: 7 }, (_, h) => `${next}T0${h}`)];
}

export interface Night {
  day: string; // the evening
  t: number; // outdoor mean °C, average of the two days
  kwh: number; // heating, 22 h → 7 h
  closed: boolean;
}

/** Heating nights of [from, to] with a complete hourly record and an outdoor temperature. */
export function nights(hourly: Hourly, heatRooms: string[], weather: Weather, closed: Set<string>, from: string, to: string): Night[] {
  const out: Night[] = [];
  const series = heatRooms.map((r) => hourly.get(r)).filter((m): m is Map<string, number> => !!m);
  if (!series.length) return out;
  for (let d = from; d < to; d = addDays(d, 1)) {
    const w0 = weather.get(d);
    const w1 = weather.get(addDays(d, 1));
    if (!w0 || !w1) continue;
    const hours = nightHours(d);
    // a night counts only if at least one room reported every hour
    if (!series.some((m) => hours.every((h) => m.has(h)))) continue;
    const kwh = series.reduce((s, m) => s + hours.reduce((a, h) => a + (m.get(h) ?? 0), 0), 0);
    out.push({ day: d, t: (w0[2] + w1[2]) / 2, kwh, closed: closed.has(d) });
  }
  return out;
}

export interface ShutterComparison {
  fit: Fit; // night signature, fitted on the nights with open shutters
  closed: Night[];
  open: Night[];
  meanClosed: number; // kWh per night, measured
  meanOpen: number;
  gap: number; // mean gap to the signature, closed minus open (kWh per night, negative = saving)
  gapPct: number | null; // relative to what the signature expected for the closed nights
  ci95: number; // ± half-width of the 95 % interval of the gap
  significant: boolean;
}

export const MIN_CLOSED = 7;
export const MIN_OPEN = 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0;
};

/**
 * Closed vs open nights, each as its gap to the night signature (kWh vs outdoor °C, fitted
 * on the open nights only), so that a colder week of notes does not pass for a loss.
 * Null until MIN_CLOSED closed and MIN_OPEN open heating nights exist.
 */
export function compareShutters(all: Night[]): ShutterComparison | null {
  const heating = all.filter((n) => n.t < 15 && n.kwh > 0.1);
  const closed = heating.filter((n) => n.closed);
  const open = heating.filter((n) => !n.closed);
  if (closed.length < MIN_CLOSED || open.length < MIN_OPEN) return null;
  const fit = linearFit(open.map((n) => [n.t, n.kwh]));
  if (!fit) return null;
  const expected = (n: Night) => Math.max(0, fit.slope * n.t + fit.intercept);
  const rc = closed.map((n) => n.kwh - expected(n));
  const ro = open.map((n) => n.kwh - expected(n));
  const gap = mean(rc) - mean(ro);
  const se = Math.sqrt(variance(rc) / rc.length + variance(ro) / ro.length);
  const ci95 = 1.96 * se;
  const exp = mean(closed.map(expected));
  return {
    fit,
    closed,
    open,
    meanClosed: mean(closed.map((n) => n.kwh)),
    meanOpen: mean(open.map((n) => n.kwh)),
    gap,
    gapPct: exp > 0 ? (gap / exp) * 100 : null,
    ci95,
    significant: Math.abs(gap) > ci95,
  };
}
