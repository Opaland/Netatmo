// S-13.7 (#210): periods of absence rebuilt from the absence mode of the radiators. The Muller /
// Intuis radiators switch by themselves to the absence mode after a while without anyone detected
// (about 12 h, docs/api-notes.md); the mode ends when someone comes back. The hourly snapshots keep
// only DAILY hours per mode (roomstate.enc.json, S-13.5: no hour-by-hour presence), from which the
// start and end hours are rebuilt: the first day of a run is away until midnight, the last one from
// midnight. Pure functions, no DOM: unit-tested in away.test.ts.
import { addDays } from './aggregate';
import { ABSENCE_MODES, type RoomState, type StateCell } from './windows';

/** Hours without anyone detected before the radiators switch to the absence mode (to be checked). */
export const AUTO_AWAY_DELAY_H = 12;
/** A day reaches midnight in absence from this many hours (snapshots missed are pro rata). */
const FULL_DAY_H = 23;
/** Below this, an absence mode of the day is noise (a snapshot, a manual test). */
const MIN_DAY_H = 1;
/** A run shorter than this is not an absence of the home (an evening out). */
export const MIN_RUN_H = 6;

const awayHours = (c: StateCell) => ABSENCE_MODES.reduce((s, m) => s + (c.mode_h?.[m] ?? 0), 0);
/** Radiator rooms only: the water heater has a contactor, no setpoint mode. */
const isRadiator = (c: StateCell) => c.boost_h !== undefined || c.mode_h !== undefined || c.open_window_h !== undefined;

/**
 * Hours of absence of the home per day: the absence mode on every radiator room (the least of
 * them: the home is empty only when no room has left the mode). Days with no radiator room are left out.
 */
export function homeAwayHours(rs: RoomState): Map<string, number> {
  const out = new Map<string, number>();
  for (const cells of Object.values(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      if (!isRadiator(c)) continue;
      const h = Math.min(24, awayHours(c));
      out.set(d, Math.min(out.get(d) ?? Infinity, h));
    }
  }
  return out;
}

export interface AwayRun {
  from: string;
  to: string;
  /** Local hour the absence mode started on `from` (null for a single day: only its length is known). */
  startHour: number | null;
  /** Local hour it ended on `to` (null for a single day). */
  endHour: number | null;
  /** Hours in absence over the run. */
  hours: number;
  /** Hours in absence per day of the run. */
  days: [string, number][];
}

/**
 * Runs of absence from hours per day: consecutive days with at least 1 h, a day continuing the run
 * only when the day before stayed in absence until midnight (the first day of a run does, by
 * definition). Runs under `minHours` are dropped.
 */
export function awayRuns(daily: Map<string, number>, minHours = MIN_RUN_H): AwayRun[] {
  const days = [...daily.keys()].filter((d) => daily.get(d)! >= MIN_DAY_H).sort();
  const runs: [string, number][][] = [];
  for (const d of days) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && addDays(prev[0], 1) === d && (run.length === 1 || prev[1] >= FULL_DAY_H)) run.push([d, daily.get(d)!]);
    else runs.push([[d, daily.get(d)!]]);
  }
  return runs
    .map((r) => {
      const hours = r.reduce((s, [, h]) => s + h, 0);
      const multi = r.length > 1;
      return {
        from: r[0][0],
        to: r[r.length - 1][0],
        startHour: multi ? Math.max(0, Math.round(24 - r[0][1])) : null,
        endHour: multi ? Math.min(24, Math.round(r[r.length - 1][1])) : null,
        hours: Math.round(hours),
        days: r,
      };
    })
    .filter((r) => r.hours >= minHours);
}

/** Absences of the home (every radiator room in the absence mode). */
export const homeAbsences = (rs: RoomState, minHours = MIN_RUN_H) => awayRuns(homeAwayHours(rs), minHours);

/**
 * Absences of one room only (S-13.7: a room alone in the absence mode is not an absence of the
 * home): per display key (`groupOf`, bedrooms grouped unless shown, S-13.5), the days and hours in
 * absence while the home was not.
 */
export function roomOnlyAway(rs: RoomState, groupOf: (room: string) => string = (r) => r, minDayHours = 6): Map<string, { days: number; hours: number }> {
  const home = homeAwayHours(rs);
  const per = new Map<string, Map<string, number>>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      if (!isRadiator(c)) continue;
      const own = Math.min(24, awayHours(c)) - (home.get(d) ?? 0);
      if (own < minDayHours) continue;
      const key = groupOf(room);
      const m = per.get(key) ?? new Map<string, number>();
      m.set(d, Math.max(m.get(d) ?? 0, own));
      per.set(key, m);
    }
  }
  const out = new Map<string, { days: number; hours: number }>();
  for (const [k, m] of per) out.set(k, { days: m.size, hours: Math.round([...m.values()].reduce((a, b) => a + b, 0)) });
  return out;
}

/** Local date and hour `h` hours before `day` at `hour` (the start corrected by the detection delay). */
export function shiftBack(day: string, hour: number, h: number): { day: string; hour: number } {
  let d = day;
  let x = hour - h;
  while (x < 0) {
    x += 24;
    d = addDays(d, -1);
  }
  return { day: d, hour: x };
}

/**
 * Heating saved by an absence: for each day, the share of the day in absence × (heating expected
 * at that weather by the energy signature − heating measured). Days without an expectation are
 * left out; never below zero overall.
 */
export function absenceSaving(
  days: [string, number][],
  heat: Map<string, number>,
  expect: (day: string) => number | null,
): { kwh: number; expected: number; measured: number; days: number } | null {
  let e = 0;
  let m = 0;
  let n = 0;
  for (const [d, h] of days) {
    const x = expect(d);
    if (x === null) continue;
    const share = Math.min(1, h / 24);
    e += share * x;
    m += share * (heat.get(d) ?? 0);
    n++;
  }
  if (!n) return null;
  return { kwh: Math.max(0, e - m), expected: e, measured: m, days: n };
}

/** Days of absence (a day counts from 12 h in absence) inside [from, to], for a comparison. */
export function absentDaysIn(runs: { days: [string, number][] }[], from: string, to: string, minHours = 12): number {
  let n = 0;
  for (const r of runs) for (const [d, h] of r.days) if (d >= from && d <= to && h >= minHours) n++;
  return n;
}
