// #346: rooms whose radiator (or water heater) no longer sends anything to Intuis. Their days are
// missing (not 0): left alone, the app would show 0 kWh or a fall « vs l'an dernier » that is
// only a missing measure. Pure functions, no DOM (room-offline.test.ts):
//   - offlineRuns: the runs of 2 days or more (48 h) without a reading while the other rooms
//     have theirs, ongoing or over;
//   - estimateOffline: their share estimated from the meter, Linky − the rooms still measured −
//     the usual « autres usages », marked « estimée » wherever it is shown;
//   - comparable: the rooms left out of a comparison with last year because one of the two
//     periods has days without reading.
import { type DayRecord, addDays, minusYears } from './aggregate';
import { type Weather, dju, linearFit } from './analysis';
import { dayShort } from './glossary';

/** 48 h without a daily reading make a room « hors ligne » (alert of the collection as well). */
export const OFFLINE_MIN_DAYS = 2;

export interface OfflineRun {
  /** Room id (raw, or the display id once mapped by displayRuns). */
  room: string;
  /** First and last day without a reading. */
  from: string;
  to: string;
  /** Days without a reading in the run (days where no room had any are not counted). */
  days: number;
  /** Still without a reading on the last day of the archive. */
  ongoing: boolean;
}

/**
 * Runs of OFFLINE_MIN_DAYS days or more where a room had no reading while at least one other
 * room had one. A room is followed from its first reading on; the days lost for every room
 * (Intuis returned nothing) are a gap of the source, not a room offline, and are skipped.
 */
export function offlineRuns(records: DayRecord[], rooms: { id: string; category: string }[], last: string, minDays = OFFLINE_MIN_DAYS): OfflineRun[] {
  const followed = new Set(rooms.filter((r) => r.category !== 'ignore').map((r) => r.id));
  const byRoom = new Map<string, Set<string>>();
  const any = new Set<string>();
  for (const r of records) {
    if (!followed.has(r.room) || r.day > last) continue;
    (byRoom.get(r.room) ?? byRoom.set(r.room, new Set()).get(r.room)!).add(r.day);
    any.add(r.day);
  }
  if (byRoom.size < 2) return [];
  const days = [...any].sort();
  const out: OfflineRun[] = [];
  for (const [room, have] of byRoom) {
    const first = [...have].reduce((a, b) => (a < b ? a : b));
    let run: OfflineRun | null = null;
    const close = () => {
      if (run && run.days >= minDays) out.push(run);
      run = null;
    };
    for (const d of days) {
      if (d < first) continue;
      if (have.has(d)) {
        close();
        continue;
      }
      if (run) (run.to = d), run.days++;
      else run = { room, from: d, to: d, days: 1, ongoing: false };
    }
    if (run) (run as OfflineRun).ongoing = (run as OfflineRun).to === days[days.length - 1];
    close();
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.room.localeCompare(b.room)));
}

/** The runs with display ids (household view: a bedroom offline makes « Chambres » offline). */
export function displayRuns(runs: OfflineRun[], roomMap?: Map<string, string>): OfflineRun[] {
  return roomMap?.size ? runs.map((r) => ({ ...r, room: roomMap.get(r.room) ?? r.room })) : runs;
}

/** Days of [from, to] a room was offline (its runs cut to the window). */
export function offlineDaysIn(runs: OfflineRun[], room: string, from: string, to: string): number {
  let n = 0;
  for (const r of runs) {
    if (r.room !== room || r.to < from || r.from > to) continue;
    const a = r.from > from ? r.from : from;
    const b = r.to < to ? r.to : to;
    n += Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  }
  return n;
}

/** The run of a room that touches [from, to] (the latest), or null. */
export function runIn(runs: OfflineRun[], room: string, from: string, to: string): OfflineRun | null {
  let out: OfflineRun | null = null;
  for (const r of runs) if (r.room === room && r.to >= from && r.from <= to && (!out || r.from > out.from)) out = r;
  return out;
}

/** « hors ligne depuis le 14 oct. 2025 », « hors ligne du 4 au 17 nov. 2024 ». */
export function offlineText(run: Pick<OfflineRun, 'from' | 'to' | 'ongoing'>): string {
  if (run.ongoing) return `hors ligne depuis le ${dayShort(run.from, true)}`;
  const sameYear = run.from.slice(0, 4) === run.to.slice(0, 4);
  return `hors ligne du ${dayShort(run.from, !sameYear)} au ${dayShort(run.to, true)}`;
}

