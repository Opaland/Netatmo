// #366: the wood stove. The radiators of a room heated by a stove are switched off (#346), so the
// app sees only part of the heating: the room looks free and a fall of electricity reads as a
// saving. The owner records the wood bought (⚙ Mon logement, repository variable WOOD_JSON copied
// into the encrypted meta by the collection); this module turns it into heat and euros with
// assumptions that are shown and can be changed, never hidden. Pure functions, no DOM.
//
//   heat of a purchase = stères × kWh per stère of the species (at 20 % moisture)
//                        × moisture factor × efficiency of the stove
//   in time            = the season the purchase feeds (Sept → Aug), spread over its days in
//                        proportion to the degree days (the colder, the more wood burnt).
//   #469: the fires     = where the collection found the stove's fires (stove-fires.ts), the wood
//                        of the days it could see goes to those evenings (onFireDays).
import { type DayRecord, addDays } from './aggregate';
import { type Weather, dju } from './analysis';
import { type StoveFires, isCovered } from './stove-fires';

export type Species = 'chene' | 'hetre' | 'charme' | 'frene' | 'melange' | 'resineux';
export const SPECIES: Record<Species, string> = {
  chene: 'Chêne',
  hetre: 'Hêtre',
  charme: 'Charme',
  frene: 'Frêne',
  melange: 'Mélange de feuillus',
  resineux: 'Résineux',
};
/**
 * kWh (lower heating value) in one stère of 1 m logs at 20 % moisture: usual orders of magnitude
 * of the wood-energy guides (dense hardwoods ≈ 2 000 kWh, softwoods ≈ 1 500 kWh). Chosen by
 * judgement, shown on the screen and editable: the owner's supplier may say otherwise.
 */
export const KWH_PER_STERE: Record<Species, number> = { chene: 2100, hetre: 2000, charme: 2100, frene: 2000, melange: 1900, resineux: 1500 };
/** Efficiency of a recent log stove, %, editable (an old open stove: 30 to 50 %). */
export const DEFAULT_EFFICIENCY = 70;
/** Moisture of the reference values above, % of the wet mass. */
export const REF_MOISTURE = 20;
/** Above this, wood burns badly: the stove's real efficiency falls well below the assumption. */
export const WET_MOISTURE = 25;

export interface WoodPurchase {
  /** Day of delivery (YYYY-MM-DD). */
  day: string;
  steres: number;
  species: Species;
  /** Moisture, % of the wet mass (dry wood: 15 to 20 %). */
  moisture: number;
  /** Price paid, € (delivery included). */
  price: number;
}

export interface WoodSettings {
  purchases: WoodPurchase[];
  /** Stove efficiency, %. */
  efficiency: number;
  /** kWh per stère at 20 % moisture, per species. */
  kwhPerStere: Record<Species, number>;
}

export const NO_WOOD: WoodSettings = { purchases: [], efficiency: DEFAULT_EFFICIENCY, kwhPerStere: { ...KWH_PER_STERE } };

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const realDay = (d: string) => DAY_RE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
export const MAX_PURCHASES = 60;

