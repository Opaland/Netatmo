// #428: the off-peak hours (heures creuses), one source for every computation that needs them:
// the solar simulator, the car charge, the schedules and the band of hours. In this order:
//   1. read in the half hours of the radiators (where the meter put the energy, HP or HC column);
//   2. else typed in ⚙ Mon contrat (several ranges, to the minute, encrypted on this device);
//   3. else 22 h → 6 h, stated as an assumption.
// A range whose bound falls inside a half hour counts that half hour pro rata of its minutes.
// #441: the ranges are dated. Enedis moves them in time (CRE reform: part of them goes to the
// afternoon) from a day it notifies; every computation takes, for each day, the ranges in force
// that day (`rangesOn`, `shareOn`). Read: a change of placement is detected in the half hours of
// the radiators (`periodsFromR30`); typed: a range may carry « à compter du » a day.
// Pure functions, no DOM, no app state: unit-tested in offpeak.test.ts, fuzzed in fuzz.test.ts.
import { addDays } from './aggregate';
import { dayLong } from './glossary';
import { type Room30, SLOTS, unpack } from './room30';

/** Minutes after midnight, [from, to); `to < from` runs over midnight. Never `from === to`. */
export interface HcRange {
  from: number;
  to: number;
}

/** A range typed in ⚙ Mon contrat: « à compter du » `since` (YYYY-MM-DD), else from the start. */
export interface TypedRange extends HcRange {
  since?: string;
}

/** The ranges in force from `since` (YYYY-MM-DD) on; null: from the start of what is known. */
export interface HcPeriod {
  since: string | null;
  ranges: HcRange[];
}

export type HcSource = 'releves' | 'saisies' | 'supposees';

export interface OffPeakPeriod extends HcPeriod {
  /** Share (0..1) of each half hour of the day (48) that is off-peak in this period. */
  share: number[];
}

export interface OffPeak {
  /** The ranges in force now (those of the last period). */
  ranges: HcRange[];
  /** Share (0..1) of each half hour of the day (48) that is off-peak now. */
  share: number[];
  source: HcSource;
  /** #441: every period, oldest first; the first one also covers the days before its `since`. */
  periods: OffPeakPeriod[];
}

const DAY = 1440;
/**
 * At most this many ranges are kept from what is typed: a contract has one to three, and #441
 * lets the ranges of a new one be typed « à compter du » a day next to the old ones.
 */
export const MAX_RANGES = 8;
/** The assumption when nothing else is known: 22 h → 6 h. */
export const FALLBACK_RANGES: readonly HcRange[] = [{ from: 22 * 60, to: 6 * 60 }];

/** Minutes of the day covered by the ranges (a minute covered twice counts once). */
function minutes(ranges: readonly HcRange[]): boolean[] {
  const on = new Array<boolean>(DAY).fill(false);
  for (const { from, to } of ranges) {
    const len = (to - from + DAY) % DAY;
    for (let k = 0; k < len; k++) on[(from + k) % DAY] = true;
  }
  return on;
}

/** Share of each half hour that is off-peak: 1 inside a range, minutes / 30 on a bound. */
export function slotShares(ranges: readonly HcRange[]): number[] {
  const on = minutes(ranges);
  const out = new Array<number>(SLOTS).fill(0);
  for (let m = 0; m < DAY; m++) if (on[m]) out[Math.floor(m / 30)] += 1 / 30;
  return out.map((v) => Math.round(v * 30) / 30);
}

/** Whether each half hour is mostly off-peak (half of it at least): the old boolean mask. */
export const slotMask = (ranges: readonly HcRange[]): boolean[] => slotShares(ranges).map((s) => s >= 0.5);

/** Hours as decimals for the band of the day (2,25 = 2 h 15). */
export const toHours = (ranges: readonly HcRange[]): [number, number][] => ranges.map((r) => [r.from / 60, r.to / 60]);

/**
 * Off-peak ranges read from the half hours of every room over [from, to]: a half hour is
 * off-peak when most of its energy went to the HC column; the half hour just before or after a
 * run, partly in HC, moves the bound pro rata of its HC energy (a bound at 2 h 02 shows as such).
 * Null when HC is never or always used (a Base contract, or nothing to tell the hours apart).
 * Over a window that straddles a change of placement, the two mix: use periodsFromR30 (#441).
 */
