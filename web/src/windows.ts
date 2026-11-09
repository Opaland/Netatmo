// E13 (S-13.3 to S-13.6): open windows, boost, setpoint modes, heating and load shedding per room,
// from the daily aggregates of the hourly `homestatus` snapshots (roomstate.enc.json, see
// collector/roomstate.py). Pure functions, no DOM: unit-tested in windows.test.ts.
import { type DayRecord, addDays, rawRecords } from './aggregate';
import { type Fit, type Weather, anomalies, fitSeason, signaturePoints } from './analysis';
import { isBedroom } from './comfort';
import { BEDROOMS_ID } from './household';
import type { Drop } from './room30';

/** S-1.26: sharp temperature falls seen in the half hours, room -> day (room30.ts tempDrops). */
export type Drops = Map<string, Map<string, Drop>>;

export interface StateCell {
  n: number; // snapshots received that day for this room
  open_window_h?: number; // hours, estimated pro rata of n
  boost_h?: number;
  heating_h?: number;
  offload_h?: number;
  presence_h?: number; // opt-in only (S-13.5)
  mode_h?: Record<string, number>; // setpoint modes other than the schedule (away, hg, manual…)
  contactor_h?: Record<string, number>; // water heater contactor
}

export interface RoomState {
  seen?: Record<string, number>; // day -> bitmask of the local hours with a snapshot
  rooms?: Record<string, Record<string, StateCell>>;
  values?: Record<string, string[]>;
}

export const ABSENCE_MODES = ['away', 'hg', 'frost_guard'];
export const MODE_LABEL: Record<string, string> = { away: 'absence', hg: 'hors-gel', frost_guard: 'hors-gel', manual: 'manuel', off: 'arrêt' };
export const modeLabel = (m: string) => MODE_LABEL[m] ?? m.replace(/_/g, ' ');

/** Number of hours set in a 24-bit mask. */
export function bits(mask: number): number {
  let n = 0;
  for (let m = mask >>> 0; m; m &= m - 1) n++;
  return n;
}

const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** Hours with a snapshot over [from, to], out of 24 per day. */
export function coverage(rs: RoomState, from: string, to: string): { hours: number; expected: number; days: number } {
  const days = daysBetween(from, to);
  let hours = 0;
  let withData = 0;
  for (const d of days) {
    const b = bits(rs.seen?.[d] ?? 0);
    hours += b;
    withData += b > 0 ? 1 : 0;
  }
  return { hours, expected: 24 * days.length, days: withData };
}

/** Last day with an aggregate, or null. */
export function lastStateDay(rs: RoomState): string | null {
  const days = Object.keys(rs.seen ?? {});
  return days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
}

/**
 * Display key of a raw room id of roomstate.enc.json. S-13.5: bedrooms are merged into BEDROOMS_ID
 * unless the household chose to see them; S-12.2: in household view the dataset already merged
 * them, so their raw ids are unknown to `rooms` and go to BEDROOMS_ID too.
 */
export function bedroomGrouping(rooms: { id: string; name: string }[], showBedrooms: boolean): (room: string) => string {
  const known = new Set(rooms.map((r) => r.id));
  const merged = known.has(BEDROOMS_ID);
  const bedroom = new Set(rooms.filter((r) => r.id !== BEDROOMS_ID && isBedroom(r.name)).map((r) => r.id));
  return (room: string) => ((merged && !known.has(room)) || (!showBedrooms && bedroom.has(room)) ? BEDROOMS_ID : room);
}

export interface Totals {
  days: number;
  n: number;
  open: number;
  boost: number;
  heating: number;
  offload: number;
  presence: number;
  modes: Record<string, number>;
}

const empty = (): Totals => ({ days: 0, n: 0, open: 0, boost: 0, heating: 0, offload: 0, presence: 0, modes: {} });

function add(t: Totals, c: StateCell) {
  t.days++;
  t.n += c.n;
  t.open += c.open_window_h ?? 0;
  t.boost += c.boost_h ?? 0;
  t.heating += c.heating_h ?? 0;
  t.offload += c.offload_h ?? 0;
  t.presence += c.presence_h ?? 0;
  for (const [m, h] of Object.entries(c.mode_h ?? {})) t.modes[m] = (t.modes[m] ?? 0) + h;
}

/**
 * Rooms shown as such, or merged into a group (S-13.5: bedrooms are grouped unless the household
 * chose to see them). `groupOf(room)` returns the display key.
 */
export function totals(rs: RoomState, from: string, to: string, groupOf: (room: string) => string = (r) => r): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const [room, days] of Object.entries(rs.rooms ?? {})) {
    const key = groupOf(room);
    for (const [d, c] of Object.entries(days)) {
      if (d < from || d > to) continue;
      if (!out.has(key)) out.set(key, empty());
      add(out.get(key)!, c);
    }
  }
  return out;
}

