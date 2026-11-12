// #311 / #302: the figures of the new Accueil, as pure functions (tested in home.test.ts): one
// period for the whole screen (Mois · Saison · 12 mois · Année), the line that says what is
// counted, the verdict in euros with its one named reference, the projection to the end of the
// period, the rooms that counted and the monthly series of the chart (with the outdoor
// temperature). The view (views/home.ts) only lays them out.
import { type DayRecord, addDays, bucketKeys, minusYears, pctChange } from './aggregate';
import { type Verdict, type Weather, verdict } from './analysis';
import { MONTHS_LONG, MONTHS_SHORT, PERIOD, dayShort, seasonLabel, signedPct, withUnit } from './glossary';
import { daysBetween } from './periods';
import { woodIn } from './wood';
import { withWood } from './isolation';

export type HomePeriod = 'month' | 'season' | '12m' | 'year';
/** The segmented control of Accueil, in its order (the swipe on the header follows it). */
export const HOME_PERIODS: [HomePeriod, string][] = [
  ['month', 'Mois'],
  ['season', 'Saison'],
  ['12m', '12 mois'],
  ['year', 'Année'],
];
/** A remembered value from another version falls back to the month. */
export const homePeriod = (v: unknown): HomePeriod => (HOME_PERIODS.some(([k]) => k === v) ? (v as HomePeriod) : 'month');

const lastOfMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).toISOString().slice(0, 10);
const ord = (day: string) => (Number(day.slice(8, 10)) === 1 ? '1er' : String(Number(day.slice(8, 10))));

export interface HomeRange {
  period: HomePeriod;
  /** First and last day counted (the last day of the data at most). */
  from: string;
  to: string;
  /** Last day of the period once over (= `to` for the sliding 12 months). */
  end: string;
  /** Months of the chart (« 2026-01 »…), the future ones included (empty bars). */
  months: string[];
  /** First and last day of the chart. */
  chartFrom: string;
  chartTo: string;
}

/** The days of a period, on the last day of the data. */
export function homeRange(period: HomePeriod, last: string): HomeRange {
  const twelve = (): [string, string] => [addDays(minusYears(last), 1), last];
  let from: string;
  let end: string;
  let chart: [string, string];
  if (period === 'month') {
    from = `${last.slice(0, 8)}01`;
    end = lastOfMonth(last);
    // the month is put in context: the 12 months before it, the current one hatched (maquette)
    chart = twelve();
  } else if (period === 'season') {
    const y = Number(last.slice(5, 7)) >= 9 ? Number(last.slice(0, 4)) : Number(last.slice(0, 4)) - 1;
    from = `${y}-09-01`;
    end = `${y + 1}-08-31`;
    chart = [from, end];
  } else if (period === 'year') {
    from = `${last.slice(0, 4)}-01-01`;
    end = `${last.slice(0, 4)}-12-31`;
    chart = [from, end];
  } else {
    [from] = twelve();
    end = last;
    chart = twelve();
  }
  return { period, from, to: last, end, months: bucketKeys(chart[0], chart[1], 'month'), chartFrom: chart[0], chartTo: chart[1] };
}

/** « novembre » for the month, « la saison » … : what the verdict's figures cover, in a sentence. */
export function periodPhrase(r: HomeRange): string {
  const at = `au ${dayShort(r.to)}`;
  switch (r.period) {
    case 'month':
      return `en ${MONTHS_LONG[Number(r.to.slice(5, 7)) - 1]} (${r.to === r.end ? 'mois complet' : `au ${ord(r.to)}`})`;
    case 'season':
      return `depuis le 1er septembre (${at})`;
    case 'year':
      return `depuis le 1er janvier (${at})`;
    default:
      return 'sur les 12 derniers mois';
  }
}

/** Title of the scope line: « Novembre 2026, du 1er au 8 (8 jours sur 30) ». */
export function scopeTitle(r: HomeRange): string {
  const elapsed = daysBetween(r.from, r.to);
  const length = daysBetween(r.from, r.end);
  const days = r.to < r.end ? ` (${elapsed} jour${elapsed > 1 ? 's' : ''} sur ${length})` : '';
  switch (r.period) {
    case 'month': {
      const m = MONTHS_LONG[Number(r.to.slice(5, 7)) - 1];
      return `${m[0].toUpperCase()}${m.slice(1)} ${r.to.slice(0, 4)}, du 1er au ${ord(r.to)}${days}`;
    }
    case 'season':
      return `${PERIOD.season} ${seasonLabel(Number(r.from.slice(0, 4)))}, du 1er sept. au ${dayShort(r.to)}${days}`;
    case 'year':
      return `Année ${r.to.slice(0, 4)}, du 1er janv. au ${dayShort(r.to)}${days}`;
    default:
      return `${PERIOD['12m']}, du ${dayShort(r.from, true)} au ${dayShort(r.to, true)}`;
  }
}

