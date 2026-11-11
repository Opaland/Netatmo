// #428: the off-peak hours as the app applies them (rules in offpeak.ts): read in the half hours
// of the radiators, else typed in ⚙ Mon contrat (a note encrypted with the data key on this
// device, local-store.ts), else 22 h → 6 h stated as an assumption. #441: dated, read over the
// year of the solar simulator and a margin, one period per placement found.
import { addDays } from '../aggregate';
import { datasetDoc, ds, onLock } from '../app';
import { loadRoom30 } from '../data';
import { loadNote, saveNote } from '../local-store';
import { type HcPeriod, type OffPeak, type TypedRange, parseHcRanges, periodsFromR30, resolveOffPeak } from '../offpeak';
import type { Room30 } from '../room30';

/** #441: days of half hours read: the 365 of the solar simulator, and a margin before them. */
const DAYS = 400;
const NOTE = 'offpeak-ranges';

function lastDay30(r30: Room30): string | null {
  let last: string | null = null;
  for (const days of r30.values()) for (const d of days.keys()) if (!last || d > last) last = d;
  return last;
}

const readDoc = datasetDoc(async (d): Promise<HcPeriod[] | null> => {
  const last = d.meta.last_day;
  if (!last || !(d.meta.room30_years ?? []).length) return null;
  const r30 = await loadRoom30(d, addDays(last, -DAYS));
  const to = lastDay30(r30);
  return to ? periodsFromR30(r30, addDays(to, -(DAYS - 1)), to) : null;
});
const typedDoc = datasetDoc((d) => loadNote(NOTE, d.source, d.key, parseHcRanges, [] as TypedRange[]));
/** Ranges typed but not kept encrypted (private browsing…): until locking. */
let memory: TypedRange[] | null = null;
onLock(() => (memory = null));

/**
 * The off-peak hours to apply, or null while the half hours or the note are loading (`then` is
 * called once they are). Half hours that cannot be loaded (offline) fall back to what is typed.
 */
export function offPeakNow(then?: () => void): OffPeak | null {
  const d = ds;
  if (!d) return null;
  const cb = then ? () => then() : undefined;
  const read = readDoc.get(d, cb);
  const typed = typedDoc.get(d, cb);
  if (readDoc.status(d) === 'loading' || typedDoc.status(d) === 'loading') return null;
  return resolveOffPeak(read ?? null, memory ?? typed ?? []);
}

/** The ranges typed on this device, each « à compter du » a day or not (empty: none). */
export function typedRanges(): TypedRange[] {
  return memory ?? typedDoc.get(ds) ?? [];
}

/** Keep the typed ranges (empty: forget them); false when they could not be kept encrypted. */
export async function setTypedRanges(ranges: TypedRange[]): Promise<boolean> {
  const d = ds!;
  const clean = parseHcRanges(ranges);
  const kept = await saveNote(NOTE, d.source, d.key, clean.length ? clean : null);
  memory = kept ? null : clean;
  typedDoc.reset();
  return kept;
}
