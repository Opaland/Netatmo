// Application state, loaded dataset and the render hook shared by every view.
// This module imports no view: views import it, and main.ts registers the renderer
// with setRenderer(), which keeps the module graph free of cycles.
import type { Category, Granularity } from './aggregate';
import { NO_PRICES, type Prices } from './analysis';
import type { Dataset } from './data';
import { bedroomIds, householdView, translateRooms } from './household';
import { sameContract, validContract } from './contract';
import type { ContractPeriod } from './offers';
import { DEFAULT_LOCK_MINUTES } from './session';
import { lsKey } from './scope';
import { DatasetDoc, DatasetHooks } from './loader';

export type View = 'overview' | 'compare' | 'rooms' | 'analyse' | 'comfort' | 'report' | 'settings';
export type CatFilter = 'all' | Category;

export interface State {
  view: View;
  cat: CatFilter;
  rooms: string[] | null;
  period: string; // '12m' | 'all' | 'YYYY'
  gran: Granularity;
  split: 'category' | 'room';
  compareYears: number[];
  compareMode: 'monthly' | 'cumul' | 'season';
  /** #298: heating seasons shown in Comparer, by start year (null: the last three, current one included). */
  compareSeasons: number[] | null;
  roomsYear: number | null;
  focusRoom: string | null;
  prices: Prices;
  priceMode: 'trve' | 'manual';
  kva: number; // legacy (v1.1), migrated to contracts
  contracts: ContractPeriod[];
  contractLocalEdit: boolean; // S-12.1: edited here while a shared contract exists
  climate: boolean;
  analyseYear: number | null;
  tempRoom: string | null;
  reportYear: number | null;
  stationMetric: 'temp' | 'hum' | 'co2';
  simKva: number | null; // comparator: simulate another subscribed power
  simple: boolean; // simple mode (S-7.1)
  showTables: boolean;
  lockAfter: number; // S-8.11: minutes without interaction before locking, 0 = never
  pinnedRoom: string | null; // S-7.8: room shown first in simple mode
  comfortThreshold: number; // °C, hours below it count as cold (S-11.3)
  /** S-3.8: Intuis room id -> station module key ('' = deliberately not linked). Shared later by S-12.1. */
  roomModuleMap: Record<string, string>;
  /**
   * S-12.2: bedrooms merged into « Chambres » on this device. Opt-in since v1.5 (the key was
   * `household`, on by default: renamed so that every device starts with the real per-room figures).
   */
  groupBedrooms: boolean;
}

export const DEFAULT: State = {
  view: 'overview',
  cat: 'all',
  rooms: null,
  period: '12m',
  gran: 'month',
  split: 'category',
  compareYears: [],
  compareMode: 'monthly',
  compareSeasons: null,
  roomsYear: null,
  focusRoom: null,
  prices: NO_PRICES,
  priceMode: 'trve',
  kva: 9,
  contracts: [],
  contractLocalEdit: false,
  climate: false,
  analyseYear: null,
  tempRoom: null,
  reportYear: null,
  stationMetric: 'temp',
  simKva: null,
  simple: false,
  showTables: false,
  lockAfter: DEFAULT_LOCK_MINUTES,
  pinnedRoom: null,
  comfortThreshold: 19,
  roomModuleMap: {},
  groupBedrooms: false,
};

const LS_KEY = lsKey('state');
export function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    // v1.0 stored a single price per kWh
    if (typeof saved.price === 'number' && !saved.prices) saved.prices = { ...NO_PRICES, base: saved.price };
    delete saved.price;
    // v1.4 persisted the household view as `household: true` by default: dropped, the view is opt-in
    delete saved.household;
    return { ...DEFAULT, ...saved, prices: { ...NO_PRICES, ...(saved.prices ?? {}) } };
  } catch {
    return { ...DEFAULT };
  }
}

/** Current state (live binding: always read it as `state`, never copy it). */
export let state = loadState();

/** Merge a patch, persist it and re-render. */
export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  rerender();
}

// ------------------------------------------------------------------ render hook
let renderer: () => void = () => {};
/** main.ts registers the shell renderer here. */
export function setRenderer(fn: () => void) {
  renderer = fn;
}
export function rerender() {
  renderer();
}

// ------------------------------------------------------------------ dataset
/** Decrypted dataset, null while locked (live binding). */
export let ds: Dataset | null = null;
let roomsWithData = new Set<string>();
const hooks = new DatasetHooks();

/**
 * Views register here what must be forgotten when the dataset SHOWN changes: another dataset,
 * the household view toggled, or the lock (#232: called with `ds` null, every cache emptied).
 */
export function onDatasetLoaded(fn: () => void) {
  hooks.onView(fn);
}

/** Once per freshly decrypted dataset, not when only the display changes (#255). */
export function onDatasetOpened(fn: () => void) {
  hooks.onOpen(fn);
}

/** On lock only: raw caches (decrypted files, memoised series) to empty (#232). */
export function onLock(fn: () => void) {
  hooks.onLock(fn);
}