/** What the figures count: « chauffage et eau chaude, hors abonnement », « chauffage seul · 3 pièces sur 7, en kWh ». */
/**
 * #466: what a total counts, by the category picked: « chauffage et eau chaude » unless one is
 * picked alone. The words of the scope line (countedLine) and of every total read as « the
 * heating » (the month tile of the Accueil, the figure of « Hiver contre hiver »): one place.
 */
export function countedWhat(cat: string): string {
  return cat === 'heating' ? 'chauffage seul' : cat === 'water_heater' ? 'eau chaude seule' : 'chauffage et eau chaude';
}

export function countedLine(o: { cat: string; rooms: number; allRooms: number; euros: boolean }): string {
  const what = countedWhat(o.cat);
  const rooms = o.rooms < o.allRooms ? ` · ${o.rooms} pièce${o.rooms > 1 ? 's' : ''} sur ${o.allRooms}` : '';
  return `${what}${rooms}, ${o.euros ? 'hors abonnement' : 'en kWh (prix à renseigner)'}`;
}

// ------------------------------------------------------------------ verdict in euros (#302)
export interface MoneyVerdict {
  level: Verdict['level'];
  /** Actual − expected, in euros (or kWh without prices). */
  gap: number;
  unit: '€' | 'kWh';
  actual: number;
  expected: number;
  kwh: number;
  pct: number;
  climate: boolean;
}

/**
 * The verdict of verdict() priced: the euros spent, and the expected kWh at the price paid over
 * the same days (the reference stays the one of verdict(): the same dates of the previous years,
 * at comparable weather when there is weather).
 */
export function moneyVerdict(v: Verdict, cost: number | null): MoneyVerdict {
  const price = cost !== null && v.actual > 0 ? cost / v.actual : null;
  if (price === null) return { level: v.level, gap: v.actual - v.expected, unit: 'kWh', actual: v.actual, expected: v.expected, kwh: v.actual, pct: v.pct, climate: v.climate };
  return { level: v.level, gap: (v.actual - v.expected) * price, unit: '€', actual: cost!, expected: v.expected * price, kwh: v.actual, pct: v.pct, climate: v.climate };
}

/** #433: the verdict of a scope, with the stove's wood when it counts. */
export interface HeatVerdict {
  v: Verdict | null;
  m: MoneyVerdict | null;
  /** The wood counted over [from, to] (null: not counted). */
  wood: { kwh: number; eur: number } | null;
  /** The records the verdict counted: the electricity, and the wood as day records. */
  records: DayRecord[];
}

/**
 * #433 (decision of the owner, option A): with a stove declared and wood bought, the verdict
 * compares the heating electricity + wood of the period to the one expected: the wood of each day
 * (`daily`, woodDaily: the degree-day split of « Hiver contre hiver » and « Expliquer un mois »)
 * is added to the electricity of that day, this year and in the reference years, so the heat moved
 * to the stove no longer reads as a saving. Euros: the electricity's cost (`cost`, null without
 * prices) plus the price of the wood; the expected kWh at the price paid for both. Without `daily`,
 * the verdict of the electricity alone, unchanged.
 */
