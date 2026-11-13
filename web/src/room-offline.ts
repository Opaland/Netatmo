// #346: rooms whose radiator (or water heater) no longer sends anything to Intuis. Their days are
// missing (not 0): left alone, the app would show 0 kWh or a fall « vs l'an dernier » that is
// only a missing measure. Pure functions, no DOM (room-offline.test.ts):
//   - offlineRuns: the runs of 2 days or more (48 h) without a reading while the other rooms
//     have theirs, ongoing or over;
//   - estimateOffline: their share estimated from the meter, Linky − the rooms still measured −
//     the usual « autres usages », marked « estimée » wherever it is shown;
//   - notComparable: the rooms left out of a comparison with last year because one of the two
//     periods has days without reading;
//   - stopped rooms: a radiator switched off ON PURPOSE (a stove heats the room…), declared in
//     ⚙ Mon logement: « arrêté depuis le … (poêle) », no alert, no estimate (a stove uses next to
//     no electricity), and its fall is a change of heating, not « vos réglages ».
import { type Category, type DayRecord, addDays, minusYears } from './aggregate';
import { uncertainDays } from './checks';
import { type Weather, dju, linearFit, referenceWindows } from './analysis';
import { andList, dayShort } from './glossary';
import { WOOD_ROOM } from './wood';

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
  /** Switched off on purpose (⚙ Mon logement), not out of reach. */
  stopped?: StoppedRoom;
}

// ------------------------------------------------------------------ stopped on purpose
// The keys are checked by the collector as well (collector/devices.py STOPPED_REASONS): one list,
// held in agreement by tests/test_donnees_v15.py (AGENTS.md §5).
export type StopReason = 'poele' | 'retires' | 'autre-chauffage' | 'inoccupee' | 'autre';
export const STOP_REASONS: Record<StopReason, string> = {
  poele: 'Chauffée par un poêle (bois, granulés)',
  // #440: the radiators were taken down; the room is heated otherwise (a stove…)
  retires: 'Radiateurs retirés (chauffée autrement)',
  'autre-chauffage': 'Chauffée autrement (sans électricité)',
  inoccupee: 'Pièce inoccupée, non chauffée',
  autre: 'Autre raison',
};
/** In parentheses after « arrêté depuis le … ». */
const STOP_SHORT: Record<StopReason, string> = { poele: 'poêle', retires: 'radiateurs retirés', 'autre-chauffage': 'autre chauffage', inoccupee: 'inoccupée', autre: '' };

export interface StoppedRoom {
  room: string;
  /** First day switched off. */
  from: string;
  reason: StopReason;
  /** Free text of the owner (« chauffé par un poêle à granulés »), 60 characters at most. */
  label: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The list kept in the meta (STOPPED_ROOMS_JSON) or on this device, cleaned (never trusted). */
export function parseStopped(v: unknown): StoppedRoom[] {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, StoppedRoom>();
  for (const x of v as Partial<StoppedRoom>[]) {
    if (!x || typeof x.room !== 'string' || !x.room || x.room.length > 64 || typeof x.from !== 'string' || !DAY_RE.test(x.from)) continue;
    // #359: own keys only (`in` also accepts « constructor », « __proto__ »…)
    const reason = (typeof x.reason === 'string' && Object.hasOwn(STOP_REASONS, x.reason) ? x.reason : 'autre') as StopReason;
    out.set(x.room, { room: x.room, from: x.from, reason, label: typeof x.label === 'string' ? x.label.slice(0, 60) : '' });
  }
  return [...out.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.room.localeCompare(b.room)));
}
/** Value of the repository variable STOPPED_ROOMS_JSON. */
export const stoppedJson = (list: StoppedRoom[]) => JSON.stringify(parseStopped(list));

/**
 * #440, #433: a room heated by the stove: declared « chauffée par un poêle », or « radiateurs
 * retirés » when wood is bought (the radiators taken down, the stove heats the room). The one
 * rule for every screen that names the stove's room or counts its wood (AGENTS.md §5).
 */
export const stoveHeated = (s: Pick<StoppedRoom, 'reason'>, woodBought: boolean) => s.reason === 'poele' || (woodBought && s.reason === 'retires');

/** « poêle », « inoccupée »… (empty for « autre »). */
export const stopShort = (s: Pick<StoppedRoom, 'reason'>) => STOP_SHORT[s.reason] ?? '';

