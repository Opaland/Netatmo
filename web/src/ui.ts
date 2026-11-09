// Helpers shared by several views: formatting, HTML fragments, colours, rooms, costs.
import { type Category, type DayRecord, addDays, applyFilter, minusYears, pctChange } from './aggregate';
import { type PriceAt, energyCost, energyCostTrve, hasPrices, offPeakColumn, offPeakShares, subscriptionCost, subscriptionTrve, trveAt } from './analysis';
import { type State, activeRooms, ds, onLock, rawRooms, state } from './app';
import { cssVar, escapeHtml as esc, waterfallChart } from './charts';
import { type ResolvedContract, resolveContract } from './contract';
import { type ContractPeriod, periodAt } from './offers';
import { type HcHp, flatPrice, hcHp, manualHcHp, manualPriceAt } from './pricing';
import { comparison, seg } from './components';
import { NO_REFERENCE, dayLong, signedPct } from './glossary';
import { tenant } from './tenant';

export { esc };
export { fmtKwh } from './charts';

// ------------------------------------------------------------------ formatting
export const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** Signed, rounded percentage without "-0" (glossary.ts, #315). */
export const pct = signedPct;
export const fmtEur = (v: number) => `${nf0.format(v)} €`;

/** « 1er août 2026 » (#299: one date format, glossary.ts). */
export const longDate = (day: string) => dayLong(day);

/**
 * Year-over-year change with its reference always written out (#310 review rule): « ▼ −16 %
 * vs nov. 2025 au 8 ». `vs` comes from glossary.vsLabel(); arrow + word, never colour alone.
 */
export const delta = (now: number, before: number, vs = "vs l'an dernier") => comparison(pctChange(now, before), vs, { none: NO_REFERENCE });

// ------------------------------------------------------------------ HTML fragments
export { seg };

export function table(head: string[], rows: (string | number)[][], numericFrom = 1) {
  return `<div class="table-wrap" tabindex="0"><table><thead><tr>${head.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="num"' : ''}>${typeof c === 'number' ? nf0.format(c) : c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

export function tableToggle(content: string) {
  return `<details class="table-details" ${state.showTables ? 'open' : ''}><summary>Voir les valeurs</summary>${content}</details>`;
}

// ------------------------------------------------------------------ dates and filters
export function lastDay(): string {
  return ds!.meta.last_day ?? new Date().toISOString().slice(0, 10);
}
export function firstDay(): string {
  return ds!.meta.first_day ?? lastDay();
}

export function filtered(): DayRecord[] {
  const cats = new Set<Category>(state.cat === 'all' ? ['heating', 'water_heater'] : [state.cat]);
  return applyFilter(ds!.records, { cats, rooms: state.rooms ? new Set(state.rooms) : null });
}

// ------------------------------------------------------------------ contract and costs
let resolved: { args: unknown[]; value: ResolvedContract } | null = null;
/** S-12.1: contract in force on this device (shared > local > default), memoised. */
export function contractInfo(): ResolvedContract {
  const args = [ds!.meta.contract, state.contracts, state.contractLocalEdit, firstDay(), state.kva];
  if (!resolved || resolved.args.some((a, i) => a !== args[i])) {
    resolved = { args, value: resolveContract(args[0], state.contracts, state.contractLocalEdit, firstDay(), state.kva) };
  }
  return resolved.value;
}
export function contracts(): ContractPeriod[] {
  return contractInfo().periods;
}
/** A shared contract means the official tariffs, unless changed on this device. */
export function priceMode(): State['priceMode'] {
  if (tenant().on) return 'manual'; // S-12.6: the tenant's average price, never the holder's contract
  return contractInfo().source === 'shared' ? 'trve' : state.priceMode;
}
/** Regulated price row in force on that day, under the contract of that day. */
export function priceAt(day: string) {
  const c = periodAt(contracts(), day);
  return c ? trveAt(ds!.offers.get(c.offer) ?? [], c.kva, day) : null;
}
const useTrve = () => priceMode() === 'trve' && ds!.offers.size > 0;
/** Manual prices; a tenant's average price applies to every kWh (S-12.6). */
const manualPrices = () => (tenant().on ? { ...state.prices, t1: null, t2: null } : state.prices);
export const costAvailable = () => useTrve() || hasPrices(manualPrices());
export function offCol(): 1 | 2 {
  const water = ds!.meta.rooms.filter((r) => r.category === 'water_heater').map((r) => r.id);
  return offPeakColumn(ds!.tariffs, water) ?? 2;
}
// #256: a cost depends on the records and on the price inputs only. Every input below keeps
// its identity until it changes (setState copies a changed `prices`, contractInfo() is
// memoised, setTenant() replaces the tenant object), so a change of identity empties the cache.
let priceDeps: unknown[] = [];
let costCache = new WeakMap<DayRecord[], Map<string, number | null>>();
let avgCache = new WeakMap<DayRecord[], { value: number | null }>();
// #232: nothing computed from the data survives the lock (priceDeps holds the dataset itself).
onLock(() => {
  resolved = null;
  priceDeps = [];
  costCache = new WeakMap();
  avgCache = new WeakMap();
});
function freshPrices() {
  const deps = [ds, contractInfo(), priceMode(), state.prices, tenant()];
  if (deps.some((d, i) => d !== priceDeps[i])) {
    priceDeps = deps;
    costCache = new WeakMap();
    avgCache = new WeakMap();
  }
}

/** Energy cost of these records in [from, to], subscription prorated when asked (memoised per array). */
export function costOf(records: DayRecord[], from: string, to: string, withSub = false): number | null {
  freshPrices();
  let m = costCache.get(records);
  if (!m) costCache.set(records, (m = new Map()));
  const k = `${from}|${to}|${withSub}`;
  if (!m.has(k)) m.set(k, computeCost(records, from, to, withSub));
  return m.get(k)!;
}
function computeCost(records: DayRecord[], from: string, to: string, withSub: boolean): number | null {
  if (!costAvailable()) return null;
  const recs = records.filter((r) => r.day >= from && r.day <= to);
  if (useTrve()) {
    const off = offCol();
    const c = energyCostTrve(recs, ds!.tariffs, priceAt, 0, off, offPeakShares(ds!.tariffs, off));
    return c.energy + (withSub ? subscriptionTrve(priceAt, 0, from, to) : 0);
  }
  const sub = withSub ? subscriptionCost(from, to, manualPrices()) : 0;
  return energyCost(recs, ds!.tariffs, manualPrices()) + sub;
}
export const eurOf = (records: DayRecord[], from: string, to: string) => {
  const c = costOf(records, from, to);
  return c === null ? '' : fmtEur(c);
};
/**
 * Average €/kWh (energy, no subscription) of these records over the last 12 months, for
 * estimates (projection, tooltips, verdict). #291: pass the filtered selection, so that the
 * water heater's off-peak kWh are not priced at the whole home's average. Memoised.
 */
export function avgPrice(records: DayRecord[] = ds!.records): number | null {
  freshPrices();
  const hit = avgCache.get(records);
  if (hit) return hit.value;
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const recs = records.filter((r) => r.day >= from && r.day <= last);
  const kwh = recs.reduce((s, r) => s + r.kwh, 0);
  const c = computeCost(recs, from, last, false);
  const value = c === null || !kwh ? null : c / kwh;
  avgCache.set(records, { value });
  return value;
}

// #252: one price rule for the cards that price a kWh outside the day-by-day cost.
/** Off-peak / peak €/kWh that day under the price mode in force (official or shared contract, manual prices, tenant). */
export function hcHpAt(day: string): HcHp | null {
  const trve = useTrve();
  return hcHp({ trve, row: trve ? priceAt(day) : null, prices: state.prices, tenant: tenant().on, off: offCol() });
}
/** €/kWh of a consumption spread evenly over the day (16 h peak, 8 h off-peak): standby base load. */
export function flatPriceAt(day: string): number | null {
  const p = hcHpAt(day);
  return p ? flatPrice(p) : null;
}
/** Price row of each day: the regulated tariff of the contract, or the manual prices. */
export function dayPrices(): PriceAt {
  return useTrve() ? priceAt : manualPriceAt(manualHcHp(state.prices, offCol(), tenant().on));
}

/** Names of the two tariff columns, from the detected off-peak column. */
export function tariffNames(): [string, string] {
  const water = activeRooms().filter((r) => r.category === 'water_heater').map((r) => r.id);
  const off = offPeakColumn(ds!.tariffs, water);
  if (off === 2) return ['Heures pleines', 'Heures creuses'];
  if (off === 1) return ['Heures creuses', 'Heures pleines'];
  return ['Tarif 1', 'Tarif 2'];
}

// ------------------------------------------------------------------ colours and rooms
// #300 / #310: colours come from the design tokens. Orange and blue belong to the usages,
// iris to the years; rooms and other categorical series take the room palette.
const PALETTE = 8;
/** i-th colour of the categorical palette (never orange, blue or iris). */
export const series = (i: number) => cssVar(`--room-${(i % PALETTE) + 1}`);
export const catColor = (c: Category) => cssVar(c === 'water_heater' ? '--usage-water' : '--usage-heating');
/** Measured value (a single line), reference value (subscribed power, expected…). */
export const measureColor = () => cssVar('--series-measure');
export const referenceColor = () => cssVar('--series-reference');

export { activeRooms };
/**
 * #300: the colour follows the room — its place among the heating rooms of the house, in the
 * order of the data (never its rank among the rooms shown) — so a room keeps its colour with
 * or without the household view; « Chambres » takes the colour of its first bedroom.
 * Water-heater rooms wear the water colour. Past six heating rooms shown → « Autres pièces ».
 */
const SHOWN_ROOMS = 6;
function roomIndex(id: string): number {
  const heating = rawRooms().filter((r) => r.category === 'heating');
  const i = heating.findIndex((r) => r.id === id);
  if (i >= 0) return i;
  // a group of the household view: the first of its members (absent from the view)
  const shown = new Set(ds!.meta.rooms.map((r) => r.id));
  return Math.max(0, heating.findIndex((r) => !shown.has(r.id)));
}
function shownRank(id: string): number | null {
  const i = activeRooms()
    .filter((r) => r.category === 'heating')
    .findIndex((r) => r.id === id);
  return i >= 0 && i < SHOWN_ROOMS ? i : null;
}
export function roomColor(id: string) {
  const room = activeRooms().find((r) => r.id === id);
  if (room?.category === 'water_heater') return catColor('water_heater');
  if (id === OTHER) return cssVar('--usage-standby');
  return series(roomIndex(id));
}
export const OTHER = '__other__';
export const roomGroup = (id: string) =>
  activeRooms().find((r) => r.id === id)?.category === 'water_heater' || shownRank(id) !== null ? id : OTHER;
/** #300: years and seasons on the iris → grey ramp, the latest (year-0) in full colour. */
export function yearColor(y: number) {
  const years = ds!.meta.years;
  const age = years.indexOf(y) >= 0 ? years.length - 1 - years.indexOf(y) : 0;
  return cssVar(`--year-${Math.min(3, age)}`);
}
export const roomName = (id: string) => (id === OTHER ? 'Autres pièces' : (ds!.meta.rooms.find((r) => r.id === id)?.name ?? id));

// ------------------------------------------------------------------ shared charts
/** Year-over-year change per room (rooms view and annual report); `suffix` names a partial window (#297). */
export function drawWaterfall(el: HTMLElement, deltas: Map<string, { now: number; before: number }>, year: number, suffix = '') {
  const rooms = activeRooms().filter((r) => deltas.has(r.id));
  const steps = rooms
    .map((r) => ({ name: r.name, delta: deltas.get(r.id)!.now - deltas.get(r.id)!.before }))
    .filter((s) => Math.abs(s.delta) >= 1)
    .sort((a, b) => b.delta - a.delta);
  const start = [...deltas.values()].reduce((s, d) => s + d.before, 0);
  waterfallChart(el, { startLabel: `${year - 1}${suffix}`, endLabel: `${year}${suffix}`, start, steps });
}

/** Keep the menu open across the re-render that follows a change made inside it. */
export function keepMenuOpen() {
  document.querySelector<HTMLDetailsElement>('.menu')?.setAttribute('open', '');
}
