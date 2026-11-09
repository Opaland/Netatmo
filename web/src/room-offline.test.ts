// #346: rooms without reading (« hors ligne »), their estimate from the meter, and the rooms left
// out of a comparison with last year. Small cases, then the demo (the kitchen offline since
// 14 October 2025, collector/demo.py OFFLINE_ROOM).
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { demoDataset } from './__fixtures__/demo';
import {
  displayEstimate,
  displayRuns,
  estimateOffline,
  estimatedIn,
  notComparable,
  offlineDaysIn,
  offlineRuns,
  offlineText,
  runIn,
} from './room-offline';

const rec = (day: string, room: string, kwh = 1): DayRecord => ({ day, room, kwh, cat: room === 'ce' ? 'water_heater' : 'heating' });
const ROOMS = [
  { id: 'a', category: 'heating' },
  { id: 'b', category: 'heating' },
  { id: 'ce', category: 'water_heater' },
];
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('offline runs', () => {
  it('2 days without reading while the others read make a run; 1 day does not', () => {
    const rs = [...days('2026-01-01', 10).flatMap((d) => [rec(d, 'a'), rec(d, 'ce')]), ...days('2026-01-01', 10).filter((d) => d !== '2026-01-03' && d < '2026-01-06').map((d) => rec(d, 'b'))];
    const runs = offlineRuns(rs, ROOMS, '2026-01-10');
    expect(runs).toEqual([{ room: 'b', from: '2026-01-06', to: '2026-01-10', days: 5, ongoing: true }]);
    expect(offlineText(runs[0])).toBe('hors ligne depuis le 6 janv. 2026');
  });

  it('a run that ended, days lost for every room skipped, a room followed from its first reading', () => {
    const all = days('2026-01-01', 20).filter((d) => d < '2026-01-12' || d > '2026-01-13'); // 12-13 lost for everyone
    const rs = [
      ...all.map((d) => rec(d, 'a')),
      ...all.filter((d) => d < '2026-01-10' || d > '2026-01-15').map((d) => rec(d, 'b')),
      ...all.filter((d) => d >= '2026-01-05').map((d) => rec(d, 'ce')), // installed on the 5th
    ];
    const runs = offlineRuns(rs, ROOMS, '2026-01-20');
    expect(runs).toEqual([{ room: 'b', from: '2026-01-10', to: '2026-01-15', days: 4, ongoing: false }]);
    expect(offlineText(runs[0])).toBe('hors ligne du 10 janv. au 15 janv. 2026');
    expect(offlineDaysIn(runs, 'b', '2026-01-14', '2026-01-31')).toBe(2);
    expect(runIn(runs, 'b', '2026-01-01', '2026-01-09')).toBeNull();
    expect(runIn(runs, 'b', '2026-01-15', '2026-01-31')?.from).toBe('2026-01-10');
  });

  it('ignored rooms and a single room give nothing', () => {
    expect(offlineRuns([rec('2026-01-01', 'a')], ROOMS, '2026-01-10')).toEqual([]);
    expect(offlineRuns([rec('2026-01-01', 'a'), rec('2026-01-05', 'x')], [...ROOMS, { id: 'x', category: 'ignore' }], '2026-01-10')).toEqual([]);
  });

  it('household view: the run carries the group id', () => {
    const runs = [{ room: 'b', from: '2026-01-06', to: '2026-01-10', days: 5, ongoing: true }];
    expect(displayRuns(runs, new Map([['b', 'chambres']]))[0].room).toBe('chambres');
    expect(displayRuns(runs)).toBe(runs);
  });

  it('a room offline in either window is left out of the comparison with last year', () => {
    const runs = [{ room: 'b', from: '2025-01-06', to: '2025-01-10', days: 5, ongoing: false }];
    expect([...notComparable(runs, '2026-01-01', '2026-01-31')]).toEqual(['b']);
    expect([...notComparable(runs, '2025-01-01', '2025-01-31')]).toEqual(['b']);
    expect([...notComparable(runs, '2026-02-01', '2026-02-28')]).toEqual([]);
  });
});