/** Open-window hours per display key and per day (summed over the rooms of a group). */
export function dailyOpen(rs: RoomState, days: string[], groupOf: (room: string) => string = (r) => r): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    if (!Object.values(cells).some((c) => c.open_window_h !== undefined)) continue;
    const key = groupOf(room);
    const row = out.get(key) ?? days.map(() => null);
    days.forEach((d, i) => {
      const v = cells[d]?.open_window_h;
      if (v !== undefined) row[i] = Math.round(((row[i] ?? 0) + v) * 10) / 10;
    });
    out.set(key, row);
  }
  return out;
}

/** Open-window hours per display key and month "YYYY-MM". */
export function monthlyOpen(rs: RoomState, groupOf: (room: string) => string = (r) => r): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    const key = groupOf(room);
    for (const [d, c] of Object.entries(cells)) {
      if (c.open_window_h === undefined) continue;
      const m = out.get(key) ?? new Map<string, number>();
      m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + c.open_window_h);
      out.set(key, m);
    }
  }
  return out;
}

/** Days when at least one room had its window open more than `hours` (S-13.3, signature option). */
export function windowDays(rs: RoomState, hours = 2, rooms?: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    if (rooms && !rooms.has(room)) continue;
    for (const [d, c] of Object.entries(cells)) if ((c.open_window_h ?? 0) > hours) out.add(d);
  }
  return out;
}

export interface SignatureEffect {
  season: string;
  all: Fit;
  without: Fit | null;
  excluded: number; // heating days of the season left out
}

/**
 * Energy signature of the latest season that has room-state data, with and without the days
 * when a window stayed open more than `hours` (S-13.3). Null when the season cannot be fitted.
 */
export function signatureEffect(records: DayRecord[], weather: Weather, rs: RoomState, hours = 2): SignatureEffect | null {
  const excluded = windowDays(rs, hours);
  const covered = new Set(Object.keys(rs.seen ?? {}));
  const seasons = [...signaturePoints(records, weather).entries()]
    .filter(([, pts]) => pts.some(([, , d]) => covered.has(d)))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [season, pts] of seasons) {
    const all = fitSeason(pts);
    if (!all) continue;
    const kept = pts.filter(([, , d]) => !excluded.has(d));
    const heating = (p: [number, number, string]) => p[0] < 15 && p[1] > 0.2;
    return { season, all, without: fitSeason(kept), excluded: pts.filter(heating).length - kept.filter(heating).length };
  }
  return null;
}

export interface ColdWindow {
  day: string;
  room: string;
  temp: number;
  open: number;
  drop?: Drop; // S-1.26: the sharpest temperature fall of the day (half hours), when known
}

/**
 * "Pourquoi cette pièce était froide ?" (S-13.3): days below `threshold` (daily mean of the radiator
 * probe) with the window open at least `minOpen` hours that day, most recent first.
 */
export function coldWithWindow(
  temps: Map<string, Map<string, [number, number | null]>>,
  rs: RoomState,
  from: string,
  to: string,
  threshold = 19,
  minOpen = 1,
  drops?: Drops,
): ColdWindow[] {
  const out: ColdWindow[] = [];
  const seen = new Set<string>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    const t = temps.get(room);
    if (!t) continue;
    for (const [d, c] of Object.entries(cells)) {
      if (d < from || d > to) continue;
      const m = t.get(d)?.[0];
      if (m !== undefined && m < threshold && (c.open_window_h ?? 0) >= minOpen) {
        const drop = drops?.get(room)?.get(d);
        out.push({ day: d, room, temp: m, open: c.open_window_h!, ...(drop ? { drop } : {}) });
        seen.add(`${room}|${d}`);
      }
    }
  }
  // S-1.26: a sharp fall of the half-hour temperature explains a cold day the snapshots missed
  for (const [room, days] of drops ?? []) {
    const t = temps.get(room);
    for (const [d, drop] of days) {
      const m = t?.get(d)?.[0];
      if (d < from || d > to || seen.has(`${room}|${d}`) || m === undefined || !(m < threshold)) continue;
      out.push({ day: d, room, temp: m, open: rs.rooms?.[room]?.[d]?.open_window_h ?? 0, drop });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.open - a.open));
}

/** Open-window hours of all rooms, per day (days with a snapshot only). */
export function openByDay(rs: RoomState): Map<string, number> {
  const perDay = new Map<string, number>();
  for (const cells of Object.values(rs.rooms ?? {})) for (const [d, c] of Object.entries(cells)) perDay.set(d, (perDay.get(d) ?? 0) + (c.open_window_h ?? 0));
  return perDay;
}