export function rangesFromR30(r30: Room30, from: string, to: string): HcRange[] | null {
  const hp = new Array<number>(SLOTS).fill(0);
  const hc = new Array<number>(SLOTS).fill(0);
  for (const days of r30.values()) {
    for (const [d, cols] of days) {
      if (d < from || d > to) continue;
      unpack(cols[0]).forEach((v, i) => (hp[i] += v ?? 0));
      unpack(cols[1]).forEach((v, i) => (hc[i] += v ?? 0));
    }
  }
  const share = hc.map((v, i) => (v > 0 ? v / (v + hp[i]) : 0));
  const off = share.map((s) => s >= 0.5);
  const n = off.filter(Boolean).length;
  if (!n || n === SLOTS) return null;
  const at = (i: number) => (i + SLOTS) % SLOTS;
  // walk the day from a peak half hour, so that a run over midnight is seen whole
  const start = off.indexOf(false);
  const out: HcRange[] = [];
  for (let k = 1; k <= SLOTS; k++) {
    const i = at(start + k);
    if (!off[i] || off[at(i - 1)]) continue;
    let j = i;
    while (off[at(j + 1)]) j = at(j + 1);
    const before = at(i - 1);
    const after = at(j + 1);
    // the bound inside the first / last half hour, or in its partly-HC neighbour
    const first = share[before] > 0 ? before * 30 + Math.round((1 - share[before]) * 30) : i * 30 + Math.round((1 - share[i]) * 30);
    const last = share[after] > 0 ? after * 30 + Math.round(share[after] * 30) : j * 30 + Math.round(share[j] * 30);
    const r = { from: first % DAY, to: last % DAY };
    if (r.from !== r.to) out.push(r);
  }
  return out.length ? out.sort((a, b) => a.from - b.from) : null;
}

// ------------------------------------------------------------------ #441 dated ranges, read

/**
 * #441: a change of placement counts once this many days with heating in a row show it.
 * A threshold that changes what is calculated, so justified here (AGENTS.md §2): Enedis notifies
 * new ranges « à compter du » a day and keeps them for months, so a true change does not revert
 * within days; what does revert is an odd day (a daylight saving day, a day collected late whose
 * HC energy lands on the wrong half hour). One or two such days must not split the history, nor
 * a long weekend of them (three); five is the shortest run beyond that, and still a week at most
 * in winter, when the radiators run every day. Days without heating (summer) tell nothing: they
 * neither count nor break the run. A change younger than this is not seen yet: the ranges read
 * before it stay in force until it is.
 */
export const STABLE_DAYS = 5;
/**
 * A half hour is clearly HC (or HP) when at least this share of its energy went to that column.
 * A half hour cut by a bound is split pro rata (about half and half) and stays undecided: only
 * clear half hours can contradict the placement read so far.
 */
const CLEAR = 0.8;

/** Per half hour: 1 off-peak, 0 peak, null no energy or undecided (a bound). */
type Tri = (0 | 1 | null)[];
interface Acc {
  hp: number[];
  hc: number[];
}
const newAcc = (): Acc => ({ hp: new Array<number>(SLOTS).fill(0), hc: new Array<number>(SLOTS).fill(0) });
function addTo(a: Acc, b: Acc) {
  for (let i = 0; i < SLOTS; i++) (a.hp[i] += b.hp[i]), (a.hc[i] += b.hc[i]);
}
function tri(a: Acc): Tri {
  return a.hp.map((p, i) => {
    const e = p + a.hc[i];
    if (!(e > 0)) return null;
    const s = a.hc[i] / e;
    return s >= CLEAR ? 1 : s <= 1 - CLEAR ? 0 : null;
  });
}
/** Whether a clear half hour of `day` contradicts `ref`. */
const conflicts = (day: Tri, ref: Tri) => day.some((v, i) => v !== null && ref[i] !== null && v !== ref[i]);

/** Energy HP / HC per half hour, every room summed, per day of [from, to]. */
function perDay(r30: Room30, from: string, to: string): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const days of r30.values()) {
    for (const [d, cols] of days) {
      if (d < from || d > to) continue;
      const a = out.get(d) ?? out.set(d, newAcc()).get(d)!;
      unpack(cols[0]).forEach((v, i) => (a.hp[i] += v ?? 0));
      unpack(cols[1]).forEach((v, i) => (a.hc[i] += v ?? 0));
    }
  }
  return out;
}

