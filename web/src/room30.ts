// S-1.26 (#224, #217): per-room half hours (energy HP / HC, temperature, setpoint) collected by
// collector/room30.py into YYYY.room30.enc.json. Pure functions, no DOM: unit-tested in room30.test.ts.
//
// A day is [hp, hc, temp, setpoint]; each column is null (nothing that day), a number (the same
// value for the 48 half hours) or 48 values (null where missing), indexed by the local start of the
// half hour (2 × hour + minute / 30). Energy in Wh, temperatures in °C.
import type { Hourly } from './analysis';

export type Cell = number | null | (number | null)[];
export type Day30 = [Cell, Cell, Cell, Cell];
export interface Room30Doc {
  rooms?: Record<string, Record<string, Day30>>;
}
/** room -> day -> packed columns (expanded only when read). */
export type Room30 = Map<string, Map<string, Day30>>;

export const SLOTS = 48;
const EMPTY: (number | null)[] = new Array(SLOTS).fill(null);

export function unpack(c: Cell | undefined): (number | null)[] {
  if (c === null || c === undefined) return EMPTY;
  if (Array.isArray(c)) return c.length === SLOTS ? c : [...c, ...EMPTY].slice(0, SLOTS);
  return new Array(SLOTS).fill(c);
}

/** "HH:MM" of a half-hour index. */
export const slotLabel = (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;

/** Merge yearly documents into one map (raw rooms: the household view groups later, if at all). */
export function mergeDocs(docs: (Room30Doc | null)[]): Room30 {
  const out: Room30 = new Map();
  for (const doc of docs) {
    for (const [room, days] of Object.entries(doc?.rooms ?? {})) {
      const m = out.get(room) ?? new Map<string, Day30>();
      for (const [d, v] of Object.entries(days)) m.set(d, v);
      out.set(room, m);
    }
  }
  return out;
}

/** kWh of one day, half hour by half hour (HP + HC), or null when the day has no energy column. */
function energy(day: Day30): (number | null)[] | null {
  if (day[0] === null && day[1] === null) return null;
  const hp = unpack(day[0]);
  const hc = unpack(day[1]);
  return hp.map((v, i) => (v === null && hc[i] === null ? null : ((v ?? 0) + (hc[i] ?? 0)) / 1000));
}

/**
 * Hourly energy (room -> "YYYY-MM-DDTHH" -> kWh) rebuilt from the half hours, in the shape of the
 * hourly documents, for the days in [from, to]. `roomMap` merges rooms like the household view.
 */
export function hourlyFrom30(r30: Room30, from = '', to = '9999', roomMap?: Map<string, string>): Hourly {
  const out: Hourly = new Map();
  for (const [raw, days] of r30) {
    const room = roomMap?.get(raw) ?? raw;
    const m = out.get(room) ?? new Map<string, number>();
    for (const [d, cols] of days) {
      if (d < from || d > to) continue;
      const e = energy(cols);
      if (!e) continue;
      for (let h = 0; h < 24; h++) {
        const a = e[2 * h];
        const b = e[2 * h + 1];
        if (a === null && b === null) continue;
        const key = `${d}T${String(h).padStart(2, '0')}`;
        m.set(key, (m.get(key) ?? 0) + (a ?? 0) + (b ?? 0));
      }
    }
    if (m.size) out.set(room, m);
  }
  return out;
}

/**
 * The hourly energy with, for every room and day the half hours cover, the hours rebuilt from them
 * (more complete: the 30-min history goes back four years, the hourly one a year). Other days are
 * kept as they are. A new map: the cached hourly data is never modified.
 */
export function preferRoom30(hourly: Hourly | null, from30: Hourly): Hourly {
  const out: Hourly = new Map();
  for (const [room, hours] of hourly ?? []) out.set(room, new Map(hours));
  for (const [room, hours] of from30) {
    const m = out.get(room) ?? new Map<string, number>();
    const days = new Set([...hours.keys()].map((k) => k.slice(0, 10)));
    for (const k of [...m.keys()]) if (days.has(k.slice(0, 10))) m.delete(k);
    for (const [k, v] of hours) m.set(k, v);
    out.set(room, m);
  }
  return out;
}

/** Average kWh per half hour of the day (48 values) over the days of [from, to] with data, and that count. */
export function halfHourProfile(r30: Room30, rooms: Set<string>, from: string, to: string, roomMap?: Map<string, string>): { profile: number[]; days: number } {
  const sum = new Array(SLOTS).fill(0);
  const days = new Set<string>();
  for (const [raw, perDay] of r30) {
    if (!rooms.has(roomMap?.get(raw) ?? raw)) continue;
    for (const [d, cols] of perDay) {
      if (d < from || d > to) continue;
      const e = energy(cols);
      if (!e) continue;
      days.add(d);
      e.forEach((v, i) => (sum[i] += v ?? 0));
    }
  }
  return { profile: sum.map((v) => (days.size ? v / days.size : 0)), days: days.size };
}

export interface Drop {
  at: string; // "HH:MM", local start of the fall
  fall: number; // °C lost
}

/** Whether the setpoint went down between the half hours `from` and `to` (a setback, not a window). */
function setpointDown(sp: (number | null)[], from: number, to: number): boolean {
  for (let k = Math.max(1, from + 1); k <= to; k++) if (sp[k] !== null && sp[k - 1] !== null && sp[k]! < sp[k - 1]!) return true;
  return false;
}

/**
 * Sharp temperature falls (open window, door to the outside): the radiator probe loses at least
 * `minFall` °C in one hour at most (two half hours) while the setpoint did not go down in the two
 * hours before. A night setback lowers the setpoint, so it is not counted. room -> day -> largest fall.
 */
export function tempDrops(r30: Room30, from: string, to: string, minFall = 1.5): Map<string, Map<string, Drop>> {
  const out = new Map<string, Map<string, Drop>>();
  for (const [room, days] of r30) {
    for (const [d, cols] of days) {
      if (d < from || d > to || !Array.isArray(cols[2])) continue;
      const t = unpack(cols[2]);
      const sp = unpack(cols[3]);
      let best: Drop | null = null;
      for (let i = 1; i < SLOTS; i++) {
        const now = t[i];
        if (now === null) continue;
        for (const j of [i - 1, i - 2]) {
          const before = j >= 0 ? t[j] : null;
          if (before === null) continue;
          const lowered = setpointDown(sp, j - 4, i);
          const fall = Math.round((before - now) * 10) / 10;
          if (!lowered && fall >= minFall && (!best || fall > best.fall)) best = { at: slotLabel(j), fall };
        }
      }
      if (best) {
        if (!out.has(room)) out.set(room, new Map());
        out.get(room)!.set(d, best);
      }
    }
  }
  return out;
}