describe('estimate from the meter', () => {
  // 60 reference days, then 10 days with b offline: Linky = a + b + ce + other (2 + 0.5 × DJU)
  const ref = days('2025-11-01', 60);
  const off = days('2025-12-31', 10);
  const weather: Weather = new Map([...ref, ...off].map((d, i) => [d, [4 + (i % 7), 8 + (i % 7), 6 + (i % 7)]]));
  const djuOf = (d: string) => 18 - (weather.get(d)![0] + weather.get(d)![1]) / 2;
  const records: DayRecord[] = [];
  const linky = new Map<string, number>();
  for (const d of [...ref, ...off]) {
    const a = 0.5 * djuOf(d);
    const b = 0.25 * djuOf(d);
    records.push(rec(d, 'a', a), rec(d, 'ce', 3));
    if (ref.includes(d)) records.push(rec(d, 'b', b));
    linky.set(d, a + b + 3 + 2 + 0.5 * djuOf(d));
  }
  const runs = offlineRuns(records, ROOMS, off.at(-1)!);

  it('Linky − measured rooms − the usual other usages, fitted on the degree days', () => {
    expect(runs).toHaveLength(1);
    const est = estimateOffline(records, runs, linky, weather);
    expect(est.baseline?.a).toBeCloseTo(2, 6);
    expect(est.baseline?.b).toBeCloseTo(0.5, 6);
    const truth = off.reduce((s, d) => s + 0.25 * djuOf(d), 0);
    expect(estimatedIn(est, 'b', off[0], off.at(-1)!)).toBeCloseTo(truth, 6);
    expect(estimatedIn(est, 'a', off[0], off.at(-1)!)).toBeNull();
    expect(estimatedIn(displayEstimate(est, new Map([['b', 'g']])), 'g', off[0], off.at(-1)!)).toBeCloseTo(truth, 6);
  });

  it('nothing without the meter or without a month of reference', () => {
    expect(estimateOffline(records, runs, new Map(), weather).days.size).toBe(0);
    const short = records.filter((r) => r.day >= '2025-12-15');
    expect(estimateOffline(short, offlineRuns(short, ROOMS, off.at(-1)!), linky, weather).baseline).toBeNull();
  });

  it('never negative: a meter below the usual other usages gives 0', () => {
    const low = new Map([...linky].map(([d, v]) => [d, off.includes(d) ? v - 50 : v]));
    const est = estimateOffline(records, runs, low, weather);
    expect(estimatedIn(est, 'b', off[0], off.at(-1)!)).toBe(0);
  });
});

describe('on the demo: the kitchen offline since 14 October 2025', () => {
  it('found, ongoing, and estimated near what the meter saw (≈ 1.5 × its usual consumption)', async () => {
    const ds = await demoDataset();
    const last = ds.meta.last_day!;
    const runs = offlineRuns(ds.records, ds.meta.rooms, last);
    const kitchen = runs.filter((r) => r.room === 'r-cuisine');
    expect(kitchen.at(-1)).toMatchObject({ from: '2025-10-14', to: last, ongoing: true });
    expect(offlineText(kitchen.at(-1)!)).toBe('hors ligne depuis le 14 oct. 2025');
    // the November 2024 gap of the demo (two rooms, 14 days) is found as well, over
    expect(runs.some((r) => r.room === 'r-salon' && r.from === '2024-11-04' && !r.ongoing)).toBe(true);
    const est = estimateOffline(ds.records, runs, ds.linky, ds.weather);
    const jan = estimatedIn(est, 'r-cuisine', '2026-01-01', '2026-01-31')!;
    // January 2025 measured 170 kWh; colder January 2026, 1.5 × on its last local setting
    expect(jan).toBeGreaterThan(200);
    expect(jan).toBeLessThan(320);
  });
});
