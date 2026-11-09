// One rule for « the price of a kWh » outside the day-by-day cost (#252): the standby base
// load (Linky), the invoice reconciliation, the water heater, the setpoint, the heat pump and
// the habits all ask the same question. Pure functions; ui.ts feeds them with the state
// (priceMode() already applies the shared contract and the tenant mode).
import { type PriceAt, type Prices, type TrveRow, hasPrices } from './analysis';

export interface HcHp {
  hc: number; // €/kWh, off-peak hours
  hp: number; // €/kWh, peak hours
  fixedYear: number; // € per year, subscription (0 when unknown)
  source: 'trve' | 'manual' | 'tenant';
}

export interface PriceInputs {
  /** priceMode() of ui.ts, and whether regulated offers are loaded. */
  trve: boolean;
  /** Regulated row in force that day under the contract of that day (null when none). */
  row: TrveRow | null;
  prices: Prices;
  tenant: boolean;
  /** Tariff column holding the off-peak kWh (offCol()). */
  off: 1 | 2;
}

/**
 * Manual prices as an off-peak / peak pair: the column detected as off-peak takes its
 * price, a missing one falls back on the single price (like energyCost). A tenant has one
 * average price for every kWh (S-12.6).
 */
export function manualHcHp(p: Prices, off: 1 | 2, tenant: boolean): HcHp | null {
  const fixedYear = (p.sub ?? 0) * 12;
  if (tenant) return p.base === null ? null : { hc: p.base, hp: p.base, fixedYear, source: 'tenant' };
  if (!hasPrices(p)) return null;
  const base = p.base ?? p.t1 ?? p.t2 ?? 0;
  const hc = (off === 1 ? p.t1 : p.t2) ?? base;
  const hp = (off === 1 ? p.t2 : p.t1) ?? base;
  return { hc, hp, fixedYear, source: 'manual' };
}

/** Off-peak / peak prices of one day under the price mode in force, or null when unknown. */
export function hcHp(i: PriceInputs): HcHp | null {
  if (i.trve && !i.tenant) return i.row ? { hc: i.row.hc, hp: i.row.hp, fixedYear: i.row.fixedYear, source: 'trve' } : null;
  return manualHcHp(i.prices, i.off, i.tenant);
}

/** Price of a kWh drawn evenly around the clock: 16 h at the peak price, 8 h off-peak. */
export const flatPrice = (p: { hc: number; hp: number }) => (16 * p.hp + 8 * p.hc) / 24;

/** Constant price row of the manual prices, for code that takes a PriceAt (invoice). */
export function manualPriceAt(p: HcHp | null): PriceAt {
  const row: TrveRow = { from: '0000-01-01', to: null, kva: 0, fixedYear: p?.fixedYear ?? 0, hc: p?.hc ?? 0, hp: p?.hp ?? 0 };
  return () => row;
}