/** The settings kept in the meta (WOOD_JSON) or on this device, cleaned (never trusted, #359). */
export function parseWood(v: unknown): WoodSettings {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const purchases: WoodPurchase[] = [];
  for (const x of Array.isArray(o.purchases) ? o.purchases.slice(0, MAX_PURCHASES) : []) {
    const p = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    const day = typeof p.day === 'string' && realDay(p.day) ? p.day : null;
    const steres = num(p.steres, 0.1, 100);
    const moisture = num(p.moisture, 5, 60);
    const price = num(p.price, 0, 100000);
    const species = typeof p.species === 'string' && Object.hasOwn(SPECIES, p.species) ? (p.species as Species) : null;
    if (day && steres !== null && moisture !== null && price !== null && species) purchases.push({ day, steres, species, moisture, price });
  }
  purchases.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const kwh = o.kwhPerStere && typeof o.kwhPerStere === 'object' ? (o.kwhPerStere as Record<string, unknown>) : {};
  const kwhPerStere = { ...KWH_PER_STERE };
  for (const k of Object.keys(SPECIES) as Species[]) {
    const v = Object.hasOwn(kwh, k) ? num(kwh[k], 500, 3000) : null;
    if (v !== null) kwhPerStere[k] = v;
  }
  return { purchases, efficiency: num(o.efficiency, 10, 100) ?? DEFAULT_EFFICIENCY, kwhPerStere };
}
/** Value of the repository variable WOOD_JSON: the assumptions only when they differ from the defaults. */
export function woodJson(w: WoodSettings): string {
  const c = parseWood(w);
  const kwh = Object.fromEntries((Object.keys(SPECIES) as Species[]).filter((k) => c.kwhPerStere[k] !== KWH_PER_STERE[k]).map((k) => [k, c.kwhPerStere[k]]));
  return JSON.stringify({
    purchases: c.purchases,
    ...(c.efficiency !== DEFAULT_EFFICIENCY ? { efficiency: c.efficiency } : {}),
    ...(Object.keys(kwh).length ? { kwhPerStere: kwh } : {}),
  });
}

const DRY_KWH_PER_KG = 5; // lower heating value of dry wood, ≈ 18 MJ/kg
const WATER_KWH_PER_KG = 0.68; // heat taken to evaporate a kg of water, ≈ 2.44 MJ/kg
/**
 * Energy of a stère at `moisture` % vs the same stère at 20 %: the same dry wood, minus the heat
 * taken to evaporate its water. Wet wood also burns badly, which this does not count (WET_MOISTURE).
 */
export function moistureFactor(moisture: number): number {
  const water = (h: number) => (WATER_KWH_PER_KG * h) / (100 - h);
  return (DRY_KWH_PER_KG - water(moisture)) / (DRY_KWH_PER_KG - water(REF_MOISTURE));
}

/** Useful heat of a purchase (kWh given to the house). */
export function heatOf(p: WoodPurchase, s: WoodSettings): number {
  return p.steres * s.kwhPerStere[p.species] * moistureFactor(p.moisture) * (s.efficiency / 100);
}

/**
 * The heating season (Sept → Aug, by its first year) a purchase is burnt in: bought from April,
 * the one that starts in the next September; bought from January to March, the one running.
 */
export function seasonFed(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

export interface WoodSeason {
  season: number;
  steres: number;
  kwh: number;
  eur: number;
}
/** Wood bought per season it feeds, oldest first. */
export function woodSeasons(s: WoodSettings): WoodSeason[] {
  const map = new Map<number, WoodSeason>();
  for (const p of s.purchases) {
    const y = seasonFed(p.day);
    const w = map.get(y) ?? map.set(y, { season: y, steres: 0, kwh: 0, eur: 0 }).get(y)!;
    w.steres += p.steres;
    w.kwh += heatOf(p, s);
    w.eur += p.price;
  }
  return [...map.values()].sort((a, b) => a.season - b.season);
}

const seasonDays = (y: number, last: string): [string, string] => [`${y}-09-01`, `${y + 1}-08-31` < last ? `${y + 1}-08-31` : last];

/**
 * Wood heat and cost per day: each season's wood spread over its days in proportion to their
 * degree days (base 18 °C). A season still running is spread over the degree days of an average
 * whole season (the complete ones of the weather): what is still in the woodshed is not counted
 * yet. Without weather, evenly from October to April.
 */
export function woodDaily(s: WoodSettings, weather: Weather | null, last: string, fires: StoveFires | null = null): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const seasons = woodSeasons(s);
  if (!seasons.length || !last) return out;
  // degree days of the whole seasons the weather covers, for a season still running
  const whole: number[] = [];
  if (weather) {
    const first = [...weather.keys()].sort()[0];
    for (let y = Number(first.slice(0, 4)); `${y + 1}-08-31` <= last; y++) {
      if (`${y}-09-01` < first) continue;
      let sum = 0;
      for (let d = `${y}-09-01`; d <= `${y + 1}-08-31`; d = addDays(d, 1)) sum += weather.has(d) ? dju(weather.get(d)!) : 0;
      whole.push(sum);
    }
  }
  const usual = whole.length ? whole.reduce((a, b) => a + b, 0) / whole.length : null;
  for (const w of seasons) {
    const [from, to] = seasonDays(w.season, last);
    if (from > last) continue;
    const weight = new Map<string, number>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const m = Number(d.slice(5, 7));
      weight.set(d, weather ? (weather.has(d) ? dju(weather.get(d)!) : 0) : m >= 10 || m <= 4 ? 1 : 0);
    }
    const so = [...weight.values()].reduce((a, b) => a + b, 0);
    const complete = to === `${w.season + 1}-08-31`;
    // running: an average season's degree days, or the days of October to April without weather
    const denom = complete ? so : weather ? Math.max(so, usual ?? so) : 212;
    if (denom <= 0) continue;
    // #469: the share of the season so far stays the degree days'; the fires only choose its days
    const days = (fires && onFireDays(weight, fires)) || weight;
    const sum = [...days.values()].reduce((a, b) => a + b, 0);
    if (sum <= 0) continue;
    const share = so / denom;
    for (const [d, x] of days) {
      if (!x) continue;
      const cur = out.get(d) ?? [0, 0];
      out.set(d, [cur[0] + (w.kwh * share * x) / sum, cur[1] + (w.eur * share * x) / sum]);
    }
  }
  return out;
}

