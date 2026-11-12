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
//   #465: the stock     = what a season does not burn is carried to the next one. Without a
//                        reading, a season burns all it has (the assumption, shown); a reading
//                        of the stères burnt, or of the stock left in spring, takes its place.
import { type DayRecord, addDays } from './aggregate';
import { type Weather, dju } from './analysis';

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

/**
 * #465: what a season really burnt, noted by the owner (optional): the stères burnt, or the stock
 * left in the woodshed in spring. Exactly one of the two.
 */
export interface WoodBurnt {
  /** The heating season (Sept → Aug), by its first year. */
  season: number;
  steres?: number;
  left?: number;
}

export interface WoodSettings {
  purchases: WoodPurchase[];
  /** #465: readings of the wood really burnt, one per season at most, oldest first. */
  burnt: WoodBurnt[];
  /** Stove efficiency, %. */
  efficiency: number;
  /** kWh per stère at 20 % moisture, per species. */
  kwhPerStere: Record<Species, number>;
}

export const NO_WOOD: WoodSettings = { purchases: [], burnt: [], efficiency: DEFAULT_EFFICIENCY, kwhPerStere: { ...KWH_PER_STERE } };

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const realDay = (d: string) => DAY_RE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
export const MAX_PURCHASES = 60;
/** #465: bounds of a reading (stères burnt or left) and of its season (same in collector/devices.py). */
export const MAX_BURNT_STERES = 200;
export const BURNT_SEASONS: [number, number] = [2000, 2100];

