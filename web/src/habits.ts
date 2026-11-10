// Pure helpers for the household habits cards (v1.3):
// S-4.9 cost of a working day vs a weekend day (telework), S-4.10 absences.
// Everything is computed in the browser: absences are never written in clear nor sent to the AI.
import { type DayRecord, addDays, seasonOf } from './aggregate';
import { type Weather, dju, fitSeason, linearFit, signaturePoints } from './analysis';

/** Monday = 0 … Sunday = 6. */
export const dow = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

// ------------------------------------------------------------------ S-4.9 telework
export interface DayTypeCost {
  kwh: number; // kWh per day of this kind, at the common DJU
  n: number; // days used
  method: 'fit' | 'ratio';
}

export const MIN_DJU = 2; // heating days only: below, the room barely heats whatever the day

/**
 * Average kWh per day for each group of days (e.g. working day / weekend), at equal
 * climate: within each group, kWh = a + b × DJU is fitted on the heating days, then
 * read at the mean DJU of all the days used. With fewer than 10 days in a group, the
 * group's kWh per DJU times that mean DJU.
 */
export function dayTypeCost(
  perDay: Map<string, number>,
  weather: Weather,
  from: string,
  to: string,
  group: (day: string) => string | null,
): { groups: Map<string, DayTypeCost>; dju: number; days: number } | null {
  const pts = new Map<string, [number, number][]>();
  let sumDju = 0;
  let n = 0;
  for (const [day, kwh] of perDay) {
    if (day < from || day > to) continue;
    const w = weather.get(day);
    const g = group(day);
    if (!w || g === null) continue;
    const x = dju(w);
    if (x < MIN_DJU) continue;
    if (!pts.has(g)) pts.set(g, []);
    pts.get(g)!.push([x, kwh]);
    sumDju += x;
    n++;
  }
  if (!n) return null;
  const mean = sumDju / n;
  const groups = new Map<string, DayTypeCost>();
  for (const [g, p] of pts) {
    if (p.length < 3) continue;
    const fit = linearFit(p);
    if (fit && fit.slope >= 0) {
      groups.set(g, { kwh: Math.max(0, fit.intercept + fit.slope * mean), n: p.length, method: 'fit' });
    } else {
      const k = p.reduce((s, [, y]) => s + y, 0);
      const d = p.reduce((s, [x]) => s + x, 0);
      groups.set(g, { kwh: d > 0 ? (k / d) * mean : 0, n: p.length, method: 'ratio' });
    }
  }
  return { groups, dju: mean, days: n };
}

/** Working day / telework day / weekend, from the weekdays marked as telework (0 = Monday). */
export function dayKind(day: string, telework: Set<number>): 'weekend' | 'telework' | 'office' {
  const d = dow(day);
  if (d >= 5) return 'weekend';
  return telework.has(d) ? 'telework' : 'office';
}

export type TeleworkKind = 'telework' | 'office' | 'weekday' | 'weekend';

/**
 * How the days are grouped for the telework card, from the weekdays ticked (0 = Monday … 4 = Friday):
 * - none ticked: weekday vs weekend;
 * - some ticked: telework vs office vs weekend, the sentence compares telework with office;
 * - all five ticked: there is no office day left, so telework vs weekend (before the fix the
 *   « office » group was required and missing, which emptied the card and hid the table).
 */
export function teleworkPlan(telework: Set<number>): {
  kinds: readonly TeleworkKind[];
  compare: [TeleworkKind, TeleworkKind];
  group: (day: string) => TeleworkKind;
} {
  const n = [0, 1, 2, 3, 4].filter((d) => telework.has(d)).length;
  if (!n) return { kinds: ['weekday', 'weekend'], compare: ['weekday', 'weekend'], group: (d) => (dow(d) >= 5 ? 'weekend' : 'weekday') };
  if (n === 5) return { kinds: ['telework', 'weekend'], compare: ['telework', 'weekend'], group: (d) => (dow(d) >= 5 ? 'weekend' : 'telework') };
  return { kinds: ['telework', 'office', 'weekend'], compare: ['telework', 'office'], group: (d) => dayKind(d, telework) };
}

// ------------------------------------------------------------------ S-4.10 absences
export interface Period {
  from: string;
  to: string;
}

export const ABSENCE_RATIO = 0.2; // heating below 20 % of the signature
export const ABSENCE_MIN_DAYS = 3;
export const LINKY_RATIO = 0.5; // other uses below half their usual level
const HEAT_MIN_EXPECTED = 3; // kWh: below, the signature says too little to judge
const HEAT_MAX_TEMP = 12; // °C: clear heating days only

/** Heating kWh expected by the season's energy signature for that day, or null. */
export function signatureExpect(records: DayRecord[], weather: Weather): (day: string) => number | null {
  const fits = new Map<string, ReturnType<typeof fitSeason>>();
  for (const [season, pts] of signaturePoints(records, weather)) fits.set(season, fitSeason(pts));
  return (day) => {
    const w = weather.get(day);
    const fit = fits.get(seasonOf(day));
    if (!w || !fit) return null;
    return Math.max(0, fit.slope * w[2] + fit.intercept);
  };
}

const median = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Days that look empty. On clear heating days (outdoor < 12 °C, signature ≥ 3 kWh):
 * heating below 20 % of the signature. Otherwise, with the Linky meter: the other uses
 * (meter minus radiators and water heater) below half their median of the 60 previous
 * days. Days with no data, or nothing to judge, are "unknown" and break a run.
 */
