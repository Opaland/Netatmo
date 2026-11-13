// #202: the plan of the house as the app applies it: this device's draft (sealed with the data key,
// local-store.ts) while it is not saved for the household, else the household's plan (repository
// secret FLOOR_PLAN_JSON, sealed in the browser, copied into the encrypted meta by the nightly
// collection). The same two layers as the stove's wood (wood-state.ts); one reader, parsePlan.
import { ds, onDatasetLoaded, rawDataset, rerender } from '../app';
import type { Dataset } from '../data';
import { type FloorPlan, parsePlan, planJson } from '../floorplan';
import { loadNote, saveNote } from '../local-store';

export const PLAN_SECRET = 'FLOOR_PLAN_JSON';
const NOTE = 'plan-draft';
let draft: FloorPlan | null = null;
let loadedFor: Dataset | null = null;
let persisted = true;
onDatasetLoaded(() => {
  draft = null;
  loadedFor = null;
});

/** The household's plan (FLOOR_PLAN_JSON → meta.floor_plan); null: none recorded. */
export const sharedPlan = (): FloorPlan | null => parsePlan(((rawDataset() ?? ds)?.meta as { floor_plan?: unknown } | undefined)?.floor_plan);

/** This device's draft (null: none); read once per dataset, the page redrawn if there is one. */
export function planDraft(): FloorPlan | null {
  const d = ds;
  if (d && loadedFor !== d) {
    loadedFor = d;
    void loadNote<FloorPlan | null>(NOTE, d.source, d.key, (v) => (v === null ? null : parsePlan(v)), null).then((v) => {
      if (v && ds === d && !draft) {
        draft = v;
        rerender();
      }
    });
  }
  return draft;
}

/** Keep (or drop, null) this device's version; false when it could not be saved (it lasts until locking). */
export async function setPlanDraft(p: FloorPlan | null): Promise<boolean> {
  const d = ds!;
  const shared = sharedPlan();
  draft = p && (!shared || planJson(p) !== planJson(shared)) ? parsePlan(JSON.parse(planJson(p))) : null;
  persisted = await saveNote(NOTE, d.source, d.key, draft);
  return persisted;
}
export const planPersisted = () => persisted;

/** What the app shows: this device's draft, else the household's plan; null: no plan at all. */
export const currentPlan = (): FloorPlan | null => planDraft() ?? sharedPlan();
