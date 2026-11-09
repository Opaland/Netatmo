// #315 / #299: one vocabulary for the whole interface (docs/design/architecture-cible.md § 4,
// docs/design/audit-graphiques.md § 7). Period names, categories, units, comparison phrasing and
// date / hour formats live here only; views import them instead of writing their own.
import { MONTHS_LONG, MONTHS_SHORT } from './aggregate';

export { MONTHS_LONG, MONTHS_SHORT };

// ------------------------------------------------------------------ periods (§ 4.1)
export const PERIOD = {
  month: 'Ce mois-ci',
  ytd: 'Depuis le 1er janvier',
  '12m': '12 derniers mois',
  '30d': '30 derniers jours',
  season: 'Saison de chauffe',
  lastYear: "L'an dernier",
  projection: "Fin d'année estimée",
  all: 'Tout l’historique',
} as const;
/**
 * Owner feedback (v1.6): « consigne » alone is unclear. The setpoint is always written out, and
 * temperatures always say what was measured, where.
 */
export const TEMP = {
  setpoint: 'température demandée aux radiateurs (consigne)',
  setpointShort: 'Température demandée (consigne)',
  measured: 'Température mesurée dans la pièce',
  outdoor: 'Température extérieure',
} as const;
/** The definition said once, in the interface and in the help. */
export const SEASON_DEFINITION = 'du 1er septembre au 31 août';

// ------------------------------------------------------------------ categories (§ 4.3)
export const CATEGORY = {
  heating: 'Chauffage',
  /** the usage */
  water: 'Eau chaude',
  /** the appliance */
  waterHeater: 'Chauffe-eau',
  other: 'Autres usages',
  standby: 'Veille',
} as const;

// ------------------------------------------------------------------ units and numbers (§ 4.2)
export const UNIT = { energy: 'kWh', power: 'kVA', watt: 'W', temp: '°C', co2: 'kg CO₂e', ppm: 'ppm', eur: '€' } as const;
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** « −16 % », « +3 % », « 0 % » (typographic minus, never « -0 »). */
export function signedPct(p: number): string {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} %`;
}
/**
 * #258: one decimal, French style, typographic minus: « 19,5 », « −2,5 », « 0,0 » (never « -0,0 »).
 * The one copy of the app (temperatures, kWh/°C, hours, kVA).
 */
export function fmt1(v: number): string {
  const r = Math.round(v * 10) / 10;
  const s = Math.abs(r).toFixed(1).replace('.', ',');
  return r < 0 ? `−${s}` : s;
}
// CO₂: money.ts fmtCo2() writes « 274 kg CO₂e » with the unit above.

// ------------------------------------------------------------------ dates and hours (§ 7.2)
const dayNum = (day: string) => Number(day.slice(8, 10));
const ord = (d: number) => (d === 1 ? '1er' : String(d));
/** « 1er août 2026 », « 8 novembre 2026 » (text). */
export function dayLong(day: string, withYear = true): string {
  return `${ord(dayNum(day))} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]}${withYear ? ` ${day.slice(0, 4)}` : ''}`;
}
/** « 1er nov. », « 8 nov. 2026 » (axes, tooltips, tight places). */
export function dayShort(day: string, withYear = false): string {
  return `${ord(dayNum(day))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}${withYear ? ` ${day.slice(0, 4)}` : ''}`;
}
/** « novembre 2026 » from « 2026-11 » or a day. */
export const monthLong = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** « nov. 2026 » from « 2026-11 » or a day. */
export const monthShort = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** « 19 h », « 0 h ». */
export const hour = (h: number) => `${((h % 24) + 24) % 24} h`;
/** « 19 h », « 19 h 30 » from « 19:30 » or (19, 30). */
export function hourMin(h: number | string, m = 0): string {
  if (typeof h === 'string') [h, m] = h.split(':').map(Number) as [number, number];
  return m ? `${h} h ${String(m).padStart(2, '0')}` : hour(h);
}
/** « 22 h – 7 h ». */
export const hourRange = (from: number | string, to: number | string) => `${hourMin(from)} – ${hourMin(to)}`;
/** « 2025–2026 » (season or winter starting in `y`). */
export const seasonLabel = (y: number) => `${y}–${y + 1}`;
/** Local calendar day (« YYYY-MM-DD »), never the UTC one of toISOString(). */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** An ISO instant (UTC) shown in local time: « 9 novembre 2026 à 13 h 05 ». */
export function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dayLong(localDay(d))} à ${hourMin(d.getHours(), d.getMinutes())}`;
}
/** « du 9 nov. 2025 au 8 nov. 2026 » (bounds of a period). */
export function rangeLabel(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `du ${dayShort(from, !sameYear)} au ${dayShort(to, true)}`;
}

// ------------------------------------------------------------------ comparisons (#310 review rule)
const isLastOfMonth = (day: string) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0));
  return d.getUTCDate() === dayNum(day);
};
/**
 * The reference of a year-over-year change, always explicit (never a bare « vs N-1 »):
 * « vs nov. 2025 au 8 », « vs nov. 2025 », « vs 2025 à date », « vs 2025 »,
 * « vs les 12 mois précédents », « vs la même période l'an dernier ».
 */
export function vsLabel(from: string, to: string): string {
  const y = Number(from.slice(0, 4)) - 1;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (sameMonth && dayNum(from) === 1) {
    return `vs ${MONTHS_SHORT[Number(from.slice(5, 7)) - 1]} ${y}${isLastOfMonth(to) ? '' : ` au ${dayNum(to)}`}`;
  }
  if (from.slice(5) === '01-01' && from.slice(0, 4) === to.slice(0, 4)) return `vs ${y}${to.slice(5) === '12-31' ? '' : ' à date'}`;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days >= 365 && days <= 366) return 'vs les 12 mois précédents';
  return "vs la même période l'an dernier";
}
/** No year-ago data to compare with. */
export const NO_REFERENCE = "pas de comparaison avec l'an dernier";
