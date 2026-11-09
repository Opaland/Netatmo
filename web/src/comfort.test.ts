import { describe, expect, it } from 'vitest';
import {
  type Night,
  co2Modules,
  dewPoint,
  effectiveMapping,
  heatedModules,
  hoursBelow,
  humidRuns,
  lastNights,
  nameSimilarity,
  nightVerdict,
  offsetAdvice,
  offsetStats,
  seasonOf,
  signed,
  suggestMapping,
  sumSeason,
  summarizeNights,
  wetStreak,
} from './comfort';

const MODULES = {
  m0: { name: 'Salon', type: 'NAMain', indoor: true },
  m1: { name: 'Extérieur', type: 'NAModule1', indoor: false },
  m2: { name: 'Chambre enfants', type: 'NAModule4', indoor: true },
  m3: { name: 'Cave', type: 'NAModule4', indoor: true },
};
const ROOMS = [
  { id: 'r-salon', name: 'Salon' },
  { id: 'r-ch1', name: 'Chambre parentale' },
  { id: 'r-ch2', name: 'Chambre enfant' },
  { id: 'r-bureau', name: 'Bureau' },
];

describe('dew point (Magnus)', () => {
  it('matches reference values', () => {
    expect(dewPoint(20, 50)!).toBeCloseTo(9.26, 1);
    expect(dewPoint(12, 80)!).toBeCloseTo(8.67, 1);
    expect(dewPoint(15, 100)!).toBeCloseTo(15, 5); // saturated air: dew point = temperature
  });
  it('rejects impossible humidity', () => {
    expect(dewPoint(20, 0)).toBeNull();
    expect(dewPoint(20, 120)).toBeNull();
  });
});

describe('modules', () => {
  it('keeps heated indoor rooms only, bedrooms first for CO₂', () => {
    expect(heatedModules(MODULES)).toEqual(['m0', 'm2']);
    expect(co2Modules(MODULES, { m0: {}, m2: {}, m3: {} })).toEqual(['m2', 'm0']);
    expect(co2Modules(MODULES, { m0: {} })).toEqual(['m0']);
  });
});

describe('night CO₂ (S-11.1)', () => {
  const full = (h1000: number, h1400: number, max: number): Night => ({ n: 9, co2_max: max, h_co2_1000: h1000, h_co2_1400: h1400, h_co2_1500: 0 });
  const nightly: Record<string, Night> = {
    '2026-11-01': full(8, 4, 1600),
    '2026-11-02': full(6, 0, 1300),
    '2026-11-04': full(0, 0, 900),
    '2026-11-05': { n: 3, co2_max: 1500, h_co2_1000: 3, h_co2_1400: 1, h_co2_1500: 1 },
  };
  it('selects the last nights, flags incomplete and missing ones', () => {
    const rows = lastNights(nightly, '2026-11-05', 5);
    expect(rows.map((r) => r?.day ?? null)).toEqual(['2026-11-01', '2026-11-02', null, '2026-11-04', '2026-11-05']);
    expect(rows[4]!.complete).toBe(false);
    expect(rows[0]!.complete).toBe(true);
  });
  it('counts complete nights only in the verdict', () => {
    const s = summarizeNights(lastNights(nightly, '2026-11-05', 5));
    expect(s).toMatchObject({ complete: 3, incomplete: 1, missing: 1, over1000: 2, over1400: 1, maxPpm: 1600 });
    const v = nightVerdict(s);
    expect(v.level).toBe('high'); // 1 of 3 nights
    expect(v.text).toMatch(/^1 nuit sur 3 au-dessus de 1 400 ppm : aérer avant le coucher/);
  });
  it('says when the air is fine', () => {
    const s = summarizeNights(lastNights({ '2026-11-04': full(0, 0, 900) }, '2026-11-04', 1));
    expect(nightVerdict(s).level).toBe('low');
    expect(nightVerdict(summarizeNights([])).text).toMatch(/Pas encore/);
  });
});

describe('cellar humidity (S-11.2)', () => {
  it('finds the longest and the current run above the threshold', () => {
    const daily: Record<string, (number | null)[]> = {};
    const hum = [72, 73, 71, 60, 75, 76, 74];
    hum.forEach((h, i) => (daily[`2026-11-0${i + 1}`] = [10, 12, 11, h, null]));
    expect(humidRuns(daily, 70, '2026-11-01', '2026-11-07')).toEqual({ longest: 3, longestEnd: '2026-11-03', current: 3 });
    // today not collected yet: the run is not broken
    expect(humidRuns(daily, 70, '2026-11-01', '2026-11-08').current).toBe(3);
  });
  it('counts the current streak of wet days from the hourly aggregates', () => {
    const hours = { '2026-11-01': { n: 24, humid: 5 }, '2026-11-02': { n: 24, humid: 20 }, '2026-11-03': { n: 24, humid: 12 } };
    expect(wetStreak(hours, '2026-11-03')).toBe(2);
    expect(wetStreak(hours, '2026-11-04')).toBe(2);
    expect(wetStreak(hours, '2026-11-01')).toBe(0);
  });
});