/** Days confirmed as absences by the setpoint mode, as a set (see confirmedAbsences). */
export function absenceDays(rs: RoomState, minHours = 12): Set<string> {
  return new Set(confirmedAbsences(rs, minHours).flatMap(([a, b]) => daysBetween(a, b)));
}

/** Unusual heating days (S-4.8) with the open-window hours of all rooms that day: a possible explanation. */
export function anomaliesWithWindows(records: DayRecord[], weather: Weather, rs: RoomState, minOpen = 1): { day: string; z: number; open: number }[] {
  const perDay = openByDay(rs);
  return anomalies(records, weather)
    .filter((a) => (perDay.get(a.day) ?? 0) >= minOpen)
    .map((a) => ({ day: a.day, z: a.z, open: Math.round(perDay.get(a.day)! * 10) / 10 }));
}

/**
 * kWh estimated during boosts (S-13.4), per room and month: the day's energy of the room times the
 * share of its heating hours spent in boost (a boost heats at full power, so this is a floor).
 */
export function boostEnergy(records: DayRecord[], rs: RoomState): Map<string, Map<string, { hours: number; kwh: number }>> {
  const kwh = new Map<string, number>();
  for (const r of rawRecords(records)) kwh.set(`${r.room}|${r.day}`, (kwh.get(`${r.room}|${r.day}`) ?? 0) + r.kwh);
  const out = new Map<string, Map<string, { hours: number; kwh: number }>>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      const b = c.boost_h ?? 0;
      if (!b) continue;
      const share = Math.min(1, b / Math.max(c.heating_h ?? 0, b));
      const m = out.get(room) ?? new Map();
      const cell = m.get(d.slice(0, 7)) ?? { hours: 0, kwh: 0 };
      cell.hours += b;
      cell.kwh += (kwh.get(`${room}|${d}`) ?? 0) * share;
      m.set(d.slice(0, 7), cell);
      out.set(room, m);
    }
  }
  return out;
}

/**
 * Days confirmed as absences by the setpoint mode (S-13.4): every room that reported a mode spent
 * at least `minHours` in absence or frost guard. Returned as runs [from, to].
 */
export function confirmedAbsences(rs: RoomState, minHours = 12): [string, string][] {
  const days = new Map<string, boolean>();
  for (const cells of Object.values(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      if (c.boost_h === undefined && c.mode_h === undefined && c.open_window_h === undefined) continue; // not a radiator room
      const away = ABSENCE_MODES.reduce((s, m) => s + (c.mode_h?.[m] ?? 0), 0) >= minHours;
      days.set(d, (days.get(d) ?? true) && away);
    }
  }
  const yes = [...days].filter(([, v]) => v).map(([d]) => d).sort();
  const runs: [string, string][] = [];
  for (const d of yes) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs;
}

