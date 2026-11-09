// ui.ts price helpers against a small dataset: price mode (shared contract, manual, tenant)
// and the memoised costs (#252, #256). The app, the charts and the tenant setting are stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayRecord } from './aggregate';
import { NO_PRICES, type Prices } from './analysis';

const h = vi.hoisted(() => ({
  ds: null as unknown,
  state: null as unknown,
  tenant: { on: false, leaseFrom: null, leaseTo: null },
  energyCost: 0,
}));

vi.mock('./app', () => ({
  get ds() {
    return h.ds;
  },
  get state() {
    return h.state;
  },
  activeRooms: () => [],
}));
vi.mock('./charts', () => ({ cssVar: () => '', escapeHtml: (s: string) => s, waterfallChart: () => {}, fmtKwh: String }));
vi.mock('./tenant', () => ({ tenant: () => h.tenant }));
vi.mock('./analysis', async (importOriginal) => {
  const m = await importOriginal<typeof import('./analysis')>();
  return {
    ...m,
    energyCost: (...a: Parameters<typeof m.energyCost>) => {
      h.energyCost++;
      return m.energyCost(...a);
    },
  };
});

const { avgPrice, costOf, dayPrices, eurOf, flatPriceAt, hcHpAt, priceMode } = await import('./ui');

const row = { from: '2020-01-01', to: null, kva: 9, fixedYear: 240, hc: 0.2, hp: 0.3 };
const shared = [{ from: '2024-01-01', offer: 'edf-trv-hphc', kva: 9 }];
const records: DayRecord[] = Array.from({ length: 10 }, (_, i) => ({
  day: `2025-01-${String(i + 1).padStart(2, '0')}`,
  room: 'r1',
  cat: 'heating',
  kwh: 10,
})) as DayRecord[];
const hphc: Prices = { ...NO_PRICES, t1: 0.27, t2: 0.2 };

function setup(o: { contract?: unknown; mode: 'trve' | 'manual'; prices: Prices; tenant?: boolean }) {
  h.ds = {
    meta: { contract: o.contract, first_day: '2024-01-01', last_day: '2025-01-10', rooms: [] },
    records,
    tariffs: new Map(),
    offers: new Map([['edf-trv-hphc', [row]]]),
  };
  h.state = { priceMode: o.mode, prices: o.prices, contracts: [], contractLocalEdit: false, kva: 9 };
  h.tenant = { on: !!o.tenant, leaseFrom: null, leaseTo: null };
}

beforeEach(() => {
  h.energyCost = 0;
});

describe('price of a kWh outside the daily cost (#252)', () => {
  it('a shared contract means the official tariffs, even with manual prices chosen earlier here', () => {
    setup({ contract: shared, mode: 'manual', prices: hphc });
    expect(priceMode()).toBe('trve');
    expect(hcHpAt('2025-01-10')).toMatchObject({ hc: 0.2, hp: 0.3, source: 'trve' });
    expect(flatPriceAt('2025-01-10')).toBeCloseTo((16 * 0.3 + 8 * 0.2) / 24, 10);
    expect(dayPrices()('2025-01-10')).toBe(row);
  });

  it('manual HP / HC prices: 16 h peak and 8 h off-peak', () => {
    setup({ mode: 'manual', prices: hphc });
    expect(hcHpAt('2025-01-10')).toMatchObject({ hc: 0.2, hp: 0.27, source: 'manual' });
    expect(flatPriceAt('2025-01-10')).toBeCloseTo((16 * 0.27 + 8 * 0.2) / 24, 10);
  });

  it('tenant mode: the average price, never the holder’s contract', () => {
    setup({ contract: shared, mode: 'trve', prices: { ...hphc, base: 0.25 }, tenant: true });
    expect(priceMode()).toBe('manual');
    expect(hcHpAt('2025-01-10')).toMatchObject({ hc: 0.25, hp: 0.25, source: 'tenant' });
    expect(flatPriceAt('2025-01-10')).toBeCloseTo(0.25, 10);
    expect(dayPrices()('2025-01-10')).toMatchObject({ hc: 0.25, hp: 0.25 });
  });
});

describe('costs computed once per render (#256)', () => {
  it('the same records and range are costed once, until a price changes', () => {
    setup({ mode: 'manual', prices: { ...NO_PRICES, base: 0.2 } });
    const first = costOf(records, '2025-01-01', '2025-01-10');
    expect(first).toBeCloseTo(20, 10);
    expect(eurOf(records, '2025-01-01', '2025-01-10')).toBe('20 €');
    expect(eurOf(records, '2025-01-01', '2025-01-10')).toBe('20 €');
    expect(h.energyCost).toBe(1);
    (h.state as { prices: Prices }).prices = { ...NO_PRICES, base: 0.3 };
    expect(costOf(records, '2025-01-01', '2025-01-10')).toBeCloseTo(30, 10);
    expect(h.energyCost).toBe(2);
  });

  it('avgPrice is computed once for the tiles, the charts and the verdict', () => {
    setup({ mode: 'manual', prices: { ...NO_PRICES, base: 0.2 } });
    for (let i = 0; i < 5; i++) expect(avgPrice()).toBeCloseTo(0.2, 10);
    expect(h.energyCost).toBe(1);
  });
});