/**
 * #441: the days on which the placement of the off-peak half hours changes, over [from, to]:
 * the first day of each run of STABLE_DAYS days with heating that contradict the placement read
 * so far and agree with each other. A shorter run is noise and stays in the period it is in.
 * The date is the first day that shows the change: after days without heating, the true change
 * may be earlier, on one of them (they tell nothing).
 */
export function changesFromR30(r30: Room30, from: string, to: string): string[] {
  const days = perDay(r30, from, to);
  const out: string[] = [];
  let ref = newAcc();
  let cand: { start: string; acc: Acc; count: number } | null = null;
  for (const d of [...days.keys()].sort()) {
    const a = days.get(d)!;
    // a day without heating has no clear half hour: it conflicts with nothing and joins either side
    const t = tri(a);
    const old = conflicts(t, tri(ref));
    if (!cand) {
      if (old) cand = { start: d, acc: a, count: 1 };
      else addTo(ref, a);
      continue;
    }
    const fresh = conflicts(t, tri(cand.acc));
    if (old && !fresh) {
      addTo(cand.acc, a);
      if (++cand.count >= STABLE_DAYS) {
        out.push(cand.start);
        ref = cand.acc;
        cand = null;
      }
    } else if (!old && fresh) {
      // back to the old placement: the run was noise
      addTo(ref, cand.acc);
      addTo(ref, a);
      cand = null;
    } else if (!old) addTo(cand.acc, a);
    else cand = { start: d, acc: a, count: 1 }; // neither: a run starts again from this day
  }
  return out;
}

/**
 * #441: the dated off-peak ranges read in the half hours of the radiators over [from, to]: one
 * period per placement (changesFromR30), each with the ranges read over its own days. A period
 * with nothing to read (no HC) joins the one before. Null when nothing can be read.
 */
export function periodsFromR30(r30: Room30, from: string, to: string): HcPeriod[] | null {
  const bounds = [from, ...changesFromR30(r30, from, to)];
  const out: HcPeriod[] = [];
  bounds.forEach((start, k) => {
    const end = k + 1 < bounds.length ? addDays(bounds[k + 1], -1) : to;
    const ranges = rangesFromR30(r30, start, end);
    if (ranges) out.push({ since: out.length ? start : null, ranges });
  });
  return out.length ? out : null;
}

// ------------------------------------------------------------------ typed, then resolved

/** Whether `v` is a real day « YYYY-MM-DD » (no 30 February). */
function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * Ranges read back from this device (never trusted): integers of minutes, `from !== to`, at most
 * MAX_RANGES; anything else is dropped. « HH:MM » strings are accepted too (the form). #441: a
 * range may carry `since`, a real day « YYYY-MM-DD »; with an invalid one the range is dropped
 * (it would else apply from the start); a range without it, saved before #441, stays valid.
 */
export function parseHcRanges(raw: unknown): TypedRange[] {
  if (!Array.isArray(raw)) return [];
  const minute = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < DAY ? v : null;
    if (typeof v !== 'string') return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const out: TypedRange[] = [];
  for (const x of raw) {
    if (out.length >= MAX_RANGES) break;
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const from = Object.hasOwn(o, 'from') ? minute(o.from) : null;
    const to = Object.hasOwn(o, 'to') ? minute(o.to) : null;
    if (from === null || to === null || from === to) continue;
    const since = Object.hasOwn(o, 'since') ? o.since : undefined;
    if (since === undefined || since === null || since === '') out.push({ from, to });
    else if (isDay(since)) out.push({ from, to, since });
  }
  return out;
}

/**
 * #441: typed ranges grouped into periods: those without a day from the start, those « à compter
 * du » a day from that day on (every range of a new contract carries its day).
 */
export function periodsOfTyped(typed: readonly TypedRange[]): HcPeriod[] {
  const by = new Map<string | null, HcRange[]>();
  for (const { from, to, since } of typed) {
    const k = since ?? null;
    (by.get(k) ?? by.set(k, []).get(k)!).push({ from, to });
  }
  return [...by]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1))
    .map(([since, ranges]) => ({ since, ranges: ranges.sort((x, y) => x.from - y.from) }));
}