export function heatVerdict(
  records: DayRecord[],
  from: string,
  to: string,
  weather: Weather | null,
  cost: number | null,
  daily: Map<string, [number, number]> | null,
): HeatVerdict {
  const first = records.reduce((a, r) => (!a || r.day < a ? r.day : a), '');
  const wood = daily ? woodIn(daily, from, to) : null;
  const counted = withWood(records, daily); // #460: the one rule of the wood as day records
  const v = verdict(counted, from, to, weather, first);
  const m = v ? moneyVerdict(v, cost === null ? null : cost + (wood?.eur ?? 0)) : null;
  return { v, m, wood, records: counted };
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const amount = (v: number, unit: '€' | 'kWh') => withUnit(nf0.format(Math.round(Math.abs(v))), unit);

/**
 * #383: the gap as written, from the two amounts as written (whole euros or kWh), so that
 * « 5 € de moins » is always the difference of the two figures written under it.
 */
export const writtenGap = (m: MoneyVerdict) => Math.round(m.actual) - Math.round(m.expected);

/** « 3 € de moins que d'habitude », « Comme d'habitude » under a euro (or a kWh). */
export function verdictHeadline(m: MoneyVerdict): string {
  const gap = writtenGap(m);
  if (gap === 0) return "Comme d'habitude";
  return `${amount(gap, m.unit)} de ${gap < 0 ? 'moins' : 'plus'} que d'habitude`;
}

/** « Chambre enfant », « Chambre enfant et Bureau », « A, B et C ». */
const andList = (a: string[]) => (a.length < 2 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} et ${a.at(-1)}`);

/** #383: the scope of the verdict when rooms are left out: « hors Chambre enfant, hors ligne ». */
export const leftOut = (left: string[]) => (left.length ? `hors ${andList(left)}, hors ligne` : '');

/** #433: what the verdict counts when the stove's wood is in it, after the amount (« 26 € d’électricité + bois »). */
export const WOOD_WORDS = 'd’électricité + bois';

export interface VerdictWords {
  headline: string;
  /** « 24 € » (in bold on screen). */
  spent: string;
  /** « (130 kWh) dépensés hors Chambre enfant, hors ligne, en novembre (au 8) ». */
  spentRest: string;
  /** « (130 kWh) dépensés », « d’électricité + bois (175 kWh) » (the screen inserts the scope, with its alert, before the period). */
  spentVerb: string;
  /** « 29 € ». */
  expectedAmount: string;
  /** « 29 € attendus à météo comparable (−16 %) ». */
  expected: string;
}

/**
 * #383: the words of the verdict — headline, spent, expected and % — all from `m`, over its
 * one scope, whose rooms left out are named (`left`). No other figure may enter: the spent
 * amount taken over all the rooms gave « 5 € de moins » over « 26 € pour 29 € (−16 %) ».
 */
export function verdictWords(m: MoneyVerdict, left: string[], phrase: string, ref: string, wood = false): VerdictWords {
  const out = leftOut(left);
  // #433: with the stove's wood, the spent amount says what it adds up (#311: no extra word, the screen holds in three)
  const verb = wood ? `${WOOD_WORDS}${m.unit === '€' ? ` (${amount(m.kwh, 'kWh')})` : ''}` : m.unit === '€' ? `(${amount(m.kwh, 'kWh')}) dépensés` : 'consommés';
  return {
    headline: verdictHeadline(m),
    spent: amount(m.actual, m.unit),
    spentRest: `${verb}${out ? ` ${out},` : ''} ${phrase}`,
    spentVerb: verb,
    expectedAmount: amount(m.expected, m.unit),
    expected: `${amount(m.expected, m.unit)} attendus ${ref} (${signedPct(m.pct)})`,
  };
}

/** The reference of the verdict, named the same way everywhere (verdict, month tile). */
export const expectedLabel = (climate: boolean) => (climate ? 'vs attendu à météo comparable' : 'vs attendu (moyenne des années passées)');

// ------------------------------------------------------------------ projection to the end of the period
/**
 * kWh still to come from the day after `to` to `end`, as in the previous years (up to four,
 * each entirely measured), times `ratio` (this period vs expected, kept between ½ and 2).
 * Null when no previous year covers those days.
 */
export function restOfPeriod(records: DayRecord[], to: string, end: string, firstDay: string, ratio = 1): number | null {
  if (to >= end) return 0;
  const from = addDays(to, 1);
  const refs: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const f = minusYears(from, k);
    const t = minusYears(end, k);
    if (f < firstDay) break;
    refs.push(records.reduce((s, r) => s + (r.day >= f && r.day <= t ? r.kwh : 0), 0));
  }
  if (!refs.length) return null;
  const r = Math.min(2, Math.max(0.5, Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  return (refs.reduce((a, b) => a + b, 0) / refs.length) * r;
}

// ------------------------------------------------------------------ what counted
export interface Counted {
  id: string;
  value: number;
  /** % of the total of the lines. */
  share: number;
  /** Change vs the same days one year earlier, % (null without reference). */
  change: number | null;
}

/**
 * Lines of « Ce qui a compté », largest first: their value over [from, to] (euros or kWh),
 * their share and their change vs the same days a year earlier.
 */
export function countedRows(ids: string[], valueOf: (id: string, from: string, to: string) => number, from: string, to: string): Counted[] {
  const rows = ids.map((id) => ({ id, value: valueOf(id, from, to), before: valueOf(id, minusYears(from), minusYears(to)) })).filter((r) => r.value > 0);
  const sum = rows.reduce((s, r) => s + r.value, 0);
  return rows
    .sort((a, b) => b.value - a.value)
    .map((r) => ({ id: r.id, value: r.value, share: sum ? (r.value / sum) * 100 : 0, change: pctChange(r.value, r.before) }));
}

/** « −19 % vs 2025 à date » (text, for a list row). */
export const changeText = (p: number | null, vs: string) => (p === null ? "pas de comparaison avec l'an dernier" : `${signedPct(p)} ${vs}`);

// ------------------------------------------------------------------ chart
/** Mean outdoor temperature of each month (null when none of its days was measured). */
export function monthlyOutdoor(weather: Weather | null, months: string[], to: string): (number | null)[] {
  if (!weather) return months.map(() => null);
  const acc = new Map<string, [number, number]>();
  for (const [d, w] of weather) {
    if (d > to) continue;
    const k = d.slice(0, 7);
    const a = acc.get(k);
    if (a) {
      a[0] += w[2];
      a[1]++;
    } else acc.set(k, [w[2], 1]);
  }
  return months.map((m) => {
    const a = acc.get(m);
    return a ? Math.round((a[0] / a[1]) * 10) / 10 : null;
  });
}

/** Short label of a month for the chart axis: « nov. », with the year on January and on the first bar. */
export const monthTick = (key: string, i: number) => `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]}${i === 0 || key.endsWith('-01') ? ` ${key.slice(0, 4)}` : ''}`;
