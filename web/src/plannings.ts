// S-4.13 (#211): « Mes plannings et les heures creuses ». From the half hours of each room
// (room30.ts: energy HP / HC, measured temperature, requested temperature), read the comfort
// starts of the schedules (a rise of the requested temperature), how far and how fast the room
// really warmed, what that cost in peak / off-peak hours, and whether starting earlier, in the
// off-peak hours, would cost less. Read-only: nothing here, nor in the view, changes a radiator.
// Pure functions, no DOM: unit-tested in plannings.test.ts.
import { periodsFromR30, rangesOn, slotMask } from './offpeak';
import { type Room30, SLOTS, unpack } from './room30';

/** A rise of the requested temperature of at least this much starts a comfort slot (°C). */
export const RISE_MIN = 1;
/** The room counts as warm once within this much of the requested temperature (°C). */
export const REACHED_TOL = 0.3;
/** A rise is followed 6 h at most (12 half hours), or until the requested temperature goes down. */
export const FOLLOW_SLOTS = 12;
/** Setpoints below this are frost guard or « off » (piece.ts LIVING_SETPOINT). */
const LIVING = 10;
/** A comfort start reached in more than 2 h is late. */
export const LATE_SLOTS = 4;

/**
 * Whether each half hour of the day is an off-peak one, read from where the energy went (HP or HC):
 * the shared reading of offpeak.ts (#428). #441: those in force on `to` (a change of placement
 * inside the window is not mixed in: a suggestion is for the days to come). Null without off-peak energy.
 */
export function offPeakMask(r30: Room30, from: string, to: string): boolean[] | null {
  const periods = periodsFromR30(r30, from, to);
  return periods ? slotMask(rangesOn(periods, to)) : null;
}

/** Days left out of the analysis (absences: the schedule did not run). */
type Skip = Set<string> | undefined;

/** kWh in peak and off-peak hours of `rooms` (raw ids) over [from, to], and the days counted. */
export function energySplit(r30: Room30, rooms: string[], from: string, to: string, skip?: Skip): { hp: number; hc: number; days: number } {
  let hp = 0;
  let hc = 0;
  const days = new Set<string>();
  for (const id of rooms) {
    for (const [d, cols] of r30.get(id) ?? []) {
      if (d < from || d > to || skip?.has(d) || (cols[0] === null && cols[1] === null)) continue;
      days.add(d);
      for (const v of unpack(cols[0])) hp += v ?? 0;
      for (const v of unpack(cols[1])) hc += v ?? 0;
    }
  }
  return { hp: hp / 1000, hc: hc / 1000, days: days.size };
}

export interface Rise {
  day: string;
  /** Half hour (0-47) the requested temperature went up. */
  slot: number;
  /** Requested temperature after the rise, °C. */
  target: number;
  /** Measured temperature just before, °C (null when unknown). */
  start: number | null;
  /** Highest measured temperature while followed, °C. */
  max: number | null;
  /** Half hours from the rise until the room was warm (0: already warm), or null when never. */
  reached: number | null;
  /** Half hours followed (the comfort slot, at most FOLLOW_SLOTS). */
  span: number;
  /** kWh spent warming up (from the rise until warm, or the whole span), and the part in peak hours. */
  kwh: number;
  hpKwh: number;
  /** kWh and half hours of holding the comfort temperature once reached (within the span). */
  holdKwh: number;
  holdSlots: number;
}

/** Comfort starts of one room (raw id) over [from, to]. */
export function rises(r30: Room30, room: string, from: string, to: string, skip?: Skip): Rise[] {
  const out: Rise[] = [];
  for (const [day, cols] of r30.get(room) ?? []) {
    if (day < from || day > to || skip?.has(day)) continue;
    const sp = unpack(cols[3]);
    const t = unpack(cols[2]);
    const hp = unpack(cols[0]);
    const hc = unpack(cols[1]);
    for (let i = 1; i < SLOTS; i++) {
      const a = sp[i - 1];
      const b = sp[i];
      if (a === null || b === null || b - a < RISE_MIN || b < LIVING) continue;
      let end = i + 1;
      while (end < Math.min(SLOTS, i + FOLLOW_SLOTS) && (sp[end] === null || sp[end]! >= b - 0.25)) end++;
      const start = t[i - 1] ?? t[i];
      let reached: number | null = null;
      let max: number | null = null;
      let kwh = 0;
      let hpKwh = 0;
      let holdKwh = 0;
      let holdSlots = 0;
      for (let j = i; j < end; j++) {
        const e = ((hp[j] ?? 0) + (hc[j] ?? 0)) / 1000;
        const v = t[j];
        if (v !== null) max = max === null ? v : Math.max(max, v);
        if (reached === null) {
          kwh += e;
          hpKwh += (hp[j] ?? 0) / 1000;
          if (v !== null && v >= b - REACHED_TOL) reached = j - i;
        } else {
          holdKwh += e;
          holdSlots++;
        }
      }
      out.push({ day, slot: i, target: b, start, max, reached, span: end - i, kwh, hpKwh, holdKwh, holdSlots });
    }
  }
  return out.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.slot - y.slot));
}

