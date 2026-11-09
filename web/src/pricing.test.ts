import { describe, expect, it } from 'vitest';
import { NO_PRICES } from './analysis';
import { flatPrice, hcHp, manualHcHp, manualPriceAt } from './pricing';

const row = { from: '2025-08-01', to: null, kva: 9, fixedYear: 250, hc: 0.2068, hp: 0.27 };
const hphc = { ...NO_PRICES, t1: 0.27, t2: 0.2, sub: 15 }; // column $2 = off-peak

describe('one price rule (#252)', () => {
  it('official tariffs: the regulated row of the day, never the manual prices', () => {
    expect(hcHp({ trve: true, row, prices: hphc, tenant: false, off: 2 })).toEqual({ hc: 0.2068, hp: 0.27, fixedYear: 250, source: 'trve' });
    // no regulated row that day: unknown, not the manual prices of another mode
    expect(hcHp({ trve: true, row: null, prices: hphc, tenant: false, off: 2 })).toBeNull();
  });

  it('manual HP / HC prices follow the detected off-peak column', () => {
    expect(manualHcHp(hphc, 2, false)).toEqual({ hc: 0.2, hp: 0.27, fixedYear: 180, source: 'manual' });
    expect(manualHcHp(hphc, 1, false)).toMatchObject({ hc: 0.27, hp: 0.2 });
    // a single price fills the missing column, like energyCost
    expect(manualHcHp({ ...NO_PRICES, base: 0.25, t2: 0.2 }, 2, false)).toMatchObject({ hc: 0.2, hp: 0.25 });
    expect(manualHcHp(NO_PRICES, 2, false)).toBeNull();
  });

  it('a standby load is priced 16 h at the peak price and 8 h off-peak, not 50/50', () => {
    const p = hcHp({ trve: false, row: null, prices: hphc, tenant: false, off: 2 })!;
    expect(flatPrice(p)).toBeCloseTo((16 * 0.27 + 8 * 0.2) / 24, 10); // 0.2467, not 0.235
    expect(flatPrice(p)).not.toBeCloseTo(0.235, 3);
  });

  it('tenant: one average price for every kWh, whatever the mode or the HP / HC prices', () => {
    const prices = { ...hphc, base: 0.2516 };
    expect(hcHp({ trve: true, row, prices, tenant: true, off: 2 })).toEqual({ hc: 0.2516, hp: 0.2516, fixedYear: 180, source: 'tenant' });
    expect(hcHp({ trve: false, row: null, prices: hphc, tenant: true, off: 2 })).toBeNull(); // no average price typed
  });

  it('a constant price row for the invoice reconciliation', () => {
    const at = manualPriceAt(manualHcHp(hphc, 2, false));
    expect(at('2024-01-01')).toMatchObject({ hc: 0.2, hp: 0.27, fixedYear: 180 });
    expect(manualPriceAt(null)('2024-01-01')).toMatchObject({ hc: 0, hp: 0, fixedYear: 0 });
  });
});
