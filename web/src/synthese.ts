// Synthèse figures shared by the cards of one screen (#290): pure, no DOM, no state.
// « 12 mois » is the same sliding window everywhere on the screen: the 365 days ending on
// the last day (9 Nov 2025 → 8 Nov 2026), like the main chart and the « 12 derniers mois »
// tile, so a month shows the same kWh in every card.
import { type DayRecord, addDays, minusYears } from './aggregate';

/** The sliding 12 months ending on `last`: [last − 1 year + 1 day, last]. */
export function twelveMonths(last: string): [string, string] {
  return [addDays(minusYears(last), 1), last];
}

export interface LinkyMonths {
  keys: string[]; // YYYY-MM, in order; the first one starts on `from` (partial month)
  heat: Map<string, number>;
  water: Map<string, number>;
  home: Map<string, number>;
}

/** Heating, water heater and Linky kWh per month over [from, to], on the days the Linky has. */
export function linkyMonths(records: DayRecord[], linky: Map<string, number>, from: string, to: string): LinkyMonths {
  const heat = new Map<string, number>();
  const water = new Map<string, number>();
  const home = new Map<string, number>();
  for (const [d, kwh] of linky) if (d >= from && d <= to) home.set(d.slice(0, 7), (home.get(d.slice(0, 7)) ?? 0) + kwh);
  for (const r of records) {
    if (r.day < from || r.day > to || !linky.has(r.day)) continue; // same days on both sides
    const m = r.day.slice(0, 7);
    const target = r.cat === 'water_heater' ? water : heat;
    target.set(m, (target.get(m) ?? 0) + r.kwh);
  }
  return { keys: [...home.keys()].sort(), heat, water, home };
}

/** Highest Linky power (kVA) per month over [from, to], with its day. */
export function pmaxMonths(pmax: Map<string, number>, from: string, to: string): Map<string, { max: number; day: string }> {
  const months = new Map<string, { max: number; day: string }>();
  for (const [d, v] of pmax) {
    if (d < from || d > to) continue;
    const m = d.slice(0, 7);
    if (!months.has(m) || v > months.get(m)!.max) months.set(m, { max: v, day: d });
  }
  return new Map([...months].sort(([a], [b]) => (a < b ? -1 : 1)));
}

// #292: every amount says what it covers. The Synthèse counts the energy of the radiators and
// the water heater (the subscription is a fixed cost, it is in Comparer and the report).
export const ENERGY_ONLY = 'hors abonnement';
export const WITH_SUBSCRIPTION = 'abonnement inclus';

/**
 * #292 / #386: what the euros of « Consommation en détail » cover, after its « Compté : » (which
 * names the meters and the rooms, history.ts).
 */
export const EUROS_NOTE = `euros : énergie seule, ${ENERGY_ONLY} ; « ≈ » pour une estimation au prix moyen de la sélection sur 12 mois`;

/**
 * #291: euros of the year-end projection: the real cost so far (the « Depuis le 1er janvier »
 * tile) plus the kWh still to come at the selection's average price. Null without prices.
 */
export function projectedCost(costToDate: number | null, ytd: number, projected: number, price: number | null): number | null {
  if (costToDate === null || price === null) return null;
  return costToDate + Math.max(0, projected - ytd) * price;
}
