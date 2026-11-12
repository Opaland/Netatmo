// S-6.2: surfaces and works markers, signature before / after.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Weather } from './analysis';
import type { DayRecord } from './aggregate';
import { MIN_SIDE_DAYS, NO_WORKS, beforeAfter, heatPerDay, perRoomM2, surfaceOf, validWorks, worksHeat } from './works';

describe('validWorks', () => {
  it('keeps clean surfaces and markers, sorted', () => {
    const w = validWorks({
      surfaces: { a: 14.25, b: -3, c: 'x', d: 5000, e: 20 },
      markers: [
        { day: '2025-06-01', kind: 'isolation', label: 'Combles' },
        { day: 'juin', kind: 'isolation' },
        { day: '2024-10-01', kind: 'inconnu', label: 42 },
      ],
    });
    expect(w.surfaces).toEqual({ a: 14.3, e: 20 });
    expect(w.markers).toEqual([
      { day: '2024-10-01', kind: 'autre', label: '' },
      { day: '2025-06-01', kind: 'isolation', label: 'Combles' },
    ]);
    expect(validWorks(null)).toBe(NO_WORKS);
    expect(validWorks('x')).toBe(NO_WORKS);
  });
  it('sums the surfaces it knows', () => {
    expect(surfaceOf({ a: 12, b: 20 }, ['a', 'b', 'c'])).toEqual({ m2: 32, known: 2 });
  });
});

/** Two winters: the house loses 2 kWh per °C below 16 °C, then 1.2 after the works. */
function series(marker: string) {
  const weather: Weather = new Map();
  const heat = new Map<string, number>();
  for (let i = 0; i < 730; i++) {
    const d = addDays('2024-01-01', i);
    const doy = i % 365;
    const t = 10 - 9 * Math.cos(((doy - 15) / 365) * 2 * Math.PI) + ((i * 7) % 5) - 2; // cold in January
    weather.set(d, [t - 4, t + 4, t]);
    const k = d < marker ? 2 : 1.2;
    heat.set(d, Math.max(0, k * (16 - t)));
  }
  return { weather, heat };
}

describe('beforeAfter', () => {
  const marker = '2025-01-01';
  const { weather, heat } = series(marker);

  it('fits one line on each side of the marker and gives kWh/m²', () => {
    const r = beforeAfter(heat, weather, marker, '2024-01-01', '2025-12-30', 80);
    expect(r.before!.fit!.slope).toBeCloseTo(-2, 1);
    expect(r.after!.fit!.slope).toBeCloseTo(-1.2, 1);
    expect(r.before!.to).toBe('2024-12-31');
    expect(r.after!.from).toBe(marker);
    expect(r.before!.perM2).toBeCloseTo(r.before!.kwh / 80);
    // climate-corrected change: the same weather, 40 % less per degree
    expect(r.change).toBeLessThan(-30);
    expect(r.change).toBeGreaterThan(-50);
  });

  it('clips the windows to the data and needs enough heating days', () => {
    const r = beforeAfter(heat, weather, '2024-01-10', '2024-01-01', '2025-12-30', null);
    expect(r.before).toBeNull(); // 9 days only
    expect(r.after!.perM2).toBeNull();
    expect(r.change).toBeNull();
    const late = beforeAfter(heat, weather, addDays('2025-12-30', -(MIN_SIDE_DAYS - 5)), '2024-01-01', '2025-12-30', null);
    expect(late.after).toBeNull();
  });
});

describe('worksHeat (#476)', () => {
  // A stove lit on the day of the « works »: the radiators fall from 2 to 1.2 kWh per °C, the wood
  // brings the 0.8 left. The house is the same: electricity + wood, the change is ≈ 0, not −40 %.
  const marker = '2025-01-01';
  const { weather, heat } = series(marker);
  const records: DayRecord[] = [...heat].map(([day, kwh]) => ({ day, room: 'salon', cat: 'heating', kwh }));
  const daily = new Map<string, [number, number]>();
  for (const [day, [, , t]] of weather) if (day >= marker && t < 16) daily.set(day, [0.8 * (16 - t), 0]);

  it('counts the wood with the electricity, before and after', () => {
    const w = worksHeat(records, daily);
    expect(w.wood).toBe(true);
    const r = beforeAfter(w.heat, weather, marker, '2024-01-01', '2025-12-30', null);
    expect(r.after!.fit!.slope).toBeCloseTo(-2, 1);
    expect(Math.abs(r.change!)).toBeLessThan(5);
    // the electricity alone would have shown the stove as insulation
    expect(beforeAfter(heatPerDay(records), weather, marker, '2024-01-01', '2025-12-30', null).change).toBeLessThan(-30);
  });

  it('without wood, the electricity alone, and says so', () => {
    const w = worksHeat(records, null);
    expect(w.wood).toBe(false);
    expect(w.heat).toEqual(heatPerDay(records));
  });
});

describe('helpers', () => {
  const recs = [
    { day: '2025-01-01', room: 'a', cat: 'heating', kwh: 10 },
    { day: '2025-01-01', room: 'b', cat: 'water_heater', kwh: 4 },
    { day: '2025-01-02', room: 'a', cat: 'heating', kwh: 6 },
    { day: '2025-01-02', room: 'c', cat: 'heating', kwh: 2 },
  ];
  it('sums heating per day', () => {
    expect([...heatPerDay(recs)]).toEqual([
      ['2025-01-01', 10],
      ['2025-01-02', 8],
    ]);
    expect(heatPerDay(recs, new Set(['c'])).get('2025-01-02')).toBe(2);
  });
  it('gives kWh/m² per room with a surface', () => {
    const m = perRoomM2(recs, { a: 8 }, '2025-01-01', '2025-01-31');
    expect(m.get('a')).toEqual({ kwh: 16, m2: 8, perM2: 2 });
    expect(m.has('c')).toBe(false);
  });
});
