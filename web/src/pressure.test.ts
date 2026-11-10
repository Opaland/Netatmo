import { describe, expect, it } from 'vitest';
import { mainKey, pressureSummary, trendOf } from './pressure';

const modules = { m0: { type: 'NAMain' }, m1: { type: 'NAModule1' } };

describe('pressure and noise (#220)', () => {
  it('reads the main module, with the trend and the outdoor temperature of each day', () => {
    const doc = {
      modules,
      pressure: { m0: { '2026-11-08': [1012.4, 1009, 1015, -6.1] as [number, number, number, number], '2026-11-07': [1018.5, 1016, 1021, null] as [number, number, number, null] } },
    };
    const weather = new Map([['2026-11-08', [2, 9, 5.5] as [number, number, number]]]);
    const s = pressureSummary(doc, weather, '2026-11-08', 3)!;
    expect(s.rows.map((r) => r.day)).toEqual(['2026-11-08', '2026-11-07', '2026-11-06']);
    expect(s.rows[0]).toMatchObject({ pressure: 1012.4, trend: -6.1, outdoor: 5.5, loud: null });
    expect(s.rows[2].pressure).toBeNull();
    expect(s.mean).toBeCloseTo((1012.4 + 1018.5) / 2, 6);
    expect(s.hasNoise).toBe(false);
    expect(s.meanLoud).toBeNull();
  });
  it('counts only the days whose noise was read in full', () => {
    const doc = { modules, noise: { m0: { '2026-11-08': { n: 9, loud: 0 }, '2026-11-07': { n: 24, loud: 3 }, '2026-11-06': { n: 23, loud: 5 } } } };
    const s = pressureSummary(doc, null, '2026-11-08')!;
    expect(s.hasNoise).toBe(true);
    expect(s.loudDays).toBe(2);
    expect(s.meanLoud).toBe(4);
    expect(s.mean).toBeNull();
  });
  it('is null without a main module or without data', () => {
    expect(pressureSummary(null, null, '2026-11-08')).toBeNull();
    expect(pressureSummary({ modules: { m1: { type: 'NAModule1' } } }, null, '2026-11-08')).toBeNull();
    expect(pressureSummary({ modules }, null, '2026-11-08')).toBeNull();
    expect(mainKey({ modules })).toBe('m0');
  });
  it('words the trend, stable within 1 hPa a day', () => {
    expect([trendOf(3), trendOf(-1), trendOf(0.9), trendOf(null), trendOf(undefined)]).toEqual(['up', 'down', 'stable', null, null]);
  });
});