/**
 * Rooms to leave out of a comparison of [from, to] with the same days a year earlier: those
 * with days without reading in either window (#346: a room that is no longer measured is not
 * « en baisse »).
 */
export function notComparable(runs: OfflineRun[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const r of runs) if (offlineDaysIn([r], r.room, from, to) || offlineDaysIn([r], r.room, minusYears(from), minusYears(to))) out.add(r.room);
  return out;
}

// ------------------------------------------------------------------ estimate from the meter
export interface OfflineEstimate {
  /** room -> day -> kWh estimated (only the offline days with a meter reading). */
  days: Map<string, Map<string, number>>;
  /** Usual « autres usages » per day: a + b × degree days, fitted on the days all rooms read. */
  baseline: { a: number; b: number; days: number } | null;
}

const REF_DAYS = 365;
const MIN_REF_DAYS = 30;

/**
 * #346: the share of the rooms offline, day by day, from the meter: Linky − every room still
 * measured − the usual other usages (fitted on the year before the first run, on the days all
 * rooms read, against the degree days when the weather is known). Split between the rooms
 * offline the same day by their consumption over that reference year. Never negative; nothing
 * without Linky or with less than a month of reference.
 */
export function estimateOffline(records: DayRecord[], runs: OfflineRun[], linky: Map<string, number>, weather: Weather | null): OfflineEstimate {
  const out: OfflineEstimate = { days: new Map(), baseline: null };
  if (!runs.length || !linky.size) return out;
  const measured = new Map<string, number>();
  for (const r of records) measured.set(r.day, (measured.get(r.day) ?? 0) + r.kwh);
  const offDays = new Map<string, string[]>(); // day -> rooms offline
  for (const run of runs) for (let d = run.from; d <= run.to; d = addDays(d, 1)) (offDays.get(d) ?? offDays.set(d, []).get(d)!).push(run.room);
  const start = runs.reduce((a, r) => (r.from < a ? r.from : a), runs[0].from);
  const refFrom = addDays(start, -REF_DAYS);
  const deg = (d: string) => {
    const w = weather?.get(d);
    return w ? dju(w) : null;
  };
  const points: [number, number][] = [];
  let sum = 0;
  for (const [d, l] of linky) {
    if (d < refFrom || d >= start || offDays.has(d) || !measured.has(d)) continue;
    const x = weather ? deg(d) : 0;
    if (x === null) continue;
    points.push([x, l - measured.get(d)!]);
    sum += l - measured.get(d)!;
  }
  if (points.length < MIN_REF_DAYS) return out;
  const fit = weather ? linearFit(points) : null;
  out.baseline = fit ? { a: fit.intercept, b: fit.slope, days: points.length } : { a: sum / points.length, b: 0, days: points.length };
  // weights: each room's consumption over the reference year
  const weight = new Map<string, number>();
  for (const r of records) if (r.day >= refFrom && r.day < start) weight.set(r.room, (weight.get(r.room) ?? 0) + r.kwh);
  for (const [d, rooms] of offDays) {
    const l = linky.get(d);
    if (l === undefined || !measured.has(d)) continue; // a day lost for every room is not this room's
    const x = weather ? deg(d) : 0;
    if (x === null) continue;
    const gap = Math.max(0, l - (measured.get(d) ?? 0) - (out.baseline.a + out.baseline.b * x));
    const w = rooms.map((r) => weight.get(r) ?? 0);
    const tw = w.reduce((a, b) => a + b, 0);
    rooms.forEach((room, i) => {
      const share = tw > 0 ? w[i] / tw : 1 / rooms.length;
      (out.days.get(room) ?? out.days.set(room, new Map()).get(room)!).set(d, gap * share);
    });
  }
  return out;
}

/** kWh estimated for a room over [from, to] (null when nothing is estimated there). */
export function estimatedIn(est: OfflineEstimate, room: string, from: string, to: string): number | null {
  const days = est.days.get(room);
  if (!days) return null;
  let s = 0;
  let n = 0;
  for (const [d, v] of days) if (d >= from && d <= to) (s += v), n++;
  return n ? s : null;
}

/** The estimate with display ids (household view: summed per group). */
export function displayEstimate(est: OfflineEstimate, roomMap?: Map<string, string>): OfflineEstimate {
  if (!roomMap?.size) return est;
  const days = new Map<string, Map<string, number>>();
  for (const [room, m] of est.days) {
    const id = roomMap.get(room) ?? room;
    const into = days.get(id) ?? days.set(id, new Map()).get(id)!;
    for (const [d, v] of m) into.set(d, (into.get(d) ?? 0) + v);
  }
  return { days, baseline: est.baseline };
}