/**
 * #469: the weights of a season's days moved to its fires. The days the detection could see
 * (stove-fires.ts isCovered) keep their degree days in all, but these go to the evenings a fire was
 * found, in proportion to its estimated burn (half hours); the days it could not see keep their
 * own. Null when no fire was found in the season: the degree days throughout (the fallback).
 */
export function onFireDays(weight: Map<string, number>, fires: StoveFires): Map<string, number> | null {
  let seen = 0;
  let burnt = 0;
  for (const [d, x] of weight) {
    if (!isCovered(fires, d)) continue;
    seen += x;
    burnt += fires.fires.get(d)?.slots ?? 0;
  }
  if (!burnt) return null;
  const out = new Map<string, number>();
  for (const [d, x] of weight) out.set(d, isCovered(fires, d) ? (seen * (fires.fires.get(d)?.slots ?? 0)) / burnt : x);
  return out;
}

/** Wood heat and cost over [from, to], the days of `skip` left out (#423: the cuts of « Expliquer un mois »). */
export function woodIn(daily: Map<string, [number, number]>, from: string, to: string, skip?: ReadonlySet<string>): { kwh: number; eur: number } {
  let kwh = 0;
  let eur = 0;
  for (const [d, v] of daily) if (d >= from && d <= to && !skip?.has(d)) (kwh += v[0]), (eur += v[1]);
  return { kwh, eur };
}

/** Room id of the wood as day records: no room of the home has it (a NUL cannot come from the API). */
export const WOOD_ROOM = '\u0000bois';
/**
 * #433: the wood of each day from `first` on, as heating day records, to be counted with the
 * electricity of the same days (the Accueil verdict: this year and the reference years alike).
 */
export function woodRecords(daily: Map<string, [number, number]>, first = ''): DayRecord[] {
  const out: DayRecord[] = [];
  for (const [day, [kwh]] of daily) if (day >= first && kwh > 0) out.push({ day, room: WOOD_ROOM, cat: 'heating', kwh });
  return out;
}

/** « 4 stères de chêne à 20 % » (the assumptions behind a heat figure, said in words). */
export function purchaseText(p: WoodPurchase): string {
  const n = String(p.steres).replace('.', ',');
  return `${n} stère${p.steres >= 2 ? 's' : ''} ${p.species === 'melange' ? 'de feuillus mélangés' : p.species === 'resineux' ? 'de résineux' : `de ${SPECIES[p.species].toLowerCase()}`} à ${p.moisture} %`;
}
