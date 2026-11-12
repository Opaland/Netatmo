// #460: judging the insulation with the whole heating. A room heated by a wood stove has its
// radiators switched off (#346): the electricity alone makes the home look several times better
// insulated than it is. Every screen that judges the insulation — the signature (« Chauffage selon
// le froid »), « Année par année » and the kWh/m² — counts the stove's wood with the electricity,
// day by day, with the one split of the wood (wood.ts woodDaily, the degree-day split of #433's
// verdict, of « Hiver contre hiver » and « Expliquer un mois »): this module never splits wood
// itself, it takes that map. Pure functions, no DOM.
import { type DayRecord, total } from './aggregate';
import type { Weather } from './analysis';
import { type YearCold, yearCold } from './dju';
import { woodIn, woodRecords } from './wood';

/** The heating records with the stove's wood of each day from the first electricity day on (#433's rule). */
export function withWood(records: DayRecord[], daily: Map<string, [number, number]> | null): DayRecord[] {
  if (!daily) return records;
  const first = records.reduce((a, r) => (!a || r.day < a ? r.day : a), '');
  return [...records, ...woodRecords(daily, first)];
}

export interface WoodYear {
  /** Heating kWh, electricity + wood, over the span. */
  kwh: number;
  /** Of which the stove's wood. */
  wood: number;
  /** Price paid for that wood (€). */
  woodEur: number;
  /** The cold of the span and the heating per degree day (dju.ts yearCold), null without weather. */
  cold: YearCold | null;
}

/**
 * One year of « Chauffage électricité + bois » (Année par année, #460), by the rules of the table
 * above it: the wood counted from the first electricity day on (withWood, #433's rule), and the
 * cold of the same span with the same caveat (#464, yearCold: « au moins » when days have no
 * outdoor temperature, the heating per degree day over the days measured only). `heat`: the
 * heating records; [from, to]: the span of the year the table shows (from the first day of data).
 */
export function woodYear(heat: DayRecord[], daily: Map<string, [number, number]>, weather: Weather | null, year: number, from: string, to: string): WoodYear {
  const counted = withWood(heat, daily);
  const elec = total(heat, from, to);
  const kwh = total(counted, from, to);
  const first = heat.reduce((a, r) => (!a || r.day < a ? r.day : a), '');
  const woodEur = woodIn(daily, first > from ? first : from, to).eur; // same days as withWood
  const cold = weather ? yearCold(weather, year, from, to, (has) => total(counted.filter((r) => has(r.day)), from, to)) : null;
  return { kwh, wood: kwh - elec, woodEur, cold };
}

/** Heat loss in W per °C of the home from the slope of the signature (kWh per day per °C outdoors). */
export const wattsPerDegree = (slopeKwhPerDay: number) => (Math.abs(slopeKwhPerDay) * 1000) / 24;

export type Grade = 'très bien isolé' | 'bien isolé' | 'moyennement isolé' | 'mal isolé';
const GRADES: Grade[] = ['très bien isolé', 'bien isolé', 'moyennement isolé', 'mal isolé'];

/**
 * Indicative grids, a threshold of PRESENTATION (AGENTS.md: it changes the words, never a figure
 * computed). Chosen by judgement from the usual orders of magnitude, and shown as such on screen:
 * - W/°C (heat loss of the whole envelope and air renewal): < 100 a small or recent well insulated
 *   house, 170 to 280 an average one, > 280 a large or poorly insulated one. Ruled out: the
 *   regulatory coefficient (Ubât, needs the walls' areas, unknown here) and a grid per m² of
 *   W/°C (the surfaces are optional; the kWh/m² grid says the per-m² part).
 * - Heating kWh/m² per year: the bands of the energy labels' heating part (≈ 50 / 90 / 150),
 *   rounded. Ruled out: the DPE letters themselves (primary energy, hot water and cooling
 *   included, a conventional climate: not what is measured here).
 */
export const W_PER_K_GRID: readonly [number, number, number] = [100, 170, 280];
export const KWH_M2_GRID: readonly [number, number, number] = [50, 90, 150];

/** The band of a value on a grid (the lower bound belongs to the band above: 100 W/°C is « bien »). */
export function gradeOf(v: number, grid: readonly [number, number, number]): Grade {
  return GRADES[grid.filter((t) => v >= t).length];
}
/** « < 100 très bien · 100–170 bien · 170–280 moyen · > 280 mal isolé ». */
export function gridText(grid: readonly [number, number, number]): string {
  const [a, b, c] = grid;
  return `< ${a} très bien · ${a}–${b} bien · ${b}–${c} moyen · > ${c} mal isolé`;
}

export interface HomePerM2 {
  /** Heating kWh of the surfaced rooms over the window, wood included when a stove room is surfaced. */
  kwh: number;
  /** The wood counted (kWh). */
  wood: number;
  m2: number;
  perM2: number;
  /** Surfaced heating rooms / heating rooms. */
  known: number;
  rooms: number;
}

/**
 * The heating kWh/m² of the home over [from, to]: the electricity of the heating rooms with a
 * surface, plus the stove's wood when one of its rooms has a surface (the stove heats it), over
 * the surfaces entered. Null without any surface: no kWh/m² then.
 */
export function homePerM2(
  records: DayRecord[],
  surfaces: Record<string, number>,
  heatingRooms: string[],
  stove: string[],
  daily: Map<string, [number, number]> | null,
  from: string,
  to: string,
): HomePerM2 | null {
  const surfaced = heatingRooms.filter((id) => surfaces[id] > 0);
  if (!surfaced.length) return null;
  const inside = new Set(surfaced);
  let kwh = 0;
  for (const r of records) if (r.cat === 'heating' && r.day >= from && r.day <= to && inside.has(r.room)) kwh += r.kwh;
  const wood = daily && stove.some((id) => inside.has(id)) ? woodIn(daily, from, to).kwh : 0;
  const m2 = surfaced.reduce((s, id) => s + surfaces[id], 0);
  return { kwh: kwh + wood, wood, m2, perM2: (kwh + wood) / m2, known: surfaced.length, rooms: heatingRooms.length };
}

/** Under this many electric kWh per m², a stove room is « chauffée au bois » (its radiators are off). */
export const WOOD_ONLY_KWH_M2 = 0.5;
/**
 * The kWh/m² of one room as written: a room heated by the stove has (almost) no electricity, so
 * its figure says « chauffée au bois », never 0; with some electricity, « + bois » after it.
 */
export function roomPerM2Text(kwh: number, m2: number, stove: boolean, fmt: (v: number) => string): string {
  const v = kwh / m2;
  if (stove && v < WOOD_ONLY_KWH_M2) return 'chauffée au bois';
  return `${fmt(v)} kWh/m²${stove ? ' + bois' : ''}`;
}
