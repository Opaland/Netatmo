// Application state, loaded dataset and the render hook shared by every view.
// This module imports no view: views import it, and main.ts registers the renderer
// with setRenderer(), which keeps the module graph free of cycles.
import type { Category, Granularity } from './aggregate';
import { NO_PRICES, type Prices } from './analysis';
import type { Dataset } from './data';
import { sameContract, validContract } from './contract';
import type { ContractPeriod } from './offers';
import { DEFAULT_LOCK_MINUTES } from './session';

export type View = 'overview' | 'compare' | 'rooms' | 'analyse' | 'report' | 'settings';
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
};

const LS_KEY = 'intuis-history:state';
export function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    // v1.0 stored a single price per kWh
    if (typeof saved.price === 'number' && !saved.prices) saved.prices = { ...NO_PRICES, base: saved.price };
    delete saved.price;
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
const resetHooks: (() => void)[] = [];

/** Views register here what must be forgotten when another dataset is opened. */
export function onDatasetLoaded(fn: () => void) {
  resetHooks.push(fn);
}

/** Rooms shown in the app: not ignored, and with at least one record. */
export function activeRooms() {
  return ds!.meta.rooms.filter((r) => r.category !== 'ignore' && roomsWithData.has(r.id));
}

/** Install a freshly loaded dataset (or null when locking) and fix the state against it. */
export function setDataset(next: Dataset | null) {
  ds = next;
  if (next) initDefaults();
}

function initDefaults() {
  roomsWithData = new Set(ds!.records.map((r) => r.room));
  for (const fn of resetHooks) fn();
  const years = ds!.meta.years;
  const valid = new Set(activeRooms().map((r) => r.id));
  const patch: Partial<State> = {};
  if (!state.compareYears.length || state.compareYears.some((y) => !years.includes(y))) patch.compareYears = years.slice(-3);
  if (!state.roomsYear || !years.includes(state.roomsYear)) patch.roomsYear = years[years.length - 1];
  if (state.pinnedRoom && !valid.has(state.pinnedRoom)) patch.pinnedRoom = null;
  if (state.rooms) patch.rooms = state.rooms.filter((r) => valid.has(r)).length ? state.rooms.filter((r) => valid.has(r)) : null;
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
