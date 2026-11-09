// #301 / #308: the figures of the Compteur tab (views/meter.ts), as pure functions tested in
// meter.test.ts. One period for the whole tab (Mois · Saison · 12 mois · Année, the control of
// Accueil); every card says what it counts: which days of that period the meter (or the load
// curve, or the radiators) really covers, and that the room filters do not apply to the meter.
import { type DayRecord, MONTHS_SHORT } from './aggregate';
import { HOME_PERIODS, type HomePeriod } from './home';
import { dayShort, fmt1, rangeLabel } from './glossary';
import { daysBetween } from './periods';

/** A remembered value from another version falls back to the 12 months (maquette compteur.html). */
export const meterPeriod = (v: unknown): HomePeriod => (HOME_PERIODS.some(([k]) => k === v) ? (v as HomePeriod) : '12m');

/** Card subtitle: the period in a few words (« 12 derniers mois », « novembre 2026, au 8 »). */
export function periodShort(period: HomePeriod, to: string): string {
  switch (period) {
    case 'month':
      return `${MONTHS_SHORT[Number(to.slice(5, 7)) - 1]} ${to.slice(0, 4)}, au ${dayShort(to)}`;
    case 'season':
      return `saison depuis le 1er sept., au ${dayShort(to)}`;
    case 'year':
      return `${to.slice(0, 4)}, au ${dayShort(to)}`;
    default:
      return `12 derniers mois, au ${dayShort(to)}`;
  }
}

export interface Coverage {
  first: string;
  last: string;
  /** Days of the period that have a value. */
  n: number;
  /** Days of the period. */
  of: number;
}

/** Which days of [from, to] a source covers (null: none). */
export function coverage(days: Iterable<string>, from: string, to: string): Coverage | null {
  let first = '';
  let last = '';
  const seen = new Set<string>();
  for (const d of days) {
    const day = d.slice(0, 10);
    if (day < from || day > to || seen.has(day)) continue;
    seen.add(day);
    if (!first || day < first) first = day;
    if (!last || day > last) last = day;
  }
  return seen.size ? { first, last, n: seen.size, of: daysBetween(from, to) } : null;
}

/** « du 9 nov. 2025 au 8 nov. 2026 (365 jours) », « du 10 sept. au 8 nov. 2026 (60 jours sur 365) ». */
export function coveredText(c: Coverage, unit: 'jour' | 'nuit' = 'jour'): string {
  const n = `${c.n} ${unit}${c.n > 1 ? 's' : ''}`;
  return `${rangeLabel(c.first, c.last)} (${c.n < c.of ? `${n} sur ${c.of}` : n})`;
}

/** Percentages that add up to 100 (largest remainder), for a share bar and its legend. */
export function roundShares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

export interface UsageBuckets {
  keys: string[];
  heat: number[];
  water: number[];
  other: number[];
  home: number[];
}

/**
 * Heating, water heater and the rest of the meter per day or month over [from, to], on the days
 * the meter has (the radiators of a day without meter reading are left out on both sides).
 */
export function usageBuckets(records: DayRecord[], linky: Map<string, number>, from: string, to: string, gran: 'day' | 'month'): UsageBuckets {
  const key = (d: string) => (gran === 'day' ? d : d.slice(0, 7));
  const home = new Map<string, number>();
  const heat = new Map<string, number>();
  const water = new Map<string, number>();
  for (const [d, kwh] of linky) if (d >= from && d <= to) home.set(key(d), (home.get(key(d)) ?? 0) + kwh);
  for (const r of records) {
    if (r.day < from || r.day > to || !linky.has(r.day)) continue;
    const m = r.cat === 'water_heater' ? water : heat;
    m.set(key(r.day), (m.get(key(r.day)) ?? 0) + r.kwh);
  }
  const keys = [...home.keys()].sort();
  const h = keys.map((k) => heat.get(k) ?? 0);
  const w = keys.map((k) => water.get(k) ?? 0);
  const t = keys.map((k) => home.get(k) ?? 0);
  return { keys, heat: h, water: w, home: t, other: keys.map((_, i) => Math.max(0, t[i] - h[i] - w[i])) };
}

