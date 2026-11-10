// #383 / #400: the figures of « où en suis-je ? », computed once for every screen that says them
// (the Accueil verdict and month tile, the vue Proche): one scope — the rooms out of reach over
// the period or a year earlier (#346) are left out of EVERY figure (spent, expected, gap, %,
// year-over-year) and named — so that two screens never give two numbers for one question.
import { type DayRecord, minusYears, pctChange, total } from '../aggregate';
import { type Verdict, verdict } from '../analysis';
import { ds } from '../app';
import { type MoneyVerdict, moneyVerdict } from '../home';
import { costAvailable, costOf, fmtEur, fmtKwh } from '../ui';
import { comparableRecords } from './offline-rooms';

export interface Money {
  value: number;
  unit: '€' | 'kWh';
  kwh: number;
}

/** Euros when prices are known, else kWh (every amount of the Accueil). */
export function money(records: DayRecord[], from: string, to: string): Money {
  const kwh = total(records, from, to);
  const eur = costAvailable() ? costOf(records, from, to) : null;
  return eur === null ? { value: kwh, unit: 'kWh', kwh } : { value: eur, unit: '€', kwh };
}
export const fmtMoney = (v: number, unit: '€' | 'kWh') => (unit === '€' ? fmtEur(v) : fmtKwh(v));

/** Change vs the same days a year earlier, in euros when both are priced, else in kWh. */
export function yoy(all: DayRecord[], from: string, to: string): number | null {
  if (!all.some((r) => r.day <= minusYears(to))) return null;
  const records = comparableRecords(all, from, to).records; // #346: a room no longer measured is not « en baisse »
  const now = money(records, from, to);
  const before = money(records, minusYears(from), minusYears(to));
  return now.unit === before.unit ? pctChange(now.value, before.value) : pctChange(now.kwh, before.kwh);
}

export interface Scope {
  /** The records counted: without the rooms left out. */
  records: DayRecord[];
  /** Names of the rooms left out (offline over the period or a year earlier). */
  left: string[];
  /** Spent over the period, on that scope. */
  spent: Money;
  /** The verdict against the previous years (null: no previous year yet). */
  v: Verdict | null;
  /** The same, priced: what the screens write. */
  m: MoneyVerdict | null;
}

/** The verdict of [from, to] as the Accueil says it, on its one scope. */
export function homeScope(all: DayRecord[], from: string, to: string): Scope {
  const cmp = comparableRecords(all, from, to);
  const spent = money(cmp.records, from, to);
  const v = verdict(cmp.records, from, to, ds!.weather);
  return { records: cmp.records, left: cmp.left, spent, v, m: v ? moneyVerdict(v, spent.unit === '€' ? spent.value : null) : null };
}
