// #366: the wood of the stove, as the app applies it: this device's draft (encrypted with the data
// key, local-store.ts) while it is not saved for the household, else the household's settings
// (repository variable WOOD_JSON, copied into the encrypted meta by the nightly collection).
// The heat and cost per day are computed once per dataset and settings (wood.ts).
import { ds, onDatasetLoaded, rawDataset, rerender } from '../app';
import type { Dataset } from '../data';
import { loadNote, saveNote } from '../local-store';
import { type WoodSettings, parseWood, woodDaily, woodIn, woodJson } from '../wood';
import { lastDay } from '../ui';
import { stoppedRooms } from './offline-rooms';
import { stoveHeated } from '../room-offline';

const NOTE = 'wood-draft';
let draft: WoodSettings | null = null;
let loadedFor: Dataset | null = null;
let persisted = true;
onDatasetLoaded(() => {
  draft = null;
  loadedFor = null;
});

/** The settings recorded by the collection (WOOD_JSON → meta.wood). */
export const sharedWood = (): WoodSettings => parseWood(((rawDataset() ?? ds)?.meta as { wood?: unknown } | undefined)?.wood);

/** This device's draft (null: none); read once per dataset, the page redrawn if there is one. */
export function woodDraft(): WoodSettings | null {
  const d = ds;
  if (d && loadedFor !== d) {
    loadedFor = d;
    void loadNote<WoodSettings | null>(NOTE, d.source, d.key, (v) => (v === null ? null : parseWood(v)), null).then((v) => {
      if (v && ds === d && !draft) {
        draft = v;
        rerender();
      }
    });
  }
  return draft;
}

/** Keep (or drop, null) this device's version; false when it could not be saved (it lasts until locking). */
export async function setWoodDraft(w: WoodSettings | null): Promise<boolean> {
  const d = ds!;
  draft = w && woodJson(w) !== woodJson(sharedWood()) ? parseWood(w) : null;
  persisted = await saveNote(NOTE, d.source, d.key, draft);
  return persisted;
}
export const woodPersisted = () => persisted;

/** What the app applies: this device's draft, else the household's settings. */
export const woodSettings = (): WoodSettings => woodDraft() ?? sharedWood();

const memo = new WeakMap<Dataset, { key: string; daily: Map<string, [number, number]> }>();
/** Wood heat (kWh) and cost (€) per day, for the dataset shown. */
export function woodDays(): Map<string, [number, number]> {
  const d = ds!;
  const w = woodSettings();
  const key = woodJson(w);
  const hit = memo.get(d);
  if (hit?.key === key) return hit.daily;
  const daily = woodDaily(w, d.weather, lastDay());
  memo.set(d, { key, daily });
  return daily;
}

/** Wood heat and cost over [from, to]; null when no wood is recorded at all. */
export function woodOver(from: string, to: string): { kwh: number; eur: number } | null {
  if (!woodSettings().purchases.length) return null;
  return woodIn(woodDays(), from, to);
}

/** Raw ids of the rooms the stove heats (#346; #440: radiators taken down, with wood bought). */
export function stoveRooms(): string[] {
  const bought = woodSettings().purchases.length > 0;
  return stoppedRooms()
    .filter((s) => stoveHeated(s, bought))
    .map((s) => s.room);
}

/** « Poêle à bois (Cuisine) »: the rooms heated by the stove (stoveRooms), if any. */
export function stoveName(): string {
  const rooms = (rawDataset() ?? ds)!.meta.rooms;
  const names = stoveRooms()
    .map((id) => rooms.find((r) => r.id === id)?.name)
    .filter((n): n is string => !!n);
  return `Poêle à bois${names.length ? ` (${names.join(', ')})` : ''}`;
}

/**
 * #433: the wood the Accueil verdict counts, day by day (woodDays: the degree-day split of
 * « Hiver contre hiver » and « Expliquer un mois »), or null: no stove declared, no wood bought,
 * or a scope without the stove's heating (hot water only, rooms picked without the stove's).
 */
export function verdictWood(cat: string, rooms: string[] | null): Map<string, [number, number]> | null {
  if (cat === 'water_heater') return null;
  const map = ds!.roomMap;
  const stove = stoveRooms().map((id) => map?.get(id) ?? id);
  if (!stove.length || !woodSettings().purchases.length) return null;
  if (rooms && !stove.some((id) => rooms.includes(id))) return null;
  return woodDays();
}
