// Pure helpers for the money / impact cards (v1.3):
// S-2.12 annual budget, S-2.13 CO₂ footprint, S-2.11 new regulated tariff.
// Preferences are per device (localStorage), like the other display settings.
import { addDays } from './aggregate';
import type { TrveRow } from './analysis';

// ------------------------------------------------------------------ preferences (per device)
export const LS_BUDGET = 'intuis-history:budget';
export const LS_CO2 = 'intuis-history:co2-factor';
export const LS_GRID_SEEN = 'intuis-history:grid-seen';

function readNumber(key: string, ok: (v: number) => boolean): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) && ok(v) ? v : null;
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the value lasts until the next reload */
  }
}
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Annual budget (€, heating + hot water, energy only), null when not set. */
export const budgetPref = () => readNumber(LS_BUDGET, (v) => v > 0 && v < 1e6);

// ------------------------------------------------------------------ S-2.12 budget
export interface BudgetStatus {
  spent: number; // € since 1 January
  projected: number; // € expected on 31 December
  budget: number;
  gap: number; // projected − budget (positive: above)
  over: boolean;
  toDate: number; // budget share expected to be spent by now, from the usual seasonal profile
  method: 'profile' | 'prorata';
}

/**
 * Projected spending: what is already spent, plus the kWh still expected this year
 * (year-end projection of the consumption) at the average price paid so far. Without
 * previous years, prorata of the days elapsed.
 */
export function budgetStatus(
  budget: number,
  spent: number,
  ytdKwh: number,
  projectedKwh: number | null,
  dayOfYear: number,
  daysInYear: number,
): BudgetStatus {
  let projected: number;
  let share: number;
  let method: BudgetStatus['method'];
  if (projectedKwh !== null && ytdKwh > 0 && projectedKwh >= ytdKwh) {
    const price = spent / ytdKwh;
    projected = spent + (projectedKwh - ytdKwh) * price;
    share = ytdKwh / projectedKwh;
    method = 'profile';
  } else {
    share = Math.min(1, dayOfYear / daysInYear);
    projected = share > 0 ? spent / share : spent;
    method = 'prorata';
  }
  const gap = projected - budget;
  return { spent, projected, budget, gap, over: gap > 0, toDate: budget * share, method };
}

// ------------------------------------------------------------------ S-2.13 CO₂
/**
 * Default factor: French average electricity mix, consumption, about 0.052 kgCO₂e/kWh
 * (ADEME Base Empreinte, value to check against the current edition). The ADEME
 * "chauffage" usage factor is higher (about 0.079): the user can type it.
 */
export const CO2_DEFAULT = 0.052;
export const CO2_SOURCE = 'ADEME Base Empreinte, électricité, mix moyen France (consommation), valeur à vérifier';
export const co2Factor = () => readNumber(LS_CO2, (v) => v > 0 && v < 2) ?? CO2_DEFAULT;
export const co2Custom = () => co2Factor() !== CO2_DEFAULT;
/** kgCO₂e for this energy. */
export const co2Of = (kwh: number, factor = co2Factor()) => kwh * factor;
export function fmtCo2(kg: number): string {
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: kg < 10 ? 1 : 0 });
  return kg >= 1000 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(kg / 1000)} tCO₂e` : `${nf.format(kg)} kgCO₂e`;
}
export const fmtFactor = (f: number) => `${f.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} kgCO₂e/kWh`;

// ------------------------------------------------------------------ S-2.11 new regulated tariff
export const GRID_WINDOW_DAYS = 180;

/**
 * The latest grid of this offer and power, with the one it replaces, when it starts
 * after `lastDay - window` (announced in advance, or applied recently). Null when there
 * is no such change or when prices did not move.
 */
export function newGrid(rows: TrveRow[], kva: number, lastDay: string, windowDays = GRID_WINDOW_DAYS): { prev: TrveRow; next: TrveRow } | null {
  const mine = rows.filter((r) => r.kva === kva).sort((a, b) => (a.from < b.from ? -1 : 1));
  if (mine.length < 2) return null;
  const next = mine[mine.length - 1];
  const prev = mine[mine.length - 2];
  if (next.from <= addDays(lastDay, -windowDays)) return null;
  if (next.hc === prev.hc && next.hp === prev.hp && next.fixedYear === prev.fixedYear) return null;
  return { prev, next };
}

export interface GridImpact {
  energy: number; // € per year, new − old
  subscription: number; // € per year, new − old
  total: number;
  pct: number | null; // vs the old grid
  oldCost: number;
}

/** Year of consumption priced at both grids: energy costs come from the caller (same kWh, same HP/HC split). */
export function gridImpact(oldEnergy: number, newEnergy: number, prev: TrveRow, next: TrveRow): GridImpact {
  const energy = newEnergy - oldEnergy;
  const subscription = next.fixedYear - prev.fixedYear;
  const oldCost = oldEnergy + prev.fixedYear;
  const total = energy + subscription;
  return { energy, subscription, total, pct: oldCost > 0 ? (total / oldCost) * 100 : null, oldCost };
}
