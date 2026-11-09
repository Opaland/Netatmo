// #346: the rooms « hors ligne » of the dataset shown, computed once per dataset (raw rooms, then
// the display ids of the household view), and the few words every screen uses for them.
import { type DayRecord, minusYears } from '../aggregate';
import { activeRooms, ds, rawDataset } from '../app';
import type { Dataset } from '../data';
import { type OfflineEstimate, type OfflineRun, displayEstimate, displayRuns, estimateOffline, estimatedIn, notComparable, offlineRuns, offlineText, runIn } from '../room-offline';
import { fmtKwh } from '../ui';

export interface OfflineInfo {
  /** Runs with the display ids. */
  runs: OfflineRun[];
  estimate: OfflineEstimate;
  /** Raw runs and estimate (explanation of a month, État des données). */
  raw: { runs: OfflineRun[]; estimate: OfflineEstimate };
}

const memo = new WeakMap<Dataset, OfflineInfo>();

/** The offline rooms of the dataset shown (cached per dataset: the household view is another). */
export function offlineInfo(): OfflineInfo {
  const d = ds!;
  let info = memo.get(d);
  if (info) return info;
  const r = rawDataset() ?? d;
  const runs = offlineRuns(r.records, r.meta.rooms, r.meta.last_day ?? '');
  const estimate = estimateOffline(r.records, runs, r.linky, r.weather);
  info = { runs: displayRuns(runs, d.roomMap), estimate: displayEstimate(estimate, d.roomMap), raw: { runs, estimate } };
  memo.set(d, info);
  return info;
}

/** The run of a room shown that touches [from, to], or null. */
export const offlineRun = (room: string, from: string, to: string) => runIn(offlineInfo().runs, room, from, to);

/** kWh estimated from the meter for a room shown over [from, to], or null. */
export const offlineEstimate = (room: string, from: string, to: string) => estimatedIn(offlineInfo().estimate, room, from, to);

/** « hors ligne depuis le 14 oct. 2025 · ≈ 230 kWh estimés » for a room shown, or ''. */
export function offlineLine(room: string, from: string, to: string): string {
  const run = offlineRun(room, from, to);
  if (!run) return '';
  const est = offlineEstimate(room, from, to);
  return `${offlineText(run)}${est !== null ? ` · ≈ ${fmtKwh(est)} estimés d’après le compteur` : ''}`;
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

/** Rooms shown that are offline right now (ongoing run), with their run. */
export function offlineNow(): { id: string; name: string; run: OfflineRun }[] {
  const names = new Map(activeRooms().map((r) => [r.id, r.name]));
  return offlineInfo()
    .runs.filter((r) => r.ongoing && names.has(r.room))
    .map((run) => ({ id: run.room, name: names.get(run.room)!, run }));
}
