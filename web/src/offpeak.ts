// #428: the off-peak hours (heures creuses), one source for every computation that needs them:
// the solar simulator, the car charge, the schedules and the band of hours. In this order:
//   1. read in the half hours of the radiators (where the meter put the energy, HP or HC column);
//   2. else typed in ⚙ Mon contrat (several ranges, to the minute, encrypted on this device);
//   3. else 22 h → 6 h, stated as an assumption.
// A range whose bound falls inside a half hour counts that half hour pro rata of its minutes.
// Pure functions, no DOM, no app state: unit-tested in offpeak.test.ts, fuzzed in fuzz.test.ts.
import { type Room30, SLOTS, unpack } from './room30';

/** Minutes after midnight, [from, to); `to < from` runs over midnight. Never `from === to`. */
export interface HcRange {
  from: number;
  to: number;
}

export type HcSource = 'releves' | 'saisies' | 'supposees';

export interface OffPeak {
  ranges: HcRange[];
  /** Share (0..1) of each half hour of the day (48) that is off-peak. */
  share: number[];
  source: HcSource;
}

const DAY = 1440;
/** At most this many ranges are kept from what is typed (contracts have one to three). */
export const MAX_RANGES = 4;
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

/**
 * Ranges read back from this device (never trusted): integers of minutes, `from !== to`, at most
 * MAX_RANGES; anything else is dropped. « HH:MM » strings are accepted too (the form).
 */
export function parseHcRanges(raw: unknown): HcRange[] {
  if (!Array.isArray(raw)) return [];
  const minute = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < DAY ? v : null;
    if (typeof v !== 'string') return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const out: HcRange[] = [];
  for (const x of raw) {
    if (out.length >= MAX_RANGES) break;
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const from = Object.hasOwn(o, 'from') ? minute(o.from) : null;
    const to = Object.hasOwn(o, 'to') ? minute(o.to) : null;
    if (from === null || to === null || from === to) continue;
    out.push({ from, to });
  }
  return out;
}

/** The ranges to use: read in the data, else typed, else 22 h → 6 h. */
export function resolveOffPeak(read: readonly HcRange[] | null | undefined, typed: readonly HcRange[] | null | undefined): OffPeak {
  const pick = (ranges: readonly HcRange[], source: HcSource): OffPeak => ({ ranges: [...ranges], share: slotShares(ranges), source });
  if (read?.length) return pick(read, 'releves');
  if (typed?.length) return pick(typed, 'saisies');
  return pick(FALLBACK_RANGES, 'supposees');
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

/** « Heures creuses lues dans vos relevés : 2 h 15 → 7 h 45, 13 h 15 → 15 h 45 ». */
export const offPeakSentence = (o: OffPeak) => `Heures creuses ${SOURCE_TEXT[o.source]} : ${rangesText(o.ranges)}`;
