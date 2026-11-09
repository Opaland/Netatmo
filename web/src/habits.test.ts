import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { absencePeriods, dayKind, dayTypeCost, lowDays, mergeAbsences, summarizeAbsence, waterTalon, withModeAbsences } from './habits';

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const rec = (day: string, room: string, cat: 'heating' | 'water_heater', kwh: number) => ({ day, room, cat, kwh }) as DayRecord;

describe('S-4.9 telework: cost per kind of day at equal climate', () => {
  // 2025-01-06 is a Monday. Weekdays: 1 kWh per DJU; weekends: 0.5 kWh per DJU.
  const weather: Weather = new Map();
  const perDay = new Map<string, number>();
  days('2025-01-06', 70).forEach((d, i) => {
    const t = 2 + (i % 9); // 2…10 °C → DJU 8…16
    weather.set(d, [t - 3, t + 3, t]);
    const weekend = dayKind(d, new Set()) === 'weekend';
    perDay.set(d, (weekend ? 0.5 : 1) * (18 - t));
  });

  it('reads each group at the mean DJU of all days', () => {
    const r = dayTypeCost(perDay, weather, '2025-01-01', '2025-12-31', (d) => (dayKind(d, new Set()) === 'weekend' ? 'we' : 'wd'))!;
    expect(r.days).toBe(70);
    expect(r.groups.get('wd')!.kwh).toBeCloseTo(r.dju, 5);
    expect(r.groups.get('we')!.kwh).toBeCloseTo(r.dju * 0.5, 5);
    expect(r.groups.get('wd')!.method).toBe('fit');
  });

  it('splits telework and office days from the marked weekdays', () => {
    expect(dayKind('2025-01-06', new Set([0]))).toBe('telework'); // Monday
    expect(dayKind('2025-01-07', new Set([0]))).toBe('office');
    expect(dayKind('2025-01-11', new Set([0]))).toBe('weekend');
  });

  it('ignores mild days and returns null without heating days', () => {
    const warm: Weather = new Map(days('2025-06-01', 10).map((d) => [d, [18, 26, 22]]));
    expect(dayTypeCost(new Map(days('2025-06-01', 10).map((d) => [d, 1])), warm, '2025-01-01', '2025-12-31', () => 'x')).toBeNull();
  });
});

describe('S-4.10 absences', () => {
  // A cold month, heating 2 kWh per DJU, with 4 near-empty days (hors-gel) in the middle.
  const weather: Weather = new Map();
  const recs: DayRecord[] = [];
  const away = new Set(days('2025-01-15', 4));
  days('2025-01-01', 31).forEach((d, i) => {
    const t = 3 + (i % 5); // DJU 10…14
    weather.set(d, [t - 2, t + 2, t]);
    recs.push(rec(d, 'salon', 'heating', away.has(d) ? 1 : 2 * (18 - t)));
    recs.push(rec(d, 'ce', 'water_heater', away.has(d) ? 2.5 : 4));
  });

  it('flags days under 20 % of the signature and groups ≥ 3 consecutive ones', () => {
    const low = lowDays(recs, weather, new Map(), '2025-01-01', '2025-01-31');
    expect([...low.entries()].filter(([, v]) => v).map(([d]) => d)).toEqual([...away]);
    expect(absencePeriods(low)).toEqual([{ from: '2025-01-15', to: '2025-01-18' }]);
  });

  it('needs three days in a row', () => {
    const low = new Map([
      ['2025-01-01', true],
      ['2025-01-02', true],
      ['2025-01-03', false],
      ['2025-01-04', true],
    ]);
    expect(absencePeriods(low)).toEqual([]);
  });

  it('uses the Linky meter outside the heating season', () => {
    const summer: DayRecord[] = [];
    const linky = new Map<string, number>();
    days('2025-06-01', 80).forEach((d, i) => {
      summer.push(rec(d, 'ce', 'water_heater', 3));
      linky.set(d, 3 + (i >= 70 && i < 74 ? 2 : 8)); // other uses 8 kWh, 2 kWh during 4 days
    });
    const low = lowDays(summer, null, linky, '2025-06-01', '2025-08-19');
    expect(absencePeriods(low)).toEqual([{ from: addDays('2025-06-01', 70), to: addDays('2025-06-01', 73) }]);
  });

  it('applies the edits: dismissed detections, added periods', () => {
    const detected = [
      { from: '2025-01-15', to: '2025-01-18' },
      { from: '2025-02-10', to: '2025-02-14' },
    ];
    const m = mergeAbsences(detected, { dismissed: ['2025-02-10'], added: [{ from: '2025-03-01', to: '2025-03-05' }] });
    expect(m).toEqual([
      { from: '2025-03-01', to: '2025-03-05', manual: true },
      { from: '2025-01-15', to: '2025-01-18', manual: false },
    ]);
  });

  it('measures the water heater above its standing consumption', () => {
    const water = new Map(recs.filter((r) => r.cat === 'water_heater').map((r) => [r.day, r.kwh]));
    const heat = new Map(recs.filter((r) => r.cat === 'heating').map((r) => [r.day, r.kwh]));
    expect(waterTalon(water, (d) => away.has(d), '2025-01-01', '2025-01-31')).toBe(4);
    // talon of 2 kWh: 0.5 kWh too much per day over 4 days
    const s = summarizeAbsence({ from: '2025-01-15', to: '2025-01-18' }, heat, water, () => 20, 2);
    expect(s).toEqual({ days: 4, heat: 4, heatExpected: 80, water: 10, waterExcess: 2 });
    expect(waterTalon(new Map([['2025-01-01', 3]]), () => false, '2025-01-01', '2025-01-31')).toBeNull();
  });
});

describe('S-13.4 absences confirmed by the setpoint mode', () => {
  const detected = [
    { from: '2025-01-10', to: '2025-01-14' },
    { from: '2025-02-01', to: '2025-02-03' },
  ];
  it('marks the detected periods the mode overlaps, and widens them to the mode', () => {
    const out = withModeAbsences(detected, [{ from: '2025-01-09', to: '2025-01-12' }]);
    expect(out).toEqual([
      { from: '2025-01-09', to: '2025-01-14', confirmed: true },
      { from: '2025-02-01', to: '2025-02-03', confirmed: false },
    ]);
  });
  it('adds a mode period the consumption missed, even a short one, and joins adjacent ones', () => {
    const out = withModeAbsences(detected, [
      { from: '2025-01-20', to: '2025-01-20' },
      { from: '2025-02-04', to: '2025-02-05' },
    ]);
    expect(out).toContainEqual({ from: '2025-01-20', to: '2025-01-20', confirmed: true });
    expect(out).toContainEqual({ from: '2025-02-01', to: '2025-02-05', confirmed: true });
    expect(out).toHaveLength(3);
  });
  it('keeps the detection by consumption when no mode was read', () => {
    expect(withModeAbsences(detected, []).every((p) => p.confirmed === false)).toBe(true);
    const merged = mergeAbsences(withModeAbsences(detected, [{ from: '2025-02-02', to: '2025-02-02' }]), { dismissed: [], added: [] });
    expect(merged[0]).toMatchObject({ from: '2025-02-01', confirmed: true, manual: false });
  });
});
