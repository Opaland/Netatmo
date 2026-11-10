// S-2.14: electric-vehicle charging simulation. Pure functions, no DOM, no app state.
// The charge of each day starts at the same local time, at constant power, until the daily
// energy is delivered (it may run past midnight). The off-peak hours are the shared ones of
// offpeak.ts (#428): read in the half hours, else typed, else 22 h → 6 h stated as an assumption.
import type { DaySplit } from './analysis';
import { type Curve, SLOTS, watts } from './curve';
import { FALLBACK_RANGES, slotShares } from './offpeak';

export interface EvInput {
  kwhWeek: number; // energy taken from the grid per week (charging losses included)
  powerKw: number; // charging power
  startHour: number; // 0..23, local time
}

/** Default inputs of the simulation. */
export const EV_DEFAULT: EvInput = { kwhWeek: 40, powerKw: 7.4, startHour: 22 };

/** #359: inputs read back from this device, each field bounded (anything else: its default). */
export function parseEvInput(raw: unknown, powers: readonly number[]): EvInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EvInput, unknown>>;
  // a number or a numeric string only: Number() of an object with an own `toString` throws
  const kwh = typeof o.kwhWeek === 'number' ? o.kwhWeek : typeof o.kwhWeek === 'string' ? Number(o.kwhWeek) : NaN;
  const start = o.startHour;
  return {
    kwhWeek: kwh > 0 && kwh <= 500 ? kwh : EV_DEFAULT.kwhWeek,
    powerKw: powers.includes(o.powerKw as number) ? (o.powerKw as number) : EV_DEFAULT.powerKw,
    startHour: typeof start === 'number' && Number.isInteger(start) && start >= 0 && start < 24 ? start : EV_DEFAULT.startHour,
  };
}

export interface EvPlan {
  kwhDay: number;
  hc: number; // kWh per day in off-peak hours
  hp: number; // kWh per day in peak hours
  hours: number; // charging duration per day
  /** Average W per local "HH:MM" slot: `same` for the day the charge starts, `next` for what runs past midnight. */
  same: number[];
  next: number[];
}

/**
 * Daily charge, half hour by half hour. `offPeak`: share (0..1) of each half hour that is
 * off-peak (offpeak.ts); a half hour cut by a bound counts pro rata of its minutes.
 */
export function evPlan({ kwhWeek, powerKw, startHour }: EvInput, offPeak: readonly number[] = slotShares(FALLBACK_RANGES)): EvPlan | null {
  if (!(kwhWeek > 0) || !(powerKw > 0)) return null;
  const kwhDay = kwhWeek / 7;
  const same = new Array(48).fill(0);
  const next = new Array(48).fill(0);
  let left = kwhDay;
  let hc = 0;
  let hp = 0;
  // 96 half hours at most: beyond, the car would never be full (stated as « recharge impossible »).
  for (let i = 0; i < 96 && left > 1e-9; i++) {
    const abs = startHour * 2 + i;
    const slot = abs % 48;
    const kwh = Math.min(left, powerKw / 2);
    left -= kwh;
    (abs < 48 ? same : next)[slot] += kwh * 2000; // kWh over 30 min -> W
    const f = offPeak[slot] ?? 0;
    hc += kwh * f;
    hp += kwh * (1 - f);
  }
  if (left > 1e-9) return null;
  return { kwhDay, hc, hp, hours: kwhDay / powerKw, same, next };
}

/** The same days with the charge added (each day carries the charge started that evening). */
export function addCharge(splits: DaySplit[], plan: EvPlan): DaySplit[] {
  return splits.map((s) => ({ day: s.day, hc: s.hc + plan.hc, hp: s.hp + plan.hp }));
}

export interface PeakResult {
  slots: number; // half hours above the subscribed power once the charge is added
  days: number; // days with at least one such half hour
  slotsBefore: number; // same count without the charge
  maxW: number; // highest half hour with the charge
  maxKey: string | null;
  maxBeforeW: number;
  covered: number; // half hours of the curve examined
}

/**
 * Half hours of the Linky curve, over [from, to], whose average power plus the charge exceeds
 * the subscribed power (kVA taken as kW: cos φ ≈ 1, a simplification stated in the card).
 */
export function chargePeaks(curve: Curve, tz: string, from: string, to: string, plan: EvPlan, kvaAt: (day: string) => number): PeakResult {
  const out: PeakResult = { slots: 0, days: 0, slotsBefore: 0, maxW: 0, maxKey: null, maxBeforeW: 0, covered: 0 };
  const days = new Set<string>();
  for (const [key, wh] of curve) {
    const day = key.slice(0, 10);
    if (day < from || day > to) continue;
    const slot = SLOTS.indexOf(key.slice(11, 16));
    if (slot < 0) continue;
    out.covered++;
    const base = watts(tz, key, wh);
    // the charge started this evening, and the end of yesterday's (past midnight): every day charges
    const ev = plan.same[slot] + plan.next[slot];
    const limit = kvaAt(day) * 1000;
    const w = base + ev;
    if (base > limit) out.slotsBefore++;
    if (w > limit) {
      out.slots++;
      days.add(day);
    }
    if (w > out.maxW) (out.maxW = w), (out.maxKey = key);
    if (base > out.maxBeforeW) out.maxBeforeW = base;
  }
  out.days = days.size;
  return out;
}

/** kWh per week for a yearly distance, a consumption per 100 km and a charging efficiency. */
export function kwhPerWeek(kmYear: number, kwhPer100: number, efficiency = 0.9): number {
  return (kmYear * kwhPer100) / 100 / efficiency / 52;
}

/** Yearly distance matching a weekly energy (inverse of kwhPerWeek). */
export function kmPerYear(kwhWeek: number, kwhPer100: number, efficiency = 0.9): number {
  return (kwhWeek * 52 * efficiency * 100) / kwhPer100;
}
