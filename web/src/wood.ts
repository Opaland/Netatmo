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
//                        Said in one sentence everywhere (WOOD_SPREAD, #501).
//   #469: the fires     = where the collection found the stove's fires (stove-fires.ts), the wood
//                        of the days it could see goes to those evenings (onFireDays).
//   #465: the stock     = what a season does not burn is carried to the next one. Without a
//                        reading, a season burns all it has (the assumption, shown); a reading
//                        of the stères burnt, or of the stock left in spring, takes its place.
import { type DayRecord, addDays } from './aggregate';
import { type Weather, dju } from './analysis';
import { type StoveFires, isCovered } from './stove-fires';
import { ADEME_PER_DEGREE } from './checks';

/**
 * #501: the rule that places the wood on the days, in one sentence for every screen that counts
 * it (woodDaily: the evenings of fire the collection found, else the degree days). `feminine`:
 * after « la chaleur ». A test fails if a view writes the degree days alone.
 */
export const woodSpread = (feminine = false) => {
  const e = feminine ? 'e' : '';
  return `réparti${e} sur les soirs de flambée que la collecte a trouvés, sinon selon le froid de chaque jour (degrés-jours)`;
};

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
  /** #501: stock noted left in spring beyond the stock recorded (purchases missing?): not counted. */
  over: number;
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
    const over = r?.left !== undefined ? Math.max(0, r.left - have) : 0;
    const w: WoodSeason = { season: y, bought, carried, steres: burn, kwh: 0, eur: 0, left: 0, reading: r, short: Math.max(0, want - have), over };
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

/**
 * #501: a reading noted for a season before the first purchase is not in any season (the stock
 * starts with the first purchase): ignored, and said beside the reading.
 */
export function readingIgnored(s: WoodSettings, b: WoodBurnt): boolean {
  return !s.purchases.length || b.season < Math.min(...s.purchases.map((p) => seasonFed(p.day)));
}

const seasonDays = (y: number, last: string): [string, string] => [`${y}-09-01`, `${y + 1}-08-31` < last ? `${y + 1}-08-31` : last];

/**
 * Wood heat and cost per day: each season's wood burnt (woodSeasons: the stock rule) spread over its days in proportion to their
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

// ------------------------------------------------------------------ #468 a stove room kept too warm
/**
 * #468: the assumptions of the advice « pièce chauffée au bois au-dessus de 22 °C », shown as such
 * on screen (stoveWarmText), written here only. 22 °C: the threshold the issue asks for (above the
 * usual 19–21 °C of a living room). The share of wood saved per degree is the ADEME rule of thumb
 * the app already uses for the heating (checks.ts ADEME_PER_DEGREE, ≈ 7 % per °C): one place.
 * The window (30 days) and the 7 days of stove heating with a measured temperature are thresholds
 * of PRESENTATION (AGENTS.md: they decide whether the advice is said, never a figure): a month is
 * what the room page says by default; under a week of readings a mean says little. Ruled out: the
 * whole season (a stove room warm in November says nothing of March) and the period picked on the
 * page (in summer the stove does not run).
 */
export const STOVE_ROOM_WARM = 22;
export const STOVE_WARM_WINDOW = 30;
export const STOVE_WARM_MIN_DAYS = 7;

export interface StoveWarm {
  /** Mean measured temperature (°C) of the days of stove heating in the window. */
  mean: number;
  days: number;
  /** The heating season (Sept → Aug, by its first year) whose wood the saving is a share of. */
  season: number;
  /** Share of that season's wood saved at 22 °C (0–1). */
  pct: number;
  steres: number;
  eur: number;
}

/** The heating season (Sept → Aug) a day belongs to, by its first year. */
const heatingSeason = (day: string) => Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) >= 9 ? 0 : 1);

/**
 * #468: a room heated by the stove (room-offline.ts stoveHeated) whose measured temperature, over
 * the days the wood heats (woodDaily: kWh > 0) of the last 30 days, is above 22 °C on average: the
 * wood saved by bringing it back to 22 °C, as a share of the season's wood (woodSeasons: the stock
 * rule, its stères and its price). Null: not enough days, not too warm, or no wood this season.
 */
export function stoveWarm(
  temps: ReadonlyMap<string, number | null | undefined>,
  daily: Map<string, [number, number]>,
  seasons: WoodSeason[],
  last: string,
): StoveWarm | null {
  let sum = 0;
  let days = 0;
  for (let d = addDays(last, 1 - STOVE_WARM_WINDOW); d <= last; d = addDays(d, 1)) {
    const t = temps.get(d);
    if ((daily.get(d)?.[0] ?? 0) > 0 && typeof t === 'number' && Number.isFinite(t)) (sum += t), days++;
  }
  if (days < STOVE_WARM_MIN_DAYS) return null;
  const mean = sum / days;
  if (mean <= STOVE_ROOM_WARM) return null;
  const season = heatingSeason(last);
  const w = seasons.find((s) => s.season === season);
  if (!w || w.steres <= 0) return null;
  const pct = Math.min(1, (mean - STOVE_ROOM_WARM) * ADEME_PER_DEGREE);
  return { mean, days, season, pct, steres: w.steres * pct, eur: w.eur * pct };
}

const fr1 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** #468: the advice, its gain and its assumptions in words (title, text). */
export function stoveWarmText(w: StoveWarm): { title: string; text: string } {
  const pct = Math.round(w.pct * 100);
  const eur = Math.round(w.eur);
  const steres = `${fr1(w.steres)} stère${w.steres >= 2 ? 's' : ''}`;
  return {
    title: `Pièce chauffée au bois au-dessus de ${STOVE_ROOM_WARM} °C`,
    text:
      `Sur ${w.days} jours de chauffe au bois des ${STOVE_WARM_WINDOW} derniers jours, la pièce était à ${fr1(w.mean)} °C en moyenne. ` +
      `La ramener à ${STOVE_ROOM_WARM} °C économiserait environ ${pct} % du bois de la saison ${w.season}-${w.season + 1}, soit ≈ ${steres}${eur > 0 ? ` et ${eur} €` : ''}. ` +
      `Hypothèses : le seuil de ${STOVE_ROOM_WARM} °C, environ ${Math.round(ADEME_PER_DEGREE * 100)} % de bois par degré au-dessus (règle de l'ADEME pour le chauffage), et le bois de la saison d'après vos achats (⚙ Mon logement).`,
  };
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
  if (s.over > 1e-9) parts.push(`stock relevé : ${st(s.over)} de plus que les achats notés, non compté${s.over >= 2 ? 's' : ''}`);
  return parts.join(' · ');
}