/** #465: the readings, cleaned: a known season, exactly one bounded quantity, the first per season. */
function parseBurnt(v: unknown): WoodBurnt[] {
  const out: WoodBurnt[] = [];
  for (const x of Array.isArray(v) ? v.slice(0, MAX_PURCHASES) : []) {
    const b = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
    const season = num(b.season, BURNT_SEASONS[0], BURNT_SEASONS[1]);
    const steres = Object.hasOwn(b, 'steres') ? num(b.steres, 0, MAX_BURNT_STERES) : null;
    const left = Object.hasOwn(b, 'left') ? num(b.left, 0, MAX_BURNT_STERES) : null;
    if (season === null || !Number.isInteger(season) || (steres === null) === (left === null) || out.some((o) => o.season === season)) continue;
    out.push(steres !== null ? { season, steres } : { season, left: left! });
  }
  return out.sort((a, b) => a.season - b.season);
}

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
  return { purchases, burnt: parseBurnt(o.burnt), efficiency: num(o.efficiency, 10, 100) ?? DEFAULT_EFFICIENCY, kwhPerStere };
}
/** Value of the repository variable WOOD_JSON: the assumptions only when they differ from the defaults. */
export function woodJson(w: WoodSettings): string {
  const c = parseWood(w);
  const kwh = Object.fromEntries((Object.keys(SPECIES) as Species[]).filter((k) => c.kwhPerStere[k] !== KWH_PER_STERE[k]).map((k) => [k, c.kwhPerStere[k]]));
  return JSON.stringify({
    purchases: c.purchases,
    ...(c.burnt.length ? { burnt: c.burnt } : {}),
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
  /** Stères bought for this season (seasonFed). */
  bought: number;
  /** Stères carried from the season before (#465). */
  carried: number;
  /** Stères burnt, their heat (kWh) and their cost (€): what the days of the season count. */
  steres: number;
  kwh: number;
  eur: number;
  /** Stères left for the next season. */
  left: number;
  /** The reading noted for this season, or null: all it had is assumed burnt. */
  reading: WoodBurnt | null;
  /** Stères noted burnt beyond the stock recorded (purchases missing?): not counted. */
  short: number;
}

/**
 * #465: the one stock rule. Season after season, oldest first: the stock carried plus the wood
 * bought for it; it burns what was noted (stères burnt, or all but the stock left in spring),
 * else all of it (the assumption). The oldest wood burns first; its heat and cost follow it.
 */
export function woodSeasons(s: WoodSettings): WoodSeason[] {
  if (!s.purchases.length) return [];
  const lots: { steres: number; kwh: number; eur: number }[] = []; // per stère, oldest first
  const fed = new Map<number, WoodPurchase[]>();
  for (const p of s.purchases) {
    const y = seasonFed(p.day);
    (fed.get(y) ?? fed.set(y, []).get(y)!).push(p);
  }
  const readings = new Map(s.burnt.map((b) => [b.season, b]));
  const first = Math.min(...fed.keys());
  const last = Math.max(...fed.keys(), ...s.burnt.map((b) => b.season));
  const out: WoodSeason[] = [];
  const EPS = 1e-9;
  // after the last purchase or reading, the stock left burns in the next season (no reading: all of it)
  for (let y = first; y <= last || lots.length; y++) {
    const carried = lots.reduce((a, l) => a + l.steres, 0);
    let bought = 0;
    for (const p of fed.get(y) ?? []) {
      bought += p.steres;
      lots.push({ steres: p.steres, kwh: heatOf(p, s) / p.steres, eur: p.price / p.steres });
    }
    const have = carried + bought;
    const r = readings.get(y) ?? null;
    const want = r ? (r.steres ?? Math.max(0, have - r.left!)) : have;
    let burn = Math.min(want, have);
    const w: WoodSeason = { season: y, bought, carried, steres: burn, kwh: 0, eur: 0, left: 0, reading: r, short: Math.max(0, want - have) };
    while (burn > EPS && lots.length) {
      const l = lots[0];
      const take = Math.min(l.steres, burn);
      w.kwh += take * l.kwh;
      w.eur += take * l.eur;
      burn -= take;
      l.steres -= take;
      if (l.steres <= EPS) lots.shift();
    }
    w.left = lots.reduce((a, l) => a + l.steres, 0);
    if (have > EPS || r) out.push(w);
  }
  return out;
}

const seasonDays = (y: number, last: string): [string, string] => [`${y}-09-01`, `${y + 1}-08-31` < last ? `${y + 1}-08-31` : last];

/**
 * Wood heat and cost per day: each season's wood burnt (woodSeasons: the stock rule) spread over its days in proportion to their
 * degree days (base 18 °C). A season still running is spread over the degree days of an average
 * whole season (the complete ones of the weather): what is still in the woodshed is not counted
 * yet. Without weather, evenly from October to April.
 */
export function woodDaily(s: WoodSettings, weather: Weather | null, last: string): Map<string, [number, number]> {
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
    if (from > last || (w.kwh <= 0 && w.eur <= 0)) continue;
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
    for (const [d, x] of weight) {
      if (!x) continue;
      const cur = out.get(d) ?? [0, 0];
      out.set(d, [cur[0] + (w.kwh * x) / denom, cur[1] + (w.eur * x) / denom]);
    }
  }
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

const st = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} stère${v >= 2 ? 's' : ''}`;
/**
 * #465: what a season counts, said with its assumption: « 2 stères achetés · tout brûlé (supposé) »,
 * « 0,5 stère reporté · 2 stères achetés · 1,5 stère brûlé (relevé) · reste 1 stère ».
 */
export function seasonText(s: WoodSeason): string {
  const parts: string[] = [];
  if (s.carried > 1e-9) parts.push(`${st(s.carried)} reporté${s.carried >= 2 ? 's' : ''}`);
  if (s.bought > 0 || !parts.length) parts.push(`${st(s.bought)} acheté${s.bought >= 2 ? 's' : ''}`);
  if (!s.reading) parts.push('tout brûlé (supposé)');
  else parts.push(`${st(s.steres)} brûlé${s.steres >= 2 ? 's' : ''} (${s.reading.left !== undefined ? 'stock relevé au printemps' : 'relevé'})`);
  if (s.left > 1e-9) parts.push(`reste ${st(s.left)}`);
  if (s.short > 1e-9) parts.push(`${st(s.short)} de plus que les achats notés, non compté${s.short >= 2 ? 's' : ''}`);
  return parts.join(' · ');
}