export interface UsageShare {
  heat: number;
  water: number;
  other: number;
  total: number;
  /** Heating, water, other, in % adding up to 100. */
  pct: [number, number, number];
}
export function usageShare(b: UsageBuckets): UsageShare | null {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const total = sum(b.home);
  if (total <= 0) return null;
  const heat = sum(b.heat);
  const water = sum(b.water);
  const other = Math.max(0, total - heat - water);
  const [p1, p2, p3] = roundShares([heat, water, other]);
  return { heat, water, other, total, pct: [p1, p2, p3] };
}

/** Highest daily power (kVA) per day or month over [from, to]. */
export function powerBuckets(pmax: Map<string, number>, from: string, to: string, gran: 'day' | 'month'): { keys: string[]; max: number[] } {
  const by = new Map<string, number>();
  for (const [d, v] of pmax) {
    if (d < from || d > to) continue;
    const k = gran === 'day' ? d : d.slice(0, 7);
    by.set(k, Math.max(by.get(k) ?? 0, v));
  }
  const keys = [...by.keys()].sort();
  return { keys, max: keys.map((k) => by.get(k)!) };
}

/** The highest power of [from, to] and its day. */
export function peakOf(pmax: Map<string, number>, from: string, to: string): { max: number; day: string } | null {
  let best: { max: number; day: string } | null = null;
  for (const [d, v] of pmax) if (d >= from && d <= to && (!best || v > best.max || (v === best.max && d > best.day))) best = { max: v, day: d };
  return best;
}

/** Subscribed power against the peak: used share and a plain sentence (maquette: « Votre puissance est adaptée. »). */
export function powerVerdict(peak: number, kva: number): { used: number; level: 'tight' | 'ok' | 'wide'; text: string } {
  const used = (peak / kva) * 100;
  const margin = kva - peak;
  if (margin < 0.5) return { used, level: 'tight', text: 'Vous êtes au plus près de votre puissance : le compteur peut couper lors des pics.' };
  if (margin > 3.5)
    return { used, level: 'wide', text: 'Marge confortable : une puissance plus basse pourrait suffire (abonnement moins cher), à confirmer sur un hiver froid.' };
  return { used, level: 'ok', text: 'Votre puissance est adaptée.' };
}

/** « 10,2 kVA » */
export const kva = (v: number) => `${fmt1(v)} kVA`;

/**
 * Peak / off-peak split of the radiators and the water heater (Intuis readings by tariff):
 * `split` is [$0, $1, $2, without detail] (analysis.tariffSplit), `offCol` the off-peak column.
 */
export function offPeakShare(split: [number, number, number, number], offCol: 1 | 2 | null): { offPeak: number; peak: number; none: number; pct: number } | null {
  if (!offCol || split[1] + split[2] <= 0) return null;
  const offPeak = split[offCol];
  const peak = split[offCol === 1 ? 2 : 1];
  return { offPeak, peak, none: split[0] + split[3], pct: (offPeak / (offPeak + peak)) * 100 };
}

/** Standby all year long: kWh and, with a price, euros. */
export function standbyYear(watts: number, price: number | null): { kwh: number; eur: number | null } {
  const kwh = (watts * 8760) / 1000;
  return { kwh, eur: price ? kwh * price : null };
}

/**
 * #301: the room filters of Accueil or Pièces do not apply to the meter; said once on the tab
 * when one is on (« Le filtre « Chauffe-eau · 2 pièces sur 7 » ne s'applique pas ici… »).
 */
export function filterNote(o: { cat: string; catLabel: string; rooms: number; allRooms: number }): string {
  const parts = [o.cat === 'all' ? '' : o.catLabel, o.rooms < o.allRooms ? `${o.rooms} pièce${o.rooms > 1 ? 's' : ''} sur ${o.allRooms}` : ''].filter(Boolean);
  if (!parts.length) return '';
  return `Le filtre « ${parts.join(' · ')} » ne s'applique pas ici : le compteur mesure tout le logement.`;
}
