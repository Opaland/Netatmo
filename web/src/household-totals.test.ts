// v1.5: the household view is a DISPLAY transformation. Every figure computed by the app
// (kWh, €, HP/HC split, lost / estimated days, signature, reconstitution) must be the same with
// and without « Chambres » (issues #238, #239, #241, #243, #248).
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { type TrveRow, anomalies, daySplits, energyCost, energyCostTrve, offPeakColumn, offPeakShares, tariffSplit } from './analysis';
import { computeCoverage, gapMonths, uncertainDays } from './checks';
import { coldSensors } from './cold';
import type { Dataset } from './data';
import { BEDROOMS_ID, displaySurfaces, householdView, translateRooms } from './household';
import { lostDays, rebuildLost, suspectDays } from './reconstitute';
import { demoDataset } from './__fixtures__/demo';

const round = (v: number, n = 6) => Math.round(v * 10 ** n) / 10 ** n;

/** Everything the app computes from the records, as plain numbers. */
function totals(d: Dataset, raw: Dataset) {
  const water = raw.meta.rooms.filter((r) => r.category === 'water_heater').map((r) => r.id);
  const off = offPeakColumn(d.tariffs, water) ?? 2;
  const shares = offPeakShares(d.tariffs, off);
  const row: TrveRow = { from: '2000-01-01', to: null, kva: 9, fixedYear: 0, hc: 0.2, hp: 0.25 };
  const trve = energyCostTrve(d.records, d.tariffs, () => row, 9, off, shares);
  const splits = daySplits(d.records, d.tariffs, off, shares, d.linky.size ? d.linky : null);
  const last = d.meta.last_day!;
  const uncertain = uncertainDays(d.records, d.estimated, '0000-01-01', last);
  const opts = { weather: d.weather, linky: d.linky, estimated: d.estimated };
  const rebuilt = rebuildLost(d.records, opts);
  const cov = d.coverage ?? computeCoverage(d.records, d.estimated, last);
  return {
    kwh: round(d.records.reduce((s, r) => s + r.kwh, 0)),
    eurManual: round(energyCost(d.records, d.tariffs, { base: 0.22, t1: 0.25, t2: 0.2, sub: null })),
    eurTrve: round(trve.energy),
    kwhPricedWithEstimatedSplit: round(trve.estimatedKwh),
    tariffSplit: tariffSplit(d.records, d.tariffs).map((v) => round(v)),
    hc: round(splits.reduce((s, x) => s + x.hc, 0)),
    hp: round(splits.reduce((s, x) => s + x.hp, 0)),
    uncertainDays: [...uncertain].sort(),
    lostDays: [...lostDays(d.records).keys()].sort(),
    // months with an estimated or missing day, and the worst count of each (days, not room-days)
    gapMonths: gapMonths(cov).map((g) => [g.month, g.estimated, g.missing]),
    anomalies: d.weather ? anomalies(d.records, d.weather, uncertain).map((a) => a.day) : [],
    rebuilt: rebuilt.map((r) => [r.day, round(r.kwh, 3)]),
    suspects: suspectDays(d.records, opts).map((s) => s.day),
  };
}

/** Months of the gap list may differ in their worst count per room, never in their set. */
const comparable = (t: ReturnType<typeof totals>) => ({ ...t, gapMonths: t.gapMonths.map((g) => g[0]) });

function synthetic(): Dataset {
  return {
    source: 'demo',
    key: {} as CryptoKey,
    meta: {
      home: { id: 'h', name: 'Maison', timezone: 'Europe/Paris' },
      rooms: [
        { id: 's', name: 'Salon', category: 'heating', module_types: ['NMH'] },
        { id: 'c1', name: 'Chambre 1', category: 'heating', module_types: ['NMH'] },
        { id: 'c2', name: 'Chambre 2', category: 'heating', module_types: ['NMH'] },
        { id: 'w', name: 'Chauffe-eau', category: 'water_heater', module_types: ['NLC'] },
      ],
      years: [2025],
      first_day: '2025-01-01',
      last_day: '2025-01-03',
      updated: '',
    },
    records: [],
    tariffs: new Map(),
    temps: new Map(),
    weather: null,
    indoor: new Map(),
    linky: new Map(),
    insights: null,
    estimated: new Set(),
    coverage: null,
    trve: [],
    offers: new Map(),
    pmax: new Map(),
    tempo: { rows: [], days: new Map() },
    station: null,
  };
}
const rec = (day: string, room: string, kwh: number): DayRecord => ({ day, room, cat: room === 'w' ? 'water_heater' : 'heating', kwh });