/**
 * A document loaded on demand for the dataset shown (#247): see DatasetDoc. Forgotten when the
 * dataset shown changes or on lock; a failure is retried when the network comes back.
 */
const docs: DatasetDoc<Dataset, unknown>[] = [];
export function datasetDoc<T>(load: (d: Dataset) => Promise<T>): DatasetDoc<Dataset, T> {
  const doc = new DatasetDoc<Dataset, T>(load);
  docs.push(doc as DatasetDoc<Dataset, unknown>);
  onDatasetLoaded(() => doc.reset());
  return doc;
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!ds || !docs.some((d) => d.status(ds) === 'failed')) return;
    for (const d of docs) d.retry();
    rerender();
  });
}

/** Rooms shown in the app: not ignored, and with at least one record. */
export function activeRooms() {
  return ds!.meta.rooms.filter((r) => r.category !== 'ignore' && roomsWithData.has(r.id));
}

/** Install a freshly loaded dataset (or null when locking) and fix the state against it. */
export function setDataset(next: Dataset | null) {
  const fresh = next !== raw;
  raw = next;
  if (!next) revealed = false; // S-12.2: the detail stays visible only until the next lock
  applyDisplay(fresh);
}

/** Apply the display transform (household view) to the raw dataset and run the hooks. */
function applyDisplay(fresh: boolean) {
  ds = raw && state.groupBedrooms && !revealed ? householdView(raw) : raw;
  if (ds) initDefaults(fresh);
  else {
    roomsWithData = new Set();
    hooks.changed(null, false);
  }
}

// ------------------------------------------------------------------ household view (S-12.2)
/** Dataset as decrypted, before the household view merges the bedrooms. */
let raw: Dataset | null = null;

/**
 * The decrypted dataset with every room, whatever is displayed: for what must work on raw
 * room ids (cold alert sensors #242, cold-room question #241). Null while locked.
 */
export function rawDataset(): Dataset | null {
  return raw;
}

/** « Afficher le détail des chambres » was chosen since the last unlock (never persisted). */
let revealed = false;

/** Whether the bedrooms are merged right now, and whether there is anything to merge. */
export function householdStatus() {
  return { active: !!raw && ds !== raw, bedrooms: raw ? bedroomIds(raw.meta.rooms).length : 0, revealed, enabled: state.groupBedrooms };
}

/**
 * Show (true) or hide again (false) the bedrooms detail, until the next lock. A display
 * change only (#255): the decrypted files are reused, nothing is downloaded again.
 */
export function revealBedrooms(show: boolean, redraw = true) {
  revealed = show;
  if (raw) applyDisplay(false);
  if (redraw) rerender();
}

/** Turn the household view on or off on this device (persisted). */
export function setHousehold(on: boolean) {
  revealed = false;
  state = { ...state, groupBedrooms: on };
  if (raw) applyDisplay(false);
  setState({});
}

function initDefaults(fresh: boolean) {
  roomsWithData = new Set(ds!.records.map((r) => r.room));
  hooks.changed(ds, fresh);
  const years = ds!.meta.years;
  const valid = new Set(activeRooms().map((r) => r.id));
  const patch: Partial<State> = {};
  const one = (id: string | null) => {
    if (!id) return null;
    const t = translateRooms([id], ds!, raw!.meta.rooms);
    return t.length === 1 && valid.has(t[0]) ? t[0] : null;
  };
  if (!state.compareYears.length || state.compareYears.some((y) => !years.includes(y))) patch.compareYears = years.slice(-3);
  if (!state.roomsYear || !years.includes(state.roomsYear)) patch.roomsYear = years[years.length - 1];
  if (state.pinnedRoom) patch.pinnedRoom = one(state.pinnedRoom);
  if (state.focusRoom) patch.focusRoom = one(state.focusRoom);
  if (state.tempRoom) patch.tempRoom = one(state.tempRoom);
  if (state.rooms) {
    const kept = translateRooms(state.rooms, ds!, raw!.meta.rooms).filter((r) => valid.has(r));
    patch.rooms = kept.length ? kept : null;
  }
  if (/^\d{4}$/.test(state.period) && !years.includes(Number(state.period))) patch.period = '12m';
  const lastYear = years[years.length - 1];
  if (!state.analyseYear || !years.includes(state.analyseYear)) patch.analyseYear = lastYear;
  if (!state.reportYear || !years.includes(state.reportYear)) patch.reportYear = years.length > 1 ? years[years.length - 2] : lastYear;
  if (!ds!.weather) patch.climate = false;
  // S-12.1: once the shared contract caught up with this device's edit, follow it again.
  const shared = validContract(ds!.meta.contract);
  if (state.contractLocalEdit && (!shared || (state.priceMode === 'trve' && sameContract(shared, state.contracts)))) {
    patch.contractLocalEdit = false;
  }
  state = { ...state, ...patch };
}

/** Root element of the application. */
export const app = document.getElementById('app')!;
