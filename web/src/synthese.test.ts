// #290, #291, #292 on the real demo (web/public/demo, phrase « demo », last day 8 Nov 2026):
// the numbers of docs/design/audit-graphiques.md, constats 1 to 3.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type DayRecord, aggregate, total } from './aggregate';
import { NO_PRICES, projectYear } from './analysis';
import { historyCounted } from './history';
import type { Dataset } from './data';
import { demoDataset } from './__fixtures__/demo';

const h = vi.hoisted(() => ({ ds: null as unknown, state: null as unknown }));
vi.mock('./app', () => ({
  get ds() {
    return h.ds;
  },
  get state() {
    return h.state;
  },
  activeRooms: () => [],
  onLock: () => {},
}));
vi.mock('./charts', () => ({ cssVar: () => '', escapeHtml: (s: string) => s, waterfallChart: () => {}, fmtKwh: String }));
vi.mock('./tenant', () => ({ tenant: () => ({ on: false, leaseFrom: null, leaseTo: null }) }));

const { avgPrice, costOf } = await import('./ui');
const { EUROS_NOTE, linkyMonths, pmaxMonths, projectedCost, twelveMonths } = await import('./synthese');

let ds: Dataset;
const LAST = '2026-11-08';

beforeAll(async () => {
  ds = await demoDataset();
  h.ds = ds;
  h.state = { priceMode: 'trve', prices: NO_PRICES, contracts: [], contractLocalEdit: false, kva: 9 };
}, 60000);

const sumMonth = (m: { heat: Map<string, number>; water: Map<string, number> }, k: string) => (m.heat.get(k) ?? 0) + (m.water.get(k) ?? 0);
const all = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('#290: « 12 mois » is the same 365 days on the whole Synthèse', () => {
  it('the demo ends on 8 November 2026', () => {
    expect(ds.meta.last_day).toBe(LAST);
    expect(twelveMonths(LAST)).toEqual(['2025-11-09', '2026-11-08']);
  });

  it('nov. 2025 shows 581 kWh in the main chart and in the Linky card (758 before; 663 and 866 before the kitchen stove of the demo, #346)', () => {
    const [from, to] = twelveMonths(LAST);
    const main = aggregate(ds.records, from, to, 'month', (r) => r.cat);
    const i = main.keys.indexOf('2025-11');
    const mainNov = [...main.groups.values()].reduce((s, g) => s + (g[i] ?? 0), 0);
    expect(Math.round(mainNov)).toBe(581);
    const card = linkyMonths(ds.records, ds.linky, from, to);
    expect(card.keys).toHaveLength(13); // the partial November 2025 (9 → 30) first, as in the main chart
    expect(Math.round(sumMonth(card, '2025-11'))).toBe(581);
    expect(Math.round(all(card.heat))).toBe(Math.round(total(ds.records.filter((r) => r.cat === 'heating'), from, to)));
    expect(Math.round(all(card.heat))).toBe(4935);
    expect(Math.round(all(card.water))).toBe(1518);
    // the former window (from 1 November): 758 kWh and 5 077 kWh of heating
    const before = linkyMonths(ds.records, ds.linky, '2025-11-01', to);
    expect(Math.round(sumMonth(before, '2025-11'))).toBe(758);
    expect(Math.abs(all(before.heat) - 5077)).toBeLessThan(2); // the audit added the rounded bars
  });

  it('the peak power chart covers the same 12 months as its sentence', () => {
    const months = pmaxMonths(ds.pmax, ...twelveMonths(LAST));
    expect([...months.keys()][0]).toBe('2025-11');
    expect([...months.keys()].at(-1)).toBe('2026-11');
    for (const m of months.values()) expect(m.day >= '2025-11-09' && m.day <= LAST).toBe(true);
  });
});

describe('#291: the euros of a selection come from the selection', () => {
  const water = () => ds.records.filter((r: DayRecord) => r.cat === 'water_heater');

  it('water heater: 1 518 kWh = 250 € and the projection no longer says 283 €', () => {
    const recs = water();
    const [from, to] = twelveMonths(LAST);
    expect(Math.round(total(recs, from, to))).toBe(1518);
    expect(Math.round(costOf(recs, from, to)!)).toBe(250);
    const p = projectYear(recs, LAST)!;
    expect(Math.round(p.projected)).toBe(1520);
    // before: the whole home's average price
    expect(Math.round(p.projected * avgPrice()!)).toBe(283);
    // now: real cost so far + the rest at the water heater's own price (its off-peak kWh)
    expect(avgPrice(recs)!).toBeCloseTo(costOf(recs, from, to)! / total(recs, from, to), 10);
    const eur = projectedCost(costOf(recs, '2026-01-01', LAST), p.ytd, p.projected, avgPrice(recs))!;
    expect(eur).toBeGreaterThan(200);
    expect(eur).toBeLessThan(260);
  });

  it('without a filter, the year 2026 costs 891 € (energy only), the tooltip is an estimate (≈ 897 €)', () => {
    expect(Math.round(total(ds.records, '2026-01-01', LAST))).toBe(4819);
    expect(Math.round(costOf(ds.records, '2026-01-01', LAST)!)).toBe(891);
    expect(Math.round(4819 * avgPrice(ds.records)!)).toBe(897);
  });
});

describe('#292: what the euros cover', () => {
  it('Synthèse: energy only, no subscription, radiators and water heater', () => {
    expect(EUROS_NOTE).toMatch(/^euros : énergie seule, hors abonnement ;/);
    expect(historyCounted({ cat: 'all', rooms: 7, allRooms: 7 })).toMatch(/radiateurs et le chauffe-eau \(pas tout le logement\)/);
    expect(historyCounted({ cat: 'water_heater', rooms: 7, allRooms: 7 })).toMatch(/chauffe-eau seul/);
    // 1 133 € in Comparer and the report: the same energy plus the subscription
    expect(Math.round(costOf(ds.records, '2026-01-01', LAST, true)!)).toBe(1133);
  });
});