export interface RiseGroup {
  /** Half hour of the day of these comfort starts. */
  slot: number;
  target: number;
  n: number;
  /** Times the room got warm within the comfort slot, of which already warm at the start. */
  reached: number;
  warm: number;
  /** Average half hours to get warm (rises reached after the start), null when none. */
  delay: number | null;
  /** Average °C gained (highest − before) and average °C missing when not reached. */
  gain: number | null;
  missing: number | null;
  /** Average kWh per warm-up, its share in peak hours, and the half hours of warm-ups never reached. */
  kwh: number;
  hpShare: number;
  wasted: number;
  /** kWh per half hour holding the comfort temperature (null without such half hours). */
  hold: number | null;
}

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Comfort starts grouped by their half hour of the day (the schedule's), most frequent first; groups under `minN` left out. */
export function groupRises(list: Rise[], minN = 3): RiseGroup[] {
  const by = new Map<number, Rise[]>();
  for (const r of list) by.set(r.slot, [...(by.get(r.slot) ?? []), r]);
  const out: RiseGroup[] = [];
  for (const [slot, rs] of by) {
    if (rs.length < minN) continue;
    const reached = rs.filter((r) => r.reached !== null);
    const warming = reached.filter((r) => r.reached! > 0);
    const kwh = rs.reduce((s, r) => s + r.kwh, 0);
    const hpKwh = rs.reduce((s, r) => s + r.hpKwh, 0);
    const holdSlots = rs.reduce((s, r) => s + r.holdSlots, 0);
    const targets = rs.map((r) => r.target).sort((a, b) => a - b);
    out.push({
      slot,
      target: targets[Math.floor(targets.length / 2)],
      n: rs.length,
      reached: reached.length,
      warm: reached.length - warming.length,
      delay: avg(warming.map((r) => r.reached!)),
      gain: avg(rs.filter((r) => r.start !== null && r.max !== null).map((r) => r.max! - r.start!)),
      missing: avg(rs.filter((r) => r.reached === null && r.max !== null).map((r) => r.target - r.max!)),
      kwh: kwh / rs.length,
      hpShare: kwh > 0 ? hpKwh / kwh : 0,
      wasted: rs.filter((r) => r.reached === null).reduce((s, r) => s + r.span, 0),
      hold: holdSlots ? rs.reduce((s, r) => s + r.holdKwh, 0) / holdSlots : null,
    });
  }
  return out.sort((a, b) => b.n - a.n || a.slot - b.slot);
}

/** kWh per half hour in the economy slots (requested temperature at the day's lowest, within 0,25 °C). */
export function ecoRate(r30: Room30, room: string, from: string, to: string, skip?: Skip): number | null {
  let kwh = 0;
  let n = 0;
  for (const [d, cols] of r30.get(room) ?? []) {
    if (d < from || d > to || skip?.has(d)) continue;
    const sp = unpack(cols[3]);
    const known = sp.filter((v): v is number => v !== null && v >= LIVING);
    if (known.length < 40) continue;
    const lo = Math.min(...known);
    if (Math.max(...known) - lo < RISE_MIN) continue;
    const hp = unpack(cols[0]);
    const hc = unpack(cols[1]);
    sp.forEach((v, i) => {
      if (v === null || v > lo + 0.25) return;
      kwh += ((hp[i] ?? 0) + (hc[i] ?? 0)) / 1000;
      n++;
    });
  }
  return n ? kwh / n : null;
}

export interface Shift {
  /** Half hour of the comfort start today, and the one proposed. */
  from: number;
  to: number;
  /** Half hours between the end of the off-peak hours and today's start (comfort held earlier, in peak hours). */
  gap: number;
  /** kWh of warm-up moved to the off-peak hours, per comfort start. */
  kwh: number;
  /** € saved per month of heating (30 days), a range: the extra holding of the comfort temperature is uncertain. */
  low: number;
  high: number;
}

/**
 * The comfort start moved so that the warm-up ends with the off-peak hours: today's warm-up in
 * peak hours (kWh × share) becomes off-peak (saves hp − hc per kWh), but the room is then held at
 * comfort from the end of the off-peak hours to today's start (the difference between holding and
 * economy, at the peak price). The range takes that extra holding between 0,7 and 1,3 times its
 * estimate, and the warm-up moved between 70 % and 100 %. Null when the start is already off-peak,
 * no off-peak hour ends in the 4 h before it, the warm-up is not known (reached less than half the
 * time) or the gain is nil.
 */
export function suggestShift(g: RiseGroup, offPeak: boolean[] | null, eco: number | null, prices: { hp: number; hc: number }, perMonth: number): Shift | null {
  if (!offPeak || offPeak[g.slot] || g.delay === null || g.reached < g.n / 2 || prices.hp <= prices.hc) return null;
  let end = -1; // first peak half hour after the off-peak hours that precede the start
  for (let k = g.slot - 1; k >= Math.max(0, g.slot - 8); k--) {
    if (offPeak[k]) {
      end = k + 1;
      break;
    }
  }
  if (end < 0) return null;
  const gap = g.slot - end;
  const to = end - Math.ceil(g.delay);
  if (to < 0) return null;
  const moved = g.kwh * g.hpShare;
  const extra = gap * Math.max(0, (g.hold ?? 0) - (eco ?? 0)) * prices.hp;
  const save = moved * (prices.hp - prices.hc);
  const high = (save - 0.7 * extra) * perMonth;
  const low = Math.max(0, (0.7 * save - 1.3 * extra) * perMonth);
  if (high < 0.5) return null;
  return { from: g.slot, to, gap, kwh: moved, low, high };
}

export type Verdict = 'shift' | 'late' | 'unreached' | 'warm' | 'ok';

/** What to say of a group of comfort starts: the first that applies. */
export function verdict(g: RiseGroup, shift: Shift | null): Verdict {
  if (shift) return 'shift';
  if (g.reached < g.n / 2) return 'unreached';
  if (g.delay !== null && g.delay > LATE_SLOTS) return 'late';
  if (g.warm > g.n / 2) return 'warm';
  return 'ok';
}
