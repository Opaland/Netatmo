// #301: the figures of the Compteur tab (meter.ts), on small cases and on the demo
// (public/demo, last day 8 November 2026: the numbers of the maquette compteur.html).
import { describe, expect, it } from 'vitest';
import type { DayRecord } from './aggregate';
import { demoDataset } from './__fixtures__/demo';
import { homeRange } from './home';
import {
  coverage,
  coveredText,
  filterNote,
  kva,
  meterPeriod,
  offPeakShare,
  peakOf,
  periodShort,
  powerBuckets,
  powerVerdict,
  roundShares,
  standbyYear,
  usageBuckets,
  usageShare,
} from './meter';

const LAST = '2026-11-08';
const rec = (day: string, kwh: number, cat: DayRecord['cat'] = 'heating'): DayRecord => ({ day, kwh, cat, room: 'r' }) as DayRecord;

describe('period of the Compteur tab', () => {
  it('defaults to the 12 months of the maquette, keeps a known choice', () => {
    expect(meterPeriod(undefined)).toBe('12m');
    expect(meterPeriod('weekly')).toBe('12m');
    expect(meterPeriod('month')).toBe('month');
  });
  it('says the period in a few words on each card', () => {
    expect(periodShort('12m', LAST)).toBe('12 derniers mois, au 8 nov.');
    expect(periodShort('month', LAST)).toBe('nov. 2026, au 8 nov.');
    expect(periodShort('year', LAST)).toBe('2026, au 8 nov.');
  });
});

describe('what a card counts (#301)', () => {
  it('days of the period a source covers, written out', () => {
    const c = coverage(['2026-09-10T00:00', '2026-09-10T00:30', '2026-11-08T23:30', '2025-01-01T00:00'], '2025-11-09', LAST)!;
    expect(c).toEqual({ first: '2026-09-10', last: LAST, n: 2, of: 365 });
    expect(coveredText(c)).toBe('du 10 sept. au 8 nov. 2026 (2 jours sur 365)');
    expect(coveredText({ first: '2026-11-01', last: LAST, n: 8, of: 8 }, 'nuit')).toBe('du 1er nov. au 8 nov. 2026 (8 nuits)');
    expect(coverage([], '2026-01-01', LAST)).toBeNull();
  });
  it('names the room filter that does not apply to the meter', () => {
    expect(filterNote({ cat: 'all', catLabel: '', rooms: 7, allRooms: 7 })).toBe('');
    expect(filterNote({ cat: 'water_heater', catLabel: 'Eau chaude', rooms: 1, allRooms: 7 })).toBe(
      "Le filtre « Eau chaude · 1 pièce sur 7 » ne s'applique pas ici : le compteur mesure tout le logement.",
    );
  });
});

describe('share of the usages', () => {
  it('percentages add up to 100', () => {
    expect(roundShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundShares([5793, 1549, 3756]).reduce((a, b) => a + b)).toBe(100);
    expect(roundShares([0, 0])).toEqual([0, 0]);
  });
  it('counts the radiators only on the days the meter has, the rest is « autres »', () => {
    const linky = new Map([
      ['2026-11-01', 30],
      ['2026-11-02', 20],
    ]);
    const records = [rec('2026-11-01', 10), rec('2026-11-01', 5, 'water_heater'), rec('2026-11-02', 25), rec('2026-11-03', 99)];
    const b = usageBuckets(records, linky, '2026-11-01', LAST, 'day');
    expect(b.keys).toEqual(['2026-11-01', '2026-11-02']);
    expect(b.other).toEqual([15, 0]); // never negative
    const s = usageShare(usageBuckets(records, linky, '2026-11-01', LAST, 'month'))!;
    expect(s.total).toBe(50);
    expect(s.pct).toEqual([70, 10, 20]);
  });
});

describe('maximum power', () => {
  const pmax = new Map([
    ['2026-01-10', 9.1],
    ['2026-02-14', 10.2],
    ['2026-03-01', 8],
  ]);
  it('peak of the period and per month', () => {
    expect(peakOf(pmax, '2025-11-09', LAST)).toEqual({ max: 10.2, day: '2026-02-14' });
    expect(peakOf(pmax, '2026-11-01', LAST)).toBeNull();
    expect(powerBuckets(pmax, '2026-01-01', LAST, 'month')).toEqual({ keys: ['2026-01', '2026-02', '2026-03'], max: [9.1, 10.2, 8] });
  });
  it('subscribed vs used, in a plain sentence', () => {
    expect(kva(10.2)).toBe('10,2 kVA');
    const ok = powerVerdict(10.2, 12);
    expect(Math.round(ok.used)).toBe(85);
    expect(ok.text).toBe('Votre puissance est adaptée.');
    expect(powerVerdict(11.8, 12).level).toBe('tight');
    expect(powerVerdict(5, 12).level).toBe('wide');
  });
});

describe('off-peak share and standby', () => {
  it('off-peak column first or second, nothing without tariffs', () => {
    expect(offPeakShare([0, 36, 64, 5], 2)).toEqual({ offPeak: 64, peak: 36, none: 5, pct: 64 });
    expect(offPeakShare([0, 64, 36, 0], 1)!.pct).toBe(64);
    expect(offPeakShare([0, 0, 0, 10], 2)).toBeNull();
    expect(offPeakShare([0, 1, 1, 0], null)).toBeNull();
  });
  it('a constant power over a year', () => {
    expect(standbyYear(100, null)).toEqual({ kwh: 876, eur: null });
    expect(standbyYear(100, 0.2).eur).toBeCloseTo(175.2);
  });
});

describe('on the demo (maquette compteur.html)', () => {
  it('12 months: shares of the meter, peak against the subscribed power', async () => {
    const d = await demoDataset();
    const r = homeRange('12m', d.meta.last_day!);
    const s = usageShare(usageBuckets(d.records, d.linky, r.from, r.to, 'month'))!;
    expect(s.pct.reduce((a, b) => a + b)).toBe(100);
    expect(s.pct[0]).toBeGreaterThan(s.pct[1]); // heating first
    const p = peakOf(d.pmax, r.from, r.to)!;
    expect(p.max).toBeGreaterThan(5);
    expect(coverage(d.linky.keys(), r.from, r.to)!.n).toBeGreaterThan(300);
  });
});