/** Load shedding (S-13.6): per day, rooms shed and hours, with the Linky peak power of that day. */
export function offloadDays(rs: RoomState, pmax: Map<string, number>, from: string, to: string): { day: string; rooms: number; hours: number; pmax: number | null }[] {
  const per = new Map<string, { rooms: number; hours: number }>();
  for (const cells of Object.values(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      if (d < from || d > to || !(c.offload_h ?? 0)) continue;
      const v = per.get(d) ?? { rooms: 0, hours: 0 };
      v.rooms++;
      v.hours += c.offload_h!;
      per.set(d, v);
    }
  }
  return [...per]
    .map(([day, v]) => ({ day, rooms: v.rooms, hours: Math.round(v.hours * 10) / 10, pmax: pmax.get(day) ?? null }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Load shedding per display key over [from, to] (S-13.6): days with shedding and hours. */
export function offloadByRoom(rs: RoomState, from: string, to: string, groupOf: (room: string) => string = (r) => r): Map<string, { days: number; hours: number }> {
  const seen = new Map<string, Set<string>>();
  const hours = new Map<string, number>();
  for (const [room, cells] of Object.entries(rs.rooms ?? {})) {
    const key = groupOf(room);
    for (const [d, c] of Object.entries(cells)) {
      if (d < from || d > to || !(c.offload_h ?? 0)) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(d);
      hours.set(key, (hours.get(key) ?? 0) + c.offload_h!);
    }
  }
  return new Map([...seen].map(([k, days]) => [k, { days: days.size, hours: Math.round(hours.get(k)! * 10) / 10 }]));
}

/**
 * Mean Linky peak (kVA) on the days with load shedding and on the other days with a snapshot,
 * over [from, to] (S-13.6): shedding should come with the highest peaks.
 */
export function peakVsOffload(rs: RoomState, pmax: Map<string, number>, from: string, to: string): { withShed: number | null; without: number | null; nWith: number; nWithout: number } {
  const shed = new Set(offloadDays(rs, pmax, from, to).map((d) => d.day));
  let a = 0;
  let na = 0;
  let b = 0;
  let nb = 0;
  for (const d of Object.keys(rs.seen ?? {})) {
    if (d < from || d > to || !pmax.has(d)) continue;
    if (shed.has(d)) (a += pmax.get(d)!), na++;
    else (b += pmax.get(d)!), nb++;
  }
  return { withShed: na ? a / na : null, without: nb ? b / nb : null, nWith: na, nWithout: nb };
}

export interface ColdReasons {
  cold: number; // room-days below the threshold
  window: number; // … with the window open at least `minOpen` hours
  openHours: number; // open-window hours of those days
  away: number; // … else in absence / frost-guard mode at least 12 h
  lowSetpoint: number; // … else with a setpoint below the threshold (chosen, not a fault)
  unexplained: number; // … else, with a snapshot that day
  noData: number; // … without any snapshot that day
  drop?: number; // S-1.26: days counted in `window` from a sharp fall of the half-hour temperature only
}

/**
 * "Pourquoi cette pièce était froide ?" (S-13.3, questions.ts): days whose mean temperature
 * (radiator probe) was below `threshold`, sorted by first explanation found: window open, absence
 * mode, low setpoint, nothing. `temps` are the RAW rooms (never a household-view mean, which
 * would hide a cold bedroom, #241). `groupOf` merges the bedrooms (S-13.5): a group counts
 * calendar days, not room-days; a day is cold when one of its rooms is, and it is explained
 * by the coldest room of the group that day.
 */
export function coldReasons(
  temps: Map<string, Map<string, [number, number | null]>>,
  rs: RoomState,
  from: string,
  to: string,
  groupOf: (room: string) => string = (r) => r,
  threshold = 19,
  minOpen = 1,
  drops?: Drops,
): Map<string, ColdReasons> {
  const seen = rs.seen ?? {};
  const all = rs.rooms ?? {};
  // display key -> day -> coldest room below the threshold that day
  const coldest = new Map<string, Map<string, { room: string; mean: number; setpoint: number | null }>>();
  for (const [room, t] of temps) {
    const key = groupOf(room);
    for (const [d, [mean, setpoint]] of t) {
      if (d < from || d > to || !(mean < threshold)) continue;
      if (!coldest.has(key)) coldest.set(key, new Map());
      const cur = coldest.get(key)!.get(d);
      if (!cur || mean < cur.mean) coldest.get(key)!.set(d, { room, mean, setpoint });
    }
  }
  const out = new Map<string, ColdReasons>();
  for (const [key, days] of coldest) {
    const r: ColdReasons = { cold: 0, window: 0, openHours: 0, away: 0, lowSetpoint: 0, unexplained: 0, noData: 0, ...(drops ? { drop: 0 } : {}) };
    out.set(key, r);
    for (const [d, { room, setpoint }] of days) {
      r.cold++;
      const day = [all[room]?.[d]].filter((c): c is StateCell => !!c);
      const open = day.reduce((sum, c) => sum + (c.open_window_h ?? 0), 0);
      const away = Math.max(0, ...day.map((c) => ABSENCE_MODES.reduce((sum, m) => sum + (c.mode_h?.[m] ?? 0), 0)));
      if (open >= minOpen) {
        r.window++;
        r.openHours += open;
      } else if (drops?.get(room)?.has(d) && away < 12) {
        r.window++; // the half hours show the fall the hourly snapshots missed
        r.drop!++;
      } else if (away >= 12) r.away++;
      else if (setpoint !== null && setpoint < threshold) r.lowSetpoint++;
      else if (day.length || bits(seen[d] ?? 0) > 0) r.unexplained++;
      else r.noData++;
    }
  }
  for (const r of out.values()) r.openHours = Math.round(r.openHours * 10) / 10;
  return out;
}

/** Contactor modes of the water heater over [from, to] (S-13.6): mode -> hours, and the latest day. */
export function contactor(rs: RoomState, from: string, to: string): { hours: Record<string, number>; last: string | null; lastMode: string | null } {
  const hours: Record<string, number> = {};
  let last: string | null = null;
  let lastMode: string | null = null;
  for (const cells of Object.values(rs.rooms ?? {})) {
    for (const [d, c] of Object.entries(cells)) {
      if (!c.contactor_h || d < from || d > to) continue;
      for (const [m, h] of Object.entries(c.contactor_h)) hours[m] = (hours[m] ?? 0) + h;
      if (!last || d > last) {
        last = d;
        lastMode = Object.entries(c.contactor_h).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      }
    }
  }
  return { hours, last, lastMode };
}

export { daysBetween };