/**
 * #441: the period in force on `day`: the last one started on or before it; before the first
 * dated period, the first one (the earliest known). Undefined without periods.
 */
export function periodOn<P extends HcPeriod>(periods: readonly P[], day: string): P | undefined {
  let at = periods[0];
  for (const p of periods) if (p.since === null || p.since <= day) at = p;
  return at;
}
/** #441: the ranges in force on `day` (periodOn); empty without periods. */
export const rangesOn = (periods: readonly HcPeriod[], day: string): HcRange[] => periodOn(periods, day)?.ranges ?? [];
/** #441: share (0..1) of each half hour that is off-peak on `day` (solar simulator, car charge). */
export const shareOn = (o: OffPeak, day: string): number[] => periodOn(o.periods, day)?.share ?? o.share;

const isPeriods = (x: readonly (HcRange | HcPeriod)[]): x is readonly HcPeriod[] => x.some((p) => Object.hasOwn(p, 'ranges'));

/**
 * The ranges to use: read in the data, else typed, else 22 h → 6 h. Each may be dated (#441):
 * periods read, typed ranges « à compter du » a day; plain ranges make one period.
 */
export function resolveOffPeak(read: readonly (HcRange | HcPeriod)[] | null | undefined, typed: readonly TypedRange[] | null | undefined): OffPeak {
  const pick = (periods: readonly HcPeriod[], source: HcSource): OffPeak => {
    const ps = periods.map((p) => ({ since: p.since, ranges: p.ranges.map(({ from, to }) => ({ from, to })), share: slotShares(p.ranges) }));
    const last = ps[ps.length - 1];
    return { ranges: last.ranges, share: last.share, source, periods: ps };
  };
  const readPeriods = read?.length ? (isPeriods(read) ? read.filter((p) => p.ranges.length) : [{ since: null, ranges: read as HcRange[] }]) : [];
  if (readPeriods.length) return pick(readPeriods, 'releves');
  if (typed?.length) return pick(periodsOfTyped(typed), 'saisies');
  return pick([{ since: null, ranges: [...FALLBACK_RANGES] }], 'supposees');
}

/** « 2 h 15 », « 22 h ». */
export function minuteText(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return mm ? `${h} h ${String(mm).padStart(2, '0')}` : `${h} h`;
}
/** « 2 h 15 → 7 h 45, 13 h 15 → 15 h 45 ». */
export const rangesText = (ranges: readonly HcRange[]) => ranges.map((r) => `${minuteText(r.from)} → ${minuteText(r.to)}`).join(', ');

/** Where the ranges come from, said on the screen. */
export const SOURCE_TEXT: Record<HcSource, string> = {
  releves: 'lues dans vos relevés',
  saisies: 'saisies dans ⚙ Mon contrat',
  supposees: 'supposées (celles de votre compteur, sur votre facture, peuvent différer : saisissez-les dans ⚙ Mon contrat)',
};

/**
 * #441: the periods said in words, the one in force first: « 1 h → 7 h depuis le 3 mars 2026 ;
 * avant le 3 mars 2026, 22 h → 6 h ». One period: its ranges only.
 */
export function periodsText(periods: readonly HcPeriod[]): string {
  if (periods.length < 2) return rangesText(periods[0]?.ranges ?? []);
  const newest = [...periods].reverse();
  return newest
    .map((p, k) => {
      if (k === 0) return `${rangesText(p.ranges)} depuis le ${dayLong(p.since!)}`;
      const until = newest[k - 1].since!;
      return p.since && k < newest.length - 1
        ? `du ${dayLong(p.since)} au ${dayLong(addDays(until, -1))}, ${rangesText(p.ranges)}`
        : `avant le ${dayLong(until)}, ${rangesText(p.ranges)}`;
    })
    .join(' ; ');
}

/** « Heures creuses lues dans vos relevés : 2 h 15 → 7 h 45, 13 h 15 → 15 h 45 » (#441: dated). */
export const offPeakSentence = (o: OffPeak) => `Heures creuses ${SOURCE_TEXT[o.source]} : ${o.periods?.length ? periodsText(o.periods) : rangesText(o.ranges)}`;
