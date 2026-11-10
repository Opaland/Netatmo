// #428: the off-peak hours as the app applies them (rules in offpeak.ts): read in the half hours
// of the radiators over the last 28 days, else typed in ⚙ Mon contrat (a note encrypted with the
// data key on this device, local-store.ts), else 22 h → 6 h stated as an assumption.
import { addDays } from '../aggregate';
import { datasetDoc, ds, onLock } from '../app';
import { loadRoom30 } from '../data';
import { loadNote, saveNote } from '../local-store';
import { type HcRange, type OffPeak, parseHcRanges, rangesFromR30, resolveOffPeak } from '../offpeak';
import type { Room30 } from '../room30';

/** Days of half hours read (the window of « Mes plannings »). */
const DAYS = 28;
const NOTE = 'offpeak-ranges';

function lastDay30(r30: Room30): string | null {
  let last: string | null = null;
  for (const days of r30.values()) for (const d of days.keys()) if (!last || d > last) last = d;
  return last;
}

const readDoc = datasetDoc(async (d): Promise<HcRange[] | null> => {
  const last = d.meta.last_day;
  if (!last || !(d.meta.room30_years ?? []).length) return null;
  const r30 = await loadRoom30(d, addDays(last, -DAYS - 14));
  const to = lastDay30(r30);
  return to ? rangesFromR30(r30, addDays(to, -(DAYS - 1)), to) : null;
});
const typedDoc = datasetDoc((d) => loadNote(NOTE, d.source, d.key, parseHcRanges, [] as HcRange[]));
/** Ranges typed but not kept encrypted (private browsing…): until locking. */
let memory: HcRange[] | null = null;
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

/** The ranges typed on this device (empty: none). */
export function typedRanges(): HcRange[] {
  return memory ?? typedDoc.get(ds) ?? [];
}

/** Keep the typed ranges (empty: forget them); false when they could not be kept encrypted. */
export async function setTypedRanges(ranges: HcRange[]): Promise<boolean> {
  const d = ds!;
  const clean = parseHcRanges(ranges);
  const kept = await saveNote(NOTE, d.source, d.key, clean.length ? clean : null);
  memory = kept ? null : clean;
  typedDoc.reset();
  return kept;
}
