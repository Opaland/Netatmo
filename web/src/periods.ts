// Partial periods and lost days (#297, #246): pure helpers shared by the charts, the
// comparisons and the report. A chart bucket (week, month, year…) is « partial » when the
// period shown or the data only covers part of it; it is « uncertain » when it contains
// estimated or lost days. Both are said in the tooltip and on the bar, at every granularity.
import { type Granularity, addDays, bucketKey, minusYears } from './aggregate';
import { dayShort, plural } from './glossary';

/** #394: the cause of a cut (incidents.ts). */
export type CutKind = 'power' | 'internet';

/** « 1 jour de coupure de courant », « 2 jours de coupure (courant, Internet) » ('' when none). */
export function cutText(days: string[], causes: Map<string, CutKind>): string {
  if (!days.length) return '';
  const kinds = new Set(days.map((d) => causes.get(d)));
  const n = `${days.length} jour${days.length > 1 ? 's' : ''} de coupure`;
  return kinds.size > 1 ? `${n} (courant, Internet)` : `${n} ${kinds.has('power') ? 'de courant' : 'Internet'}`;
}

const DAY_MS = 86400000;
/** Days from `from` to `to`, both included (calendar days: no DST effect, dates are UTC). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
/** Average length of a month, to turn a number of days into months (365.25 / 12). */
export const MONTH_DAYS = 30.4375;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const lastOfMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** « 1er nov. », « 8 nov. » (with the year when asked): glossary.ts (#299). */
export const shortDate = (day: string, withYear = false) => dayShort(day, withYear);

/** First and last calendar day of a bucket. */
export function bucketRange(key: string, g: Granularity): [string, string] {
  switch (g) {
    case 'day':
      return [key, key];
    case 'week':
      return [key, addDays(key, 6)];
    case 'month':
      return [`${key}-01`, lastOfMonth(key)];
    case 'year':
      return [`${key}-01-01`, `${key}-12-31`];
  }
}

/** « 18 jours estimés ou manquants ». */
export const uncertainText = (n: number) => `${plural(n, 'jour')} estimé${n > 1 ? 's' : ''} ou manquant${n > 1 ? 's' : ''}`;

/**
 * #570: the mark of a total that holds days without any reading (lost at Intuis, a device out of
 * reach): « incomplet », wherever the total is written, with the days in a note (« 45 jours
 * manquants » ; a usage with no reading at all is named, not counted day by day: incompleteParts,
 * #580). An estimated day (spread from the month's total) is no missing day: the total holds it.
 */
export const INCOMPLETE = 'incomplet';
export const missingText = (n: number) => `${plural(n, 'jour')} manquant${n > 1 ? 's' : ''}`;

export interface BucketMark {
  /** Days of the bucket inside the period shown and the data (0: none). */
  covered: number;
  /** Calendar days of the bucket. */
  length: number;
  partial: boolean;
  /** Estimated or lost days inside the covered part. */
  uncertain: number;
  /** Sentence for the tooltip, null when the bucket is complete and fully measured. */
  note: string | null;
}

/**
 * For each bucket: is it cut by the period [from, to] (pass the data's first and last day
 * when they are narrower), and how many of its days are estimated or lost?
 */
export function bucketMarks(keys: string[], g: Granularity, from: string, to: string, uncertain: Set<string> = new Set()): BucketMark[] {
  const counts = new Map<string, number>();
  for (const d of uncertain) if (d >= from && d <= to) counts.set(bucketKey(d, g), (counts.get(bucketKey(d, g)) ?? 0) + 1);
  return keys.map((k) => {
    const [a, b] = bucketRange(k, g);
    const lo = a > from ? a : from;
    const hi = b < to ? b : to;
    const covered = lo <= hi ? daysBetween(lo, hi) : 0;
    const length = daysBetween(a, b);
    const partial = covered > 0 && covered < length;
    const n = covered ? (counts.get(k) ?? 0) : 0;
    const parts: string[] = [];
    if (partial) parts.push(`${covered} jour${covered > 1 ? 's' : ''} sur ${length} (${lo === hi ? `le ${shortDate(lo)}` : `du ${shortDate(lo)} au ${shortDate(hi)}`})`);
    if (n) parts.push(g === 'day' ? 'jour estimé ou manquant' : uncertainText(n));
    return { covered, length, partial, uncertain: n, note: parts.length ? parts.join(' · ') : null };
  });
}

/** The 12 calendar months of a year as bucket keys ("2026-01" …). */
export const monthKeys = (year: number) => Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, '0')}`);

/**
 * Same-period comparison of a year with the one before (#297): both windows are cut to
 * what both years can show, i.e. from the first data day when the previous year started
 * late, and up to the last data day when the year is still running.
 */
export interface YoyWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** Neither a full year nor the usual « 1er janvier → today » of the running year. */
  cut: boolean;
  /** Short French description of the window when it is not the whole year (« du 1er juin au 31 déc. »). */
  label: string | null;
}

export function yoyWindow(year: number, first: string, last: string): YoyWindow | null {
  if (first > `${year - 1}-12-31` || last < `${year}-01-01`) return null;
  let start = first > `${year - 1}-01-01` ? first.slice(5) : '01-01';
  if (start === '02-29' && !isLeap(year)) start = '03-01';
  const from = `${year}-${start}`;
  const to = last < `${year}-12-31` ? last : `${year}-12-31`;
  if (from > to) return null;
  const cut = start !== '01-01';
  const label = cut || to < `${year}-12-31` ? `du ${shortDate(from)} au ${shortDate(to)}` : null;
  return { from, to, prevFrom: minusYears(from), prevTo: minusYears(to), cut, label };
}

/** Short suffix for a year label (#297): « (au 8 nov.) », « (depuis le 1er juin) », « (du 1er juin au 8 nov.) ». */
export function windowSuffix(w: YoyWindow | null): string {
  if (!w) return '';
  const y = w.from.slice(0, 4);
  const toDate = w.to < `${y}-12-31`;
  if (w.cut && toDate) return ` (du ${shortDate(w.from)} au ${shortDate(w.to)})`;
  if (w.cut) return ` (depuis le ${shortDate(w.from)})`;
  return toDate ? ` (au ${shortDate(w.to)})` : '';
}

/** Number of estimated or lost days between two days (inclusive). */
export function countIn(days: Set<string>, from: string, to: string): number {
  let n = 0;
  for (const d of days) if (d >= from && d <= to) n++;
  return n;
}

/**
 * The warning that goes with a year-over-year percentage (#297): the window when it is cut,
 * and the estimated or lost days on either side. Empty when the comparison is clean.
 */
export function yoyCaveat(w: YoyWindow | null, uncertain: Set<string>, opts: { toDate?: boolean; cuts?: Map<string, CutKind> } = {}): string {
  if (!w) return '';
  const parts: string[] = [];
  if (w.cut) parts.push(`même période (${w.label})`);
  else if (w.label && opts.toDate !== false) parts.push('à date');
  const now = countIn(uncertain, w.from, w.to);
  const before = countIn(uncertain, w.prevFrom, w.prevTo);
  if (now) parts.push(`${w.from.slice(0, 4)} : ${uncertainText(now)}`);
  if (before) parts.push(`${w.prevFrom.slice(0, 4)} : ${uncertainText(before)}`);
  // #394: a cut lowers its day without saying anything of the household
  const cut = (f: string, t: string) => cutText([...(opts.cuts?.keys() ?? [])].filter((d) => d >= f && d <= t), opts.cuts ?? new Map());
  const cutNow = cut(w.from, w.to);
  const cutBefore = cut(w.prevFrom, w.prevTo);
  if (cutNow) parts.push(`${w.from.slice(0, 4)} : ${cutNow}`);
  if (cutBefore) parts.push(`${w.prevFrom.slice(0, 4)} : ${cutBefore}`);
  return parts.join(' · ');
}

/** Months covered by a period, for « par mois en moyenne » (#246). */
export function monthsCovered(from: string, to: string): number {
  return from <= to ? daysBetween(from, to) / MONTH_DAYS : 0;
}