describe('hours under a threshold (S-11.3)', () => {
  const hourly = new Map<string, [number | null, number | null, number | null]>([
    ['2026-01-10T00', [18.4, 50, 600]],
    ['2026-01-10T01', [19.0, 50, 600]],
    ['2026-01-10T02', [17.2, 50, 600]],
    ['2026-01-10T03', [null, 50, 600]],
    ['2026-01-11T00', [20.5, 50, 600]],
    ['2026-06-11T00', [16.0, 50, 600]],
  ]);
  it('recomputes from hourly readings with a strict threshold', () => {
    const at19 = hoursBelow(hourly, 19);
    expect(at19.get('2026-01-10')).toEqual({ n: 3, cold: 2 }); // 19,0 is not below 19
    expect(at19.get('2026-01-11')).toEqual({ n: 1, cold: 0 });
    expect(hoursBelow(hourly, 18).get('2026-01-10')).toEqual({ n: 3, cold: 1 });
    expect(hoursBelow(hourly, 21).get('2026-01-11')).toEqual({ n: 1, cold: 1 });
  });
  it('sums a heating season (Nov–Mar) only', () => {
    expect(seasonOf('2026-01-10')).toBe(2025);
    expect(seasonOf('2025-11-02')).toBe(2025);
    expect(seasonOf('2026-06-11')).toBeNull();
    expect(sumSeason(hoursBelow(hourly, 19), 2025)).toEqual({ hours: 2, days: 1, n: 4 });
    expect(sumSeason(hoursBelow(hourly, 19), 2024)).toBeNull();
  });
});

describe('room ↔ module mapping (S-3.8)', () => {
  it('formats signed offsets without a negative zero', () => {
    expect(signed(-0.04)).toBe('0,0');
    expect(signed(0.26)).toBe('+0,3');
    expect(signed(-1.5)).toBe('−1,5');
  });
  it('scores names insensitive to case, accents and plurals', () => {
    expect(nameSimilarity('Chambre enfant', 'Chambre enfants')).toBe(1);
    expect(nameSimilarity('SALON', 'salon')).toBe(1);
    expect(nameSimilarity('Séjour', 'sejour')).toBe(1);
    expect(nameSimilarity('Chambre parentale', 'Chambre enfants')).toBeLessThan(0.6);
    expect(nameSimilarity('Bureau', 'Salon')).toBeLessThan(0.3);
  });
  it('suggests one module per room, best pairs first', () => {
    expect(suggestMapping(ROOMS, MODULES)).toEqual({ 'r-salon': 'm0', 'r-ch2': 'm2' });
  });
  it('lets saved choices win, including an explicit "none"', () => {
    const m = effectiveMapping(ROOMS, MODULES, { 'r-ch2': '', 'r-ch1': 'm2' });
    expect([...m]).toEqual([
      ['r-salon', 'm0'],
      ['r-ch1', 'm2'],
    ]);
    // a module that disappeared from the station is ignored
    expect(effectiveMapping(ROOMS, MODULES, { 'r-salon': 'm9' }).has('r-salon')).toBe(false);
  });
});

describe('radiator vs station offset (S-3.8)', () => {
  const build = (offset: (i: number) => number, n = 40) => {
    const radiator = new Map<string, [number, number | null]>();
    const station: Record<string, (number | null)[]> = {};
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      station[d] = [18, 21, 19.5, 50, 800];
      radiator.set(d, [19.5 + offset(i), 20]);
    }
    return { radiator, station };
  };
  it('detects a stable offset and suggests a setpoint shift', () => {
    const { radiator, station } = build((i) => 0.8 + (i % 2 ? 0.1 : -0.1));
    const o = offsetStats(radiator, station, '2025-12-01', '2026-02-09')!;
    expect(o.n).toBe(40);
    expect(o.mean).toBeCloseTo(0.8, 5);
    expect(o.stable).toBe(true);
    expect(o.months.map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    const advice = offsetAdvice(o, 19).join(' ');
    expect(advice).toMatch(/\+0,8 °C/);
    expect(advice).toMatch(/consigne vers 19,8 °C/);
    expect(advice).toMatch(/ne pilote pas/);
  });
  it('refuses to advise on a drifting offset', () => {
    const { radiator, station } = build((i) => (i < 20 ? -0.5 : 1.5));
    const o = offsetStats(radiator, station, '2025-12-01', '2026-02-09')!;
    expect(o.stable).toBe(false);
    expect(offsetAdvice(o).join(' ')).toMatch(/varie trop/);
    expect(o.months.find((m) => m.month === '2026-02')!.offset).toBeCloseTo(1.5, 5);
  });
  it('flags a probe to check above 1,5 °C over the last 30 days', () => {
    const { radiator, station } = build(() => 2);
    const o = offsetStats(radiator, station, '2025-12-01', '2026-02-09')!;
    expect(offsetAdvice(o)[0]).toMatch(/^Sonde à vérifier/);
  });
  it('ignores summer days and missing readings', () => {
    const radiator = new Map<string, [number, number | null]>([['2026-07-01', [25, null]]]);
    expect(offsetStats(radiator, { '2026-07-01': [20, 26, 24, 50, null] }, '2026-01-01', '2026-12-31')).toBeNull();
    expect(offsetStats(undefined, {}, '2026-01-01', '2026-12-31')).toBeNull();
  });
});