describe('household view: same figures with and without « Chambres »', () => {
  it('on the demo dataset', async () => {
    const raw = await demoDataset();
    const v = householdView(raw);
    expect(v.records.some((r) => r.room === BEDROOMS_ID)).toBe(true);
    expect(totals(v, raw)).toEqual(totals(raw, raw));
  }, 60000);

  it('on the demo dataset with a bedroom lost, estimated and without tariff detail', async () => {
    const demo = await demoDataset();
    const ch1 = demo.meta.rooms.find((r) => r.name === 'Chambre parentale')!.id;
    const ch2 = demo.meta.rooms.find((r) => r.name === 'Chambre enfant')!.id;
    // #239: Chambre parentale lost from 3 to 9 February 2026; #238: Chambre enfant estimated
    // (no tariff detail) all January 2026
    const lost = (r: DayRecord) => r.room === ch1 && r.day >= '2026-02-03' && r.day <= '2026-02-09';
    const tariffs = new Map(demo.tariffs);
    tariffs.set(ch2, new Map([...(demo.tariffs.get(ch2) ?? [])].filter(([d]) => !d.startsWith('2026-01'))));
    const estimated = new Set(demo.estimated);
    for (let d = '2026-01-01'; d <= '2026-01-31'; d = addDays(d, 1)) estimated.add(`${ch2}|${d}`);
    const raw: Dataset = { ...demo, records: demo.records.filter((r) => !lost(r)), tariffs, estimated, coverage: null };
    const t = totals(raw, raw);
    expect(t.lostDays).toContain('2026-02-05');
    expect(t.uncertainDays).toContain('2026-01-15');
    expect(comparable(totals(householdView(raw), raw))).toEqual(comparable(t));
  }, 60000);

  it('#238: a bedroom without tariff detail (estimated day) keeps its kWh in the cost and the HP/HC split', () => {
    const raw = synthetic();
    raw.records = [rec('2025-01-01', 'c1', 2), rec('2025-01-01', 'c2', 3), rec('2025-01-01', 'w', 4)];
    raw.tariffs = new Map([
      ['c1', new Map([['2025-01-01', [0, 1, 1] as [number, number, number]]])],
      ['w', new Map([['2025-01-01', [0, 0.5, 3.5] as [number, number, number]]])],
    ]);
    raw.estimated = new Set(['c2|2025-01-01']);
    raw.meta.last_day = '2025-01-01';
    const v = householdView(raw);
    const a = totals(raw, raw);
    const b = totals(v, raw);
    expect(b).toEqual(a);
    expect(a.tariffSplit).toEqual([0, 1.5, 4.5, 3]); // the 3 kWh of Chambre 2 are there
    expect(a.kwhPricedWithEstimatedSplit).toBe(3);
  });

  it('#239: a lost bedroom day stays a lost (uncertain) day of « Chambres »', () => {
    const raw = synthetic();
    for (const d of ['2025-01-01', '2025-01-02', '2025-01-03']) {
      raw.records.push(rec(d, 's', 5), rec(d, 'c2', 3));
      if (d !== '2025-01-02') raw.records.push(rec(d, 'c1', 2));
    }
    const v = householdView(raw);
    expect(v.records.filter((r) => r.room === BEDROOMS_ID).map((r) => r.kwh)).toEqual([5, 3, 5]);
    expect(uncertainDays(v.records, v.estimated, '2025-01-01', '2025-01-03')).toEqual(new Set(['2025-01-02']));
    expect([...lostDays(v.records)]).toEqual([['2025-01-02', new Set(['c1'])]]);
    // the group's coverage counts days: 2 real, 1 missing
    expect(v.coverage!.get(BEDROOMS_ID)!.get('2025-01')).toEqual([2, 0, 1]);
    expect(totals(v, raw)).toEqual(totals(raw, raw));
  });

  it('#239: coverage of « Chambres » counts calendar days, any bedroom estimated or lost', () => {
    const raw = synthetic();
    raw.meta.last_day = '2025-01-04';
    for (const d of ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04']) {
      if (d !== '2025-01-03') raw.records.push(rec(d, 'c1', 2));
      if (d !== '2025-01-04') raw.records.push(rec(d, 'c2', 3));
    }
    raw.estimated = new Set(['c2|2025-01-02']);
    const v = householdView(raw);
    // 01: real; 02: estimated (c2); 03: missing (c1); 04: missing (c2)
    expect(v.coverage!.get(BEDROOMS_ID)!.get('2025-01')).toEqual([1, 1, 2]);
  });
});

