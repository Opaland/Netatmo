// #346: the rooms « hors ligne » of the dataset shown, computed once per dataset (raw rooms, then
// the display ids of the household view), and the few words every screen uses for them. A
// radiator switched off on purpose (⚙ Mon logement: « chauffée par un poêle ») is « arrêté »:
// no alert, no estimate, and its fall stays in the comparisons as a change of heating.
import { type DayRecord, minusYears } from '../aggregate';
import { activeRooms, ds, rawDataset } from '../app';
import type { Dataset } from '../data';
import {
  type OfflineEstimate,
  type OfflineRun,
  type StoppedRoom,
  applyStopped,
  displayEstimate,
  displayRuns,
  estimateOffline,
  estimatedIn,
  notComparable,
  offlineRuns,
  offlineText,
  parseStopped,
  runIn,
  unmeasuredRooms,
} from '../room-offline';
import { andList } from '../home';
import { lsKey } from '../scope';
import { fmtKwh } from '../ui';

// ------------------------------------------------------------------ stopped on purpose (foyer)
const LS = lsKey('stopped-draft');

/** The list recorded by the collection (repository variable STOPPED_ROOMS_JSON → meta). */
export const sharedStopped = (): StoppedRoom[] => parseStopped(((rawDataset() ?? ds)?.meta as { stopped_rooms?: unknown } | undefined)?.stopped_rooms);

/** This device's version, while it is not yet saved for the household (null: none). */
export function stoppedDraft(): StoppedRoom[] | null {
  try {
    const v = localStorage.getItem(LS);
    return v === null ? null : parseStopped(JSON.parse(v));
  } catch {
    return null;
  }
}
export function setStoppedDraft(list: StoppedRoom[] | null) {
  try {
    if (list === null) localStorage.removeItem(LS);
    else localStorage.setItem(LS, JSON.stringify(parseStopped(list)));
  } catch {
    /* kept for this visit only: nothing to do */
  }
}
/** What the app applies: this device's draft, else the household's list. */
export const stoppedRooms = (): StoppedRoom[] => stoppedDraft() ?? sharedStopped();

// ------------------------------------------------------------------ runs and estimate
export interface OfflineInfo {
  /** Runs with the display ids. */
  runs: OfflineRun[];
  estimate: OfflineEstimate;
  /** Raw runs and estimate. */
  raw: { runs: OfflineRun[]; estimate: OfflineEstimate };
}

const memo = new WeakMap<Dataset, { key: string; info: OfflineInfo }>();

/** The offline rooms of the dataset shown (cached per dataset and list of stopped rooms). */
export function offlineInfo(): OfflineInfo {
  const d = ds!;
  const stopped = stoppedRooms();
  const key = JSON.stringify(stopped);
  const hit = memo.get(d);
  if (hit?.key === key) return hit.info;
  const r = rawDataset() ?? d;
  const runs = applyStopped(offlineRuns(r.records, r.meta.rooms, r.meta.last_day ?? ''), stopped);
  const estimate = estimateOffline(r.records, runs, r.linky, r.weather);
  const info = { runs: displayRuns(runs, d.roomMap), estimate: displayEstimate(estimate, d.roomMap), raw: { runs, estimate } };
  memo.set(d, { key, info });
  return info;
}

/** The run of a room shown that touches [from, to], or null. */
export const offlineRun = (room: string, from: string, to: string) => runIn(offlineInfo().runs, room, from, to);

/** kWh estimated from the meter for a room shown over [from, to], or null. */
export const offlineEstimate = (room: string, from: string, to: string) => estimatedIn(offlineInfo().estimate, room, from, to);

/** « hors ligne depuis le 14 oct. 2025 · ≈ 230 kWh estimés », « arrêté depuis le … (poêle) », or ''. */
export function offlineLine(room: string, from: string, to: string): string {
  const run = offlineRun(room, from, to);
  if (!run) return '';
  if (run.stopped) return `${offlineText(run)} · pas de données attendues`;
  const est = offlineEstimate(room, from, to);
  return `${offlineText(run)}${est !== null ? ` · ≈ ${fmtKwh(est)} estimés d’après le compteur` : ' · plus mesurée'}`;
}

/** The records of [from, to] and its year-ago window without the rooms offline in either (#346). */
export function comparableRecords(records: DayRecord[], from: string, to: string, years = 1): { records: DayRecord[]; left: string[] } {
  const out = new Set<string>();
  const runs = offlineInfo().runs;
  for (let k = 1; k <= years; k++) for (const r of notComparable(runs, minusYears(from, k - 1), minusYears(to, k - 1))) out.add(r);
  if (!out.size) return { records, left: [] };
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  return { records: records.filter((r) => !out.has(r.room)), left: [...out].filter((id) => names.has(id)).map((id) => names.get(id)!) };
}

/** Rooms shown out of reach right now (ongoing run, not switched off on purpose): the alerts. */
export function offlineNow(): { id: string; name: string; run: OfflineRun }[] {
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  return offlineInfo()
    .runs.filter((r) => r.ongoing && !r.stopped && names.has(r.room))
    .map((run) => ({ id: run.room, name: names.get(run.room)!, run }));
}

/** Rooms shown switched off on purpose over [from, to] (a change of heating), with their run. */
export function stoppedIn(from: string, to: string): { id: string; name: string; run: OfflineRun }[] {
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  return offlineInfo()
    .runs.filter((r) => r.stopped && r.to >= from && r.from <= to && names.has(r.room))
    .map((run) => ({ id: run.room, name: names.get(run.room)!, run }));
}

/** Ids shown of the rooms switched off on purpose: they stay in every comparison (#346). */
export const stoppedShown = (): Set<string> => new Set(stoppedRooms().map((s) => ds!.roomMap?.get(s.room) ?? s.room));

/**
 * #570: the rooms shown left out of a comparison of [from, to] with [prevFrom, prevTo] because one
 * side has no reading of them (unmeasuredRooms: the water heater missing all year, a radiator added
 * since), the records without them, and their names for the sentence that says so.
 */
export function measuredOnBoth(
  records: DayRecord[],
  from: string,
  to: string,
  prevFrom: string,
  prevTo: string,
): { records: DayRecord[]; ids: Set<string>; names: string[] } {
  const ids = unmeasuredRooms(records, from, to, prevFrom, prevTo, stoppedShown());
  if (!ids.size) return { records, ids, names: [] };
  const name = new Map(activeRooms().map((r) => [r.id, r.name]));
  const names = [...ids].map((id) => name.get(id) ?? id).sort((a, b) => a.localeCompare(b, 'fr'));
  return { records: records.filter((r) => !ids.has(r.room)), ids, names };
}

/** « hors Bureau et Chauffe-eau, sans relevé sur l’une des deux périodes » (#570), or ''. */
export const unmeasuredText = (names: string[]) => (names.length ? `hors ${andList(names)}, sans relevé sur l’une des deux périodes` : '');
