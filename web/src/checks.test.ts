import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { TariffMap, Weather } from './analysis';
import {
  computeCoverage,
  gapMonths,
  hcVerdict,
  hourByMonth,
  peakExtraCost,
  referenceSeason,
  roomShares,
  simulateSetpoint,
  uncertainDays,
  waterHeaterHc,
} from './checks';

describe('S-2.10 water heater off-peak share', () => {
  const tariffs: TariffMap = new Map([
    [
      'wh',
      new Map<string, [number, number, number]>([
        ['2025-01-10', [0, 0.5, 4.5]], // $2 = off-peak
        ['2025-01-11', [0, 0.5, 4.5]],
        ['2025-02-01', [0, 2, 3]],
        ['2025-03-01', [3, 0, 0]], // no tariff detail: ignored
      ]),
    ],
    ['heat', new Map<string, [number, number, number]>([['2025-01-10', [0, 100, 0]]])],
  ]);

  it('computes the share over the period and per month, water heater only', () => {
    const r = waterHeaterHc(tariffs, ['wh'], 2, '2025-01-01', '2025-12-31');
    expect(r.off).toBeCloseTo(12);
    expect(r.peak).toBeCloseTo(3);
    expect(r.share).toBeCloseTo(0.8);
    expect(r.months.map((m) => [m.month, m.share])).toEqual([
      ['2025-01', 0.9],
      ['2025-02', 0.6],
    ]);
    // swapped columns
    expect(waterHeaterHc(tariffs, ['wh'], 1, '2025-01-01', '2025-12-31').share).toBeCloseTo(0.2);
    expect(waterHeaterHc(tariffs, ['none'], 2, '2025-01-01', '2025-12-31').share).toBeNull();
  });

  it('gives a verdict against the threshold', () => {
    expect(hcVerdict(0.95)).toEqual({ ok: true, text: '95 % en heures creuses : bien réglé' });
    const bad = hcVerdict(0.8);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^20 % en heures pleines : vérifiez le contacteur jour\/nuit/);
    expect(hcVerdict(0.85, 0.8).ok).toBe(true);
  });

  it('prices the peak-hour part against all off-peak', () => {
    expect(peakExtraCost(100, 0.27, 0.2)).toBeCloseTo(7);
    expect(peakExtraCost(100, 0.2, 0.27)).toBe(0);
  });

  it('averages hourly energy per month and hour', () => {
    const hourly = new Map([
      [
        'wh',
        new Map([
          ['2025-01-10T02', 2],
          ['2025-01-11T02', 4],
          ['2025-01-11T14', 1],
          ['2025-02-01T03', 1],
        ]),
      ],
    ]);
    const g = hourByMonth(hourly, new Set(['wh']), '2025-01-01', '2025-12-31');
    expect(g.months).toEqual(['2025-01', '2025-02']);
    expect(g.grid[0][2]).toBe(3); // (2 + 4) / 2 days
    expect(g.grid[0][14]).toBe(0.5);
    expect(g.grid[1][3]).toBe(1);
  });
});