export function lowDays(
  records: DayRecord[],
  weather: Weather | null,
  linky: Map<string, number>,
  from: string,
  to: string,
): Map<string, boolean> {
  const heat = new Map<string, number>();
  const all = new Map<string, number>();
  for (const r of records) {
    all.set(r.day, (all.get(r.day) ?? 0) + r.kwh);
    if (r.cat === 'heating') heat.set(r.day, (heat.get(r.day) ?? 0) + r.kwh);
  }
  const expect = weather ? signatureExpect(records, weather) : () => null;
  const other = (d: string) => (linky.has(d) && all.has(d) ? linky.get(d)! - all.get(d)! : null);
  const out = new Map<string, boolean>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!all.has(d)) continue; // no data that day
    const w = weather?.get(d);
    const e = expect(d);
    if (w && e !== null && w[2] < HEAT_MAX_TEMP && e >= HEAT_MIN_EXPECTED) {
      out.set(d, (heat.get(d) ?? 0) < ABSENCE_RATIO * e);
      continue;
    }
    const o = other(d);
    if (o === null) continue;
    const ref: number[] = [];
    for (let k = 1; k <= 60; k++) {
      const v = other(addDays(d, -k));
      if (v !== null) ref.push(v);
    }
    if (ref.length < 20) continue;
    const m = median(ref);
    if (m > 0) out.set(d, o < LINKY_RATIO * m);
  }
  return out;
}

/** Runs of at least `minDays` consecutive low days. */
export function absencePeriods(low: Map<string, boolean>, minDays = ABSENCE_MIN_DAYS): Period[] {
  const days = [...low.keys()].sort();
  const out: Period[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const close = () => {
    if (start && prev && daysBetween(start, prev) + 1 >= minDays) out.push({ from: start, to: prev });
  };
  for (const d of days) {
    const isLow = low.get(d)!;
    if (isLow && start && prev && addDays(prev, 1) === d) prev = d;
    else {
      close();
      start = isLow ? d : null;
      prev = isLow ? d : null;
    }
  }
  close();
  return out;
}

/** A period of absence, `confirmed` when the setpoint mode said so (S-13.4). */
export interface AbsencePeriod extends Period {
  confirmed?: boolean;
}

/**
 * S-13.4: absences confirmed by the setpoint mode (away / frost guard in every room, from the
 * hourly snapshots) take precedence over the detection by consumption, which stays the fallback
 * (days without snapshot, households that never set the mode). Overlapping or adjacent periods
 * are merged; a merged period is confirmed when the mode covers part of it. A run of mode days
 * counts whatever its length: the mode was set on purpose.
 */
export function withModeAbsences(detected: Period[], byMode: Period[]): AbsencePeriod[] {
  const all = [...detected.map((p) => ({ ...p, confirmed: false })), ...byMode.map((p) => ({ ...p, confirmed: true }))].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  );
  const out: AbsencePeriod[] = [];
  for (const p of all) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) >= p.from) {
      if (p.to > last.to) last.to = p.to;
      last.confirmed = last.confirmed || p.confirmed;
    } else out.push({ ...p });
  }
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Detected periods minus the dismissed ones, plus the ones added by hand, newest first. */
export function mergeAbsences(detected: AbsencePeriod[], edits: AbsenceEdits): (AbsencePeriod & { manual: boolean })[] {
  const dismissed = new Set(edits.dismissed);
  const out = [
    ...detected.filter((p) => !dismissed.has(p.from)).map((p) => ({ ...p, manual: false })),
    ...edits.added.filter((p) => p.from <= p.to).map((p) => ({ ...p, manual: true })),
  ];
  return out.sort((a, b) => (a.from < b.from ? 1 : -1));
}

export interface AbsenceEdits {
  dismissed: string[]; // first day of a detected period that was not an absence
  added: Period[];
  /** S-13.7: first day of the periods whose start was moved back by the detection delay of the absence mode. */
  earlier?: string[];
}
export const NO_EDITS: AbsenceEdits = { dismissed: [], added: [], earlier: [] };

/**
 * Standing consumption of the water heater: 10th percentile of its daily kWh outside
 * absences. What it uses beyond that during an absence was heated for nobody.
 */
export function waterTalon(water: Map<string, number>, exclude: (day: string) => boolean, from: string, to: string): number | null {
  const v = [...water.entries()]
    .filter(([d, k]) => d >= from && d <= to && k > 0 && !exclude(d))
    .map(([, k]) => k)
    .sort((a, b) => a - b);
  if (v.length < 20) return null;
  return v[Math.floor(v.length * 0.1)];
}

export interface AbsenceSummary {
  days: number;
  heat: number;
  heatExpected: number | null; // usual heating at that weather, from the signature
  water: number;
  waterExcess: number | null; // kWh above the standing consumption
}

export function summarizeAbsence(
  p: Period,
  heat: Map<string, number>,
  water: Map<string, number>,
  expect: ((day: string) => number | null) | null,
  talon: number | null,
): AbsenceSummary {
  let h = 0;
  let w = 0;
  let e = 0;
  let eDays = 0;
  let excess = 0;
  let n = 0;
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    n++;
    h += heat.get(d) ?? 0;
    const wd = water.get(d) ?? 0;
    w += wd;
    if (talon !== null) excess += Math.max(0, wd - talon);
    const x = expect?.(d) ?? null;
    if (x !== null) (e += x), eDays++;
  }
  return { days: n, heat: h, heatExpected: eDays ? e : null, water: w, waterExcess: talon === null ? null : excess };
}