describe('household view: display only', () => {
  it('#248: setpoint and temperature of « Chambres » on the same bedrooms', () => {
    const raw = synthetic();
    raw.temps = new Map([
      ['c1', new Map<string, [number, number | null]>([['2025-01-01', [17, 17]], ['2025-01-02', [17, 17]], ['2025-01-03', [17, 17]]])],
      ['c2', new Map<string, [number, number | null]>([['2025-01-01', [21, null]], ['2025-01-03', [21, 19]]])],
    ]);
    const g = householdView(raw).temps.get(BEDROOMS_ID)!;
    expect(g.get('2025-01-01')).toEqual([19, 17]); // a bedroom without setpoint does not erase the other
    expect(g.has('2025-01-02')).toBe(false); // Chambre 2 not measured: no mean of a different set
    expect(g.get('2025-01-03')).toEqual([19, 18]);
  });

  it('#243: surfaces stay by raw id, « Chambres » is the sum of its bedrooms', () => {
    const raw = synthetic();
    raw.records = [rec('2025-01-01', 's', 5), rec('2025-01-01', 'c1', 2), rec('2025-01-01', 'c2', 3)];
    const v = householdView(raw);
    expect(displaySurfaces(v, { s: 30, c1: 12, c2: 10.5 })).toEqual({ s: 30, c1: 12, c2: 10.5, [BEDROOMS_ID]: 22.5 });
    expect(displaySurfaces(v, { s: 30, c1: 12 })[BEDROOMS_ID]).toBeUndefined(); // one bedroom unknown
    expect(displaySurfaces(raw, { s: 30, c1: 12 })).toEqual({ s: 30, c1: 12 });
  });

  it('#243: a room filter follows the grouping instead of losing the bedrooms', () => {
    const raw = synthetic();
    raw.records = [rec('2025-01-01', 's', 5), rec('2025-01-01', 'c1', 2), rec('2025-01-01', 'c2', 3)];
    const v = householdView(raw);
    expect(translateRooms(['c1', 's'], v, raw.meta.rooms)).toEqual([BEDROOMS_ID, 's']);
    expect(translateRooms([BEDROOMS_ID, 's'], raw, raw.meta.rooms)).toEqual(['c1', 'c2', 's']);
    expect(translateRooms(['s'], raw, raw.meta.rooms)).toEqual(['s']);
  });

  it('#242: the cold alert lists raw rooms and modules, never « Chambres »', () => {
    const raw = synthetic();
    raw.records = [rec('2025-01-01', 's', 5), rec('2025-01-01', 'c1', 2)];
    raw.temps = new Map([
      ['s', new Map<string, [number, number | null]>([['2025-01-01', [20, 20]]])],
      ['c1', new Map<string, [number, number | null]>([['2025-01-01', [12, 19]]])],
    ]);
    raw.station = {
      modules: { m1: { name: 'Chambre 2', type: 'NAModule4', indoor: true }, m2: { name: 'Salon', type: 'NAMain', indoor: true } },
      daily: { m1: { '2025-01-01': [11, 13, 12, null, null] }, m2: { '2025-01-01': [19, 21, 20, null, null] } },
    };
    const ids = coldSensors(raw).map((s) => s.id);
    expect(ids).toEqual(['s', 'c1', 'm1', 'm2']);
    expect(coldSensors(raw).find((s) => s.id === 'c1')!.means.get('2025-01-01')).toBe(12);
    // the household view would only offer the group: the alert must be built on the raw dataset
    expect(coldSensors(householdView(raw)).map((s) => s.id)).toContain(BEDROOMS_ID);
  });
});