describe('S-4.11 setpoint simulation', () => {
  // Synthetic season: 3 kWh per °C below 16 °C, outdoor temperature cycling 0..20 °C.
  const weather: Weather = new Map();
  const records: DayRecord[] = [];
  let d = '2024-09-01';
  for (let i = 0; d <= '2025-08-31'; i++, d = addDays(d, 1)) {
    const t = i % 21;
    weather.set(d, [t - 3, t + 3, t]);
    const kwh = 3 * Math.max(0, 16 - t);
    records.push({ day: d, room: 'a', cat: 'heating', kwh: kwh * 0.75 }, { day: d, room: 'b', cat: 'heating', kwh: kwh * 0.25 });
  }
  const sig = new Map([['2024-2025', records.filter((r) => r.room === 'a').map((r) => [weather.get(r.day)![2], r.kwh / 0.75, r.day] as [number, number, string])]]);

  it('picks the last complete season and recovers slope and balance', () => {
    const ref = referenceSeason(sig, '2025-11-01')!;
    expect(ref.season).toBe('2024-2025');
    expect(ref.complete).toBe(true);
    expect(ref.fit.slope).toBeCloseTo(-3, 6);
    expect(ref.fit.balance).toBeCloseTo(16, 6);
    expect(referenceSeason(sig, '2025-06-01')!.complete).toBe(false);
    expect(referenceSeason(new Map(), '2025-06-01')).toBeNull();
  });

  it('shifts the balance point by ΔT and sums the difference day by day', () => {
    const ref = referenceSeason(sig, '2025-11-01')!;
    const sim = simulateSetpoint(weather, ref.from, ref.to, ref.fit, -1)!;
    // expected by hand: Σ 3·max(0, 16 − t) vs Σ 3·max(0, 15 − t)
    let model = 0;
    let next = 0;
    for (const w of weather.values()) (model += 3 * Math.max(0, 16 - w[2])), (next += 3 * Math.max(0, 15 - w[2]));
    expect(sim.modelKwh).toBeCloseTo(model, 6);
    expect(sim.newKwh).toBeCloseTo(next, 6);
    expect(sim.savedKwh).toBeCloseTo(model - next, 6);
    expect(sim.pct).toBeCloseTo(((model - next) / model) * 100, 6);
    // about 12 % here (16 of 136 degree-units per 0..20 °C cycle)
    expect(sim.pct).toBeGreaterThan(11);
    expect(sim.pct).toBeLessThan(13);
    expect(sim.ademePct).toBeCloseTo(7);
    const up = simulateSetpoint(weather, ref.from, ref.to, ref.fit, 1)!;
    expect(up.savedKwh).toBeLessThan(0);
    expect(up.ademePct).toBeCloseTo(-7);
  });

  it('is unavailable without a usable signature', () => {
    expect(simulateSetpoint(weather, '2024-09-01', '2025-08-31', { slope: 1, intercept: 0, r2: 1, balance: null, n: 20 }, -1)).toBeNull();
  });

  it('splits by room share', () => {
    const s = roomShares(records, '2024-09-01', '2025-08-31');
    expect(s.get('a')).toBeCloseTo(0.75);
    expect(s.get('b')).toBeCloseTo(0.25);
  });
});

describe('S-1.10 data quality', () => {
  const rec = (room: string, day: string): DayRecord => ({ room, day, cat: 'heating', kwh: 1 });
  const records: DayRecord[] = [];
  for (let i = 1; i <= 15; i++) records.push(rec('r1', `2024-03-${String(i).padStart(2, '0')}`)); // 1-15 March
  records.push(rec('r1', '2024-04-02')); // 16 Mar - 1 Apr lost
  records.push(rec('r2', '2024-04-01'), rec('r2', '2024-04-02'));
  const estimated = new Set(['r1|2024-03-11', 'r1|2024-03-12', 'r1|2024-03-13', 'r1|2024-03-14', 'r1|2024-03-15']);

  it('counts real, estimated and missing days per room and month (same as the collector)', () => {
    const cov = computeCoverage(records, estimated, '2024-04-02');
    expect(Object.fromEntries(cov.get('r1')!)).toEqual({ '2024-03': [10, 5, 16], '2024-04': [1, 0, 1] });
    expect(Object.fromEntries(cov.get('r2')!)).toEqual({ '2024-04': [2, 0, 0] });
  });

  it('lists months with gaps, worst room first, most recent month first', () => {
    const gaps = gapMonths(computeCoverage(records, estimated, '2024-04-02'));
    expect(gaps).toEqual([
      { month: '2024-04', estimated: 0, missing: 1, rooms: ['r1'] },
      { month: '2024-03', estimated: 5, missing: 16, rooms: ['r1'] },
    ]);
    expect(gapMonths(computeCoverage(records, estimated, '2024-04-02'), new Set(['r2']))).toEqual([]);
  });

  it('flags the days to draw paler in the charts', () => {
    const days = uncertainDays(records, estimated, '2024-03-10', '2024-03-20');
    expect([...days].sort()).toEqual([
      '2024-03-11',
      '2024-03-12',
      '2024-03-13',
      '2024-03-14',
      '2024-03-15',
      '2024-03-16',
      '2024-03-17',
      '2024-03-18',
      '2024-03-19',
      '2024-03-20',
    ]);
    expect(uncertainDays(records.filter((r) => r.room === 'r2'), estimated, '2024-03-01', '2024-04-02').size).toBe(0);
  });
});
