// Helpers shared by several views: formatting, HTML fragments, colours, rooms, costs.
import { type Category, type DayRecord, MONTHS_LONG, addDays, applyFilter, minusYears, pctChange } from './aggregate';
import { energyCost, energyCostTrve, hasPrices, offPeakColumn, offPeakShares, subscriptionCost, subscriptionTrve, trveAt } from './analysis';
import { type State, activeRooms, ds, state } from './app';
import { cssVar, escapeHtml as esc, waterfallChart } from './charts';
import { type ResolvedContract, resolveContract } from './contract';
import { type ContractPeriod, periodAt } from './offers';

export { esc };
export { fmtKwh } from './charts';

// ------------------------------------------------------------------ formatting
export const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** Signed, rounded percentage without "-0". */
export const pct = (p: number) => {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} %`;
};
export const fmtEur = (v: number) => `${nf0.format(v)} €`;

export function longDate(day: string) {
  return `${Number(day.slice(8, 10))} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

export function delta(now: number, before: number) {
  const p = pctChange(now, before);
  if (p === null) return `<span class="delta neutral">pas de référence N-1</span>`;
  const r = Math.round(p);
  const cls = r === 0 ? 'neutral' : r > 0 ? 'up' : 'down';
  const arrow = r === 0 ? '=' : r > 0 ? '▲' : '▼';
  return `<span class="delta ${cls}"><span aria-hidden="true">${arrow}</span> ${pct(p)} vs N-1</span>`;
}

// ------------------------------------------------------------------ HTML fragments
export function seg<T extends string>(name: string, value: T, options: [T, string][], label: string) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options
    .map(
      ([v, l]) =>
        `<button type="button" role="radio" aria-checked="${v === value}" data-set="${name}" data-value="${v}">${esc(l)}</button>`,
    )
    .join('')}</div>`;
}

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
  return contractInfo().source === 'shared' ? 'trve' : state.priceMode;
}
/** Regulated price row in force on that day, under the contract of that day. */
export function priceAt(day: string) {
  const c = periodAt(contracts(), day);
  return c ? trveAt(ds!.offers.get(c.offer) ?? [], c.kva, day) : null;
}
const useTrve = () => priceMode() === 'trve' && ds!.offers.size > 0;
export const costAvailable = () => useTrve() || hasPrices(state.prices);
export function offCol(): 1 | 2 {
  const water = ds!.meta.rooms.filter((r) => r.category === 'water_heater').map((r) => r.id);
  return offPeakColumn(ds!.tariffs, water) ?? 2;
}
/** Energy cost of these records in [from, to], subscription prorated when asked. */
export function costOf(records: DayRecord[], from: string, to: string, withSub = false): number | null {
  if (!costAvailable()) return null;
  const recs = records.filter((r) => r.day >= from && r.day <= to);
  if (useTrve()) {
    const off = offCol();
    const c = energyCostTrve(recs, ds!.tariffs, priceAt, 0, off, offPeakShares(ds!.tariffs, off));
    return c.energy + (withSub ? subscriptionTrve(priceAt, 0, from, to) : 0);
  }
  const sub = withSub ? subscriptionCost(from, to, state.prices) : 0;
  return energyCost(recs, ds!.tariffs, state.prices) + sub;
}
export const eurOf = (records: DayRecord[], from: string, to: string) => {
  const c = costOf(records, from, to);
  return c === null ? '' : fmtEur(c);
};
/** Average €/kWh over the last 12 months, for chart tooltips. */
export function avgPrice(): number | null {
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const recs = ds!.records.filter((r) => r.day >= from);
  const kwh = recs.reduce((s, r) => s + r.kwh, 0);
  const c = costOf(recs, from, last);
  return c === null || !kwh ? null : c / kwh;
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
const SERIES_SLOTS = 8;
export const series = (i: number) => cssVar(`--series-${(i % SERIES_SLOTS) + 1}`);
export const catColor = (c: Category) => cssVar(c === 'water_heater' ? '--cat-water' : '--cat-heating');

export { activeRooms };
/**
 * Colour follows the room (its position in the house), never its rank.
 * Water-heater rooms wear the water colour; heating rooms take slots 3–8 (blue and
 * orange stay reserved for the two usages). Past six heating rooms → "Autres pièces".
 */
const ROOM_SLOTS = [2, 3, 4, 5, 6, 7];
function roomSlot(id: string): number | null {
  const heating = activeRooms().filter((r) => r.category === 'heating');
  const i = heating.findIndex((r) => r.id === id);
  return i >= 0 && i < ROOM_SLOTS.length ? ROOM_SLOTS[i] : null;
}
export function roomColor(id: string) {
  const room = activeRooms().find((r) => r.id === id);
  if (room?.category === 'water_heater') return catColor('water_heater');
  const slot = roomSlot(id);
  return slot === null ? cssVar('--text-muted') : series(slot);
}
export const OTHER = '__other__';
export const roomGroup = (id: string) =>
  activeRooms().find((r) => r.id === id)?.category === 'water_heater' || roomSlot(id) !== null ? id : OTHER;
export function yearColor(y: number) {
  const years = ds!.meta.years;
  return series(years.indexOf(y) >= 0 ? years.length - 1 - years.indexOf(y) : 0);
}
export const roomName = (id: string) => (id === OTHER ? 'Autres pièces' : (ds!.meta.rooms.find((r) => r.id === id)?.name ?? id));

// ------------------------------------------------------------------ shared charts
/** Year-over-year change per room (rooms view and annual report). */
export function drawWaterfall(el: HTMLElement, deltas: Map<string, { now: number; before: number }>, year: number) {
  const rooms = activeRooms().filter((r) => deltas.has(r.id));
  const steps = rooms
    .map((r) => ({ name: r.name, delta: deltas.get(r.id)!.now - deltas.get(r.id)!.before }))
    .filter((s) => Math.abs(s.delta) >= 1)
    .sort((a, b) => b.delta - a.delta);
  const start = [...deltas.values()].reduce((s, d) => s + d.before, 0);
  waterfallChart(el, { startLabel: String(year - 1), endLabel: String(year), start, steps });
}

/** Keep the menu open across the re-render that follows a change made inside it. */
export function keepMenuOpen() {
  document.querySelector<HTMLDetailsElement>('.menu')?.setAttribute('open', '');
}