/**
 * #440: the one rule for the alerts of the modules of a room switched off on purpose, whatever the
 * reason (poêle, radiateurs retirés…): from the declared day on, its modules raise nothing (not
 * answering, firmware, offline hours); the days before keep their alerts. The declaration of the
 * room on `day`, or undefined. Same rule in the collector (collector/devices.py stopped_on).
 */
export function stoppedOn<S extends { room: string; from: string }>(stopped: readonly S[] | undefined, room: string | undefined, day: string): S | undefined {
  if (!room || !stopped) return undefined;
  const s = stopped.find((x) => x.room === room);
  return s && s.from <= day ? s : undefined;
}

/**
 * The runs with the rooms switched off on purpose: from the declared day on, a run is « arrêté »
 * (stopped), not « hors ligne »; the days before it, if 2 or more, stay a room out of reach.
 */
export function applyStopped(runs: OfflineRun[], stopped: StoppedRoom[], minDays = OFFLINE_MIN_DAYS): OfflineRun[] {
  if (!stopped.length) return runs;
  const by = new Map(stopped.map((x) => [x.room, x]));
  const out: OfflineRun[] = [];
  const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  for (const r of runs) {
    const st = by.get(r.room);
    if (!st || r.to < st.from) {
      out.push(r);
      continue;
    }
    if (r.from < st.from) {
      const to = addDays(st.from, -1);
      if (span(r.from, to) >= minDays) out.push({ ...r, to, days: span(r.from, to), ongoing: false });
    }
    const from = r.from > st.from ? r.from : st.from;
    out.push({ ...r, from, days: span(from, r.to), stopped: st });
  }
  return out;
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

/**
 * #461: the first day of a run as said to the owner. A room switched off on purpose is « arrêté »
 * from the day DECLARED, not from its first day without reading: a room whose radiators were
 * taken down on 1 July may still have sent readings until October (applyStopped keeps the run's
 * own `from`, the silent days, for the counts). The one rule for every text (AGENTS.md §5).
 */
export const runStart = (run: Pick<OfflineRun, 'from' | 'stopped'>) => run.stopped?.from ?? run.from;

/**
 * #461: the last day with a reading of a room switched off on purpose, when it is after the day
 * declared (said in complement: « dernière donnée le … »); null otherwise.
 */
export const lastReadingAfterStop = (run: Pick<OfflineRun, 'from' | 'stopped'>): string | null =>
  run.stopped && run.from > run.stopped.from ? addDays(run.from, -1) : null;

/**
 * « hors ligne depuis le 14 oct. 2025 », « hors ligne du 4 au 17 nov. 2024 »; a room switched off
 * on purpose: « arrêté depuis le 14 oct. 2025 (poêle) », from the day declared (#461).
 */
export function offlineText(run: Pick<OfflineRun, 'from' | 'to' | 'ongoing' | 'stopped'>, withYear = true): string {
  const what = run.stopped ? 'arrêté' : 'hors ligne';
  const why = run.stopped && stopShort(run.stopped) ? ` (${stopShort(run.stopped)})` : '';
  const from = runStart(run);
  if (run.ongoing) return `${what} depuis le ${dayShort(from, withYear)}${why}`;
  const sameYear = from.slice(0, 4) === run.to.slice(0, 4);
  return `${what} du ${dayShort(from, !sameYear)} au ${dayShort(run.to, true)}${why}`;
}

/**
 * Rooms to leave out of a comparison of [from, to] with the same days a year earlier: those
 * with days without reading in either window (#346: a room that is no longer measured is not
 * « en baisse »). A room switched off on purpose stays: its fall is real (a change of heating).
 */
export function notComparable(runs: OfflineRun[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const r of runs) if (!r.stopped && (offlineDaysIn([r], r.room, from, to) || offlineDaysIn([r], r.room, minusYears(from), minusYears(to)))) out.add(r.room);
  return out;
}

// ------------------------------------------------------------------ measured on both sides (#570)
/**
 * #570: « non mesuré » over [from, to]: the records of one device (or one usage) exist in the
 * archive but none falls in the window — the water heater over all of 2024 on a real account. It is
 * never 0. The one definition of it: the « non mesuré » cells of « Année par année » and of the
 * annual report, and unmeasuredRooms below, all ask this.
 */
export const unmeasuredIn = (records: DayRecord[], from: string, to: string): boolean => records.length > 0 && !records.some((r) => r.day >= from && r.day <= to);

/**
 * #580: what makes a total of [from, to] « incomplet », counted once: the usages of `cats` without
 * any reading there (unmeasuredIn: their cell already says « non mesuré »), and the days without
 * any reading of the usages that were measured (uncertainDays, the estimated days left in: the
 * total holds them). A usage not measured at all no longer makes every day of the window « missing »
 * (366 for the water heater of 2024, next to « 45 jours » for what the change compares).
 */
export function incompleteParts(records: DayRecord[], from: string, to: string, cats: Category[]): { unmeasured: Category[]; days: number } {
  records = records.filter((r) => r.room !== WOOD_ROOM); // the stove's wood is no device read
  const unmeasured = cats.filter((c) => unmeasuredIn(records.filter((r) => r.cat === c), from, to));
  const measured = records.filter((r) => !unmeasured.includes(r.cat));
  return { unmeasured, days: uncertainDays(measured, new Set(), from, to).size };
}

/**
 * #570: the rooms (water heater included) measured on one side of a comparison of [from, to] with
 * [prevFrom, prevTo] and not on the other, each with its reason:
 *   - null: no reading at all in one of the two windows (unmeasuredIn);
 *   - a day: its first reading, after the start of the earlier window (a radiator added since: it
 *     was not counted all along). « The start » is the later of `prevFrom` and the household's
 *     first day of data, so that a room read from the first day is never « added ».
 * Comparing with them makes a rise, or a fall, out of a measure that does not exist: they are left
 * out of BOTH sides and named, never the whole period. The rooms of `keep` stay: a radiator
 * switched off on purpose is a change of heating (#346), its fall is real. Day records that are no
 * room (the stove's wood, WOOD_ROOM) stay too. One rule for every comparison of two periods.
 */
export function unmeasuredReasons(records: DayRecord[], from: string, to: string, prevFrom: string, prevTo: string, keep: Set<string> = new Set()): Map<string, string | null> {
  const byRoom = new Map<string, DayRecord[]>();
  let dataFirst = '';
  for (const r of records) {
    if (r.room === WOOD_ROOM) continue;
    if (!dataFirst || r.day < dataFirst) dataFirst = r.day;
    if (keep.has(r.room)) continue;
    (byRoom.get(r.room) ?? byRoom.set(r.room, []).get(r.room)!).push(r);
  }
  const start = prevFrom > dataFirst ? prevFrom : dataFirst;
  const out = new Map<string, string | null>();
  for (const [room, rs] of byRoom) {
    const now = !unmeasuredIn(rs, from, to);
    const prev = !unmeasuredIn(rs, prevFrom, prevTo);
    if (!now && !prev) continue; // not in the comparison at all
    const first = rs.reduce((a, r) => (r.day < a ? r.day : a), rs[0].day);
    if (first > start) out.set(room, first);
    else if (!now || !prev) out.set(room, null);
  }
  return out;
}

/** The rooms of unmeasuredReasons. */
export const unmeasuredRooms = (records: DayRecord[], from: string, to: string, prevFrom: string, prevTo: string, keep: Set<string> = new Set()): Set<string> =>
  new Set(unmeasuredReasons(records, from, to, prevFrom, prevTo, keep).keys());

/**
 * #570: the rooms left out of a verdict of [from, to] (Accueil, « Ce mois est-il normal ? »): those
 * not measured on both sides of any of its reference windows (verdict's referenceWindows). The
 * room goes, not the reference year.
 */
export function referenceUnmeasured(records: DayRecord[], from: string, to: string, keep: Set<string> = new Set()): Map<string, string | null> {
  const first = records.reduce((a, r) => (r.room !== WOOD_ROOM && (!a || r.day < a) ? r.day : a), '');
  const out = new Map<string, string | null>();
  for (const w of referenceWindows(from, to, first))
    for (const [room, why] of unmeasuredReasons(records, from, to, w.f, w.t, keep)) if (!out.has(room) || why) out.set(room, why);
  return out;
}

/**
 * « hors Bureau (ajouté le 20 oct. 2025) et Chauffe-eau (sans relevé sur l’une des périodes
 * comparées) », or '' — the one sentence for the rooms of unmeasuredReasons (`name` of each id).
 */
export function unmeasuredPhrase(reasons: Map<string, string | null>, name: (id: string) => string): string {
  if (!reasons.size) return '';
  const items = [...reasons]
    .map(([id, added]) => ({ n: name(id), added }))
    .sort((a, b) => a.n.localeCompare(b.n, 'fr'))
    .map(({ n, added }) => `${n} (${added ? `ajouté le ${dayShort(added, true)}` : 'sans relevé sur l’une des périodes comparées'})`);
  return `hors ${andList(items)}`;
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
  runs = runs.filter((r) => !r.stopped); // a stove uses next to no electricity: nothing to estimate
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
