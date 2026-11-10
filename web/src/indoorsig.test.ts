import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { MIN_DAYS, type StationDaily, fitWithCi, indoorModule, seasonSignatures, signatureDays, t975 } from './indoorsig';

describe('S-3.7 fit with 95 % intervals', () => {
  it('approximates the Student quantile', () => {
    expect(t975(10)).toBeCloseTo(2.228, 2);
    expect(t975(30)).toBeCloseTo(2.042, 2);
    expect(t975(1000)).toBeCloseTo(1.962, 2);
  });

  it('recovers slope and zero crossing, with intervals that contain them', () => {
    // kWh = 1.5 × (ΔT − 4) ± 0.8
    const pts: [number, number][] = [];
    for (let i = 0; i < 60; i++) {
      const x = 6 + (i % 15);
      pts.push([x, 1.5 * (x - 4) + (i % 2 ? 0.8 : -0.8)]);
    }
    const f = fitWithCi(pts)!;
    expect(f.slope).toBeCloseTo(1.5, 1);
    expect(f.threshold!).toBeCloseTo(4, 0);
    expect(f.slopeCi[0]).toBeLessThan(1.5);
    expect(f.slopeCi[1]).toBeGreaterThan(1.5);
    expect(f.thresholdCi![0]).toBeLessThan(4);
    expect(f.thresholdCi![1]).toBeGreaterThan(4);
    expect(f.r2).toBeGreaterThan(0.9);
  });

  it('refuses fewer than 30 days, and gives no threshold for a flat cloud', () => {
    const pts: [number, number][] = Array.from({ length: MIN_DAYS - 1 }, (_, i) => [i, 2 * i]);
    expect(fitWithCi(pts)).toBeNull();
    const flat: [number, number][] = Array.from({ length: 40 }, (_, i) => [i % 10, 5 + (i % 3)]);
    const f = fitWithCi(flat)!;
    expect(f.threshold).toBeNull();
    expect(f.thresholdCi).toBeNull();
  });
});

describe('S-3.7 indoor − outdoor points', () => {
  const st: StationDaily = {
    modules: {
      m0: { name: 'Salon', type: 'NAMain', indoor: true },
      m1: { name: 'Extérieur', type: 'NAModule1', indoor: false },
      m2: { name: 'Chambre', type: 'NAModule4', indoor: true },
      m3: { name: 'Cave', type: 'NAModule4', indoor: true },
    },
    daily: { m0: {}, m1: {}, m2: {} },
  };
  const records: DayRecord[] = [];
  for (let i = 0; i < 50; i++) {
    const d = addDays('2024-12-01', i);
    const tOut = 2 + (i % 10);
    const tIn = 19 + (i % 3) * 0.5;
    st.daily.m1[d] = [null, null, tOut, null, null];
    st.daily.m0[d] = [null, null, tIn, null, null];
    records.push({ day: d, room: 'salon', cat: 'heating', kwh: 2 * (tIn - tOut - 3) });
    records.push({ day: d, room: 'ch', cat: 'heating', kwh: 1 });
  }

  it('picks the module of the most consuming mapped room, else the main station', () => {
    expect(indoorModule(st, new Map([['ch', 'm2']]), records)).toBe('m2');
    // a module named « Cave » linked by the user to a heated room stands for that room
    expect(indoorModule(st, new Map([['salon', 'm3']]), records)).toBe('m3');
    // never the outdoor module, even if linked by mistake
    expect(indoorModule(st, new Map([['salon', 'm1']]), records)).toBe('m0');
    expect(indoorModule(st, new Map(), records)).toBe('m0');
    expect(indoorModule({ modules: { m1: st.modules.m1 }, daily: {} }, new Map(), records)).toBeNull();
  });

  it('fits both signatures on heating days, excluding uncertain days', () => {
    const only = records.filter((r) => r.room === 'salon');
    const days = signatureDays(only, null, st, 'm0', new Set(['2024-12-01']));
    const [s] = seasonSignatures(days);
    expect(s.season).toBe('2024-2025');
    expect(s.deltaDays).toBe(49);
    expect(s.delta!.slope).toBeCloseTo(2, 5);
    expect(s.delta!.threshold!).toBeCloseTo(3, 5);
    expect(s.outdoor!.slope).toBeLessThan(0);
  });

  it('says insufficient data under 30 days with an indoor reading', () => {
    const days = signatureDays(records.slice(0, 40), null, st, 'm0', new Set());
    const [s] = seasonSignatures(days);
    expect(s.deltaDays).toBe(20);
    expect(s.delta).toBeNull();
  });
});
