import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { lostDays, predictHeating, rebuildLost, rebuildTotals, suspectDays, uncertainSet } from './reconstitute';

// A synthetic winter: heating = 2 kWh per °C below 16 °C, split 60/40 between two rooms,
// a water heater at 4 kWh/day, and 8 kWh/day of other usages on the Linky meter.
const FROM = '2024-01-01';
const DAYS = 90;
const tOut = (i: number) => 2 + 8 * Math.abs(Math.sin(i / 5)); // 2…10 °C
function build(skip: (room: string, day: string) => boolean, low: (day: string) => number = () => 1) {
  const records: DayRecord[] = [];
  const weather: Weather = new Map();
  const linky = new Map<string, number>();
  for (let i = 0; i < DAYS; i++) {
    const day = addDays(FROM, i);
    const t = tOut(i);
    weather.set(day, [t - 3, t + 3, t]);
    const heat = 2 * (16 - t);
    const parts: [string, 'heating' | 'water_heater', number][] = [
      ['salon', 'heating', 0.6 * heat],
      ['chambre', 'heating', 0.4 * heat],
      ['ce', 'water_heater', 4],
    ];
    linky.set(day, 8 + heat + 4);
    for (const [room, cat, kwh] of parts) {
      if (skip(room, day)) continue;
      records.push({ day, room, cat, kwh: cat === 'heating' ? kwh * low(day) : kwh });
    }
  }
  return { records, weather, linky };
}

describe('S-1.10 lost days', () => {
  it('lists the rooms without a value between their first and last day', () => {
    const { records } = build((room, day) => room === 'salon' && day >= '2024-02-01' && day <= '2024-02-03');
    const lost = lostDays(records);
    expect([...lost.keys()]).toEqual(['2024-02-01', '2024-02-02', '2024-02-03']);
    expect([...lost.get('2024-02-01')!]).toEqual(['salon']);
    const u = uncertainSet(lost, new Set(['ce|2024-01-10']));
    expect(u.has('2024-01-10') && u.has('2024-02-02')).toBe(true);
    expect(u.size).toBe(4);
  });

  it('rebuilds a whole lost day from Linky minus the other usages', () => {
    const { records, weather, linky } = build((_r, day) => day === '2024-02-10');
    const [r] = rebuildLost(records, { weather, linky, estimated: new Set() });
    const t = tOut(40);
    expect(r.day).toBe('2024-02-10');
    expect(r.method).toBe('linky');
    expect(r.kwh).toBeCloseTo(2 * (16 - t) + 4, 5);
    expect(r.rooms).toEqual(['ce', 'chambre', 'salon']);
    // split between rooms like the signature / typical values say
    expect(r.byRoom.get('ce')!).toBeCloseTo(4, 0);
    expect(r.signature!).toBeCloseTo(2 * (16 - t) + 4, 0);
  });

  it('rebuilds only the missing room when the others still report', () => {
    const { records, weather, linky } = build((room, day) => room === 'salon' && day === '2024-02-10');
    const [r] = rebuildLost(records, { weather, linky, estimated: new Set() });
    expect(r.rooms).toEqual(['salon']);
    expect(r.kwh).toBeCloseTo(0.6 * 2 * (16 - tOut(40)), 5);
  });

  it('falls back on the signature without Linky, and gives up without weather nor Linky', () => {
    const { records, weather } = build((room, day) => room === 'salon' && day === '2024-02-10');
    const [r] = rebuildLost(records, { weather, linky: new Map(), estimated: new Set() });
    expect(r.method).toBe('signature');
    expect(r.linky).toBeNull();
    expect(r.kwh).toBeCloseTo(0.6 * 2 * (16 - tOut(40)), 1);
    expect(rebuildLost(records, { weather: null, linky: new Map(), estimated: new Set() })).toEqual([]);
  });

  it('keeps rebuilt kWh apart in the yearly totals', () => {
    const { records, weather, linky } = build((_r, day) => day === '2024-02-10');
    const rebuilt = rebuildLost(records, { weather, linky, estimated: new Set() });
    const [y] = rebuildTotals(records, rebuilt);
    expect(y.year).toBe('2024');
    expect(y.measured).toBeCloseTo(records.reduce((s, r) => s + r.kwh, 0));
    expect(y.rebuilt).toBeCloseTo(rebuilt[0].kwh);
    expect([y.days, y.linky, y.signature]).toEqual([1, 1, 0]);
  });

  it('predicts no heating above the balance temperature', () => {
    const fit = { slope: -2, intercept: 32, r2: 1, balance: 16, n: 50 };
    expect(predictHeating(fit, 6)).toBe(20);
    expect(predictHeating(fit, 16.5)).toBe(0);
  });
});

describe('S-1.10 suspect days', () => {
  const bad = (day: string) => (day === '2024-02-20' || day === '2024-02-21' ? 0.1 : 1);

  it('flags real cold days far below the signature when Linky says more', () => {
    const { records, weather, linky } = build(() => false, bad);
    const s = suspectDays(records, { weather, linky, estimated: new Set() });
    expect(s.map((x) => x.day)).toEqual(['2024-02-20', '2024-02-21']);
    expect(s[0].ratio).toBeCloseTo(0.1, 1);
    expect(s[0].linky!).toBeGreaterThan(s[0].recorded);
  });

  it('does not flag a low day that Linky confirms (absence)', () => {
    const { records, weather, linky } = build(() => false, bad);
    for (const d of ['2024-02-20', '2024-02-21']) {
      const t = weather.get(d)![2];
      linky.set(d, 8 + 0.1 * 2 * (16 - t) + 4);
    }
    expect(suspectDays(records, { weather, linky, estimated: new Set() })).toEqual([]);
    // without Linky the signature alone flags them
    expect(suspectDays(records, { weather, linky: new Map(), estimated: new Set() }).length).toBe(2);
  });

  it('ignores lost or estimated days and works only with weather', () => {
    const { records, weather, linky } = build(() => false, bad);
    const est = new Set(['salon|2024-02-20', 'salon|2024-02-21']);
    expect(suspectDays(records, { weather, linky, estimated: est })).toEqual([]);
    expect(suspectDays(records, { weather: null, linky, estimated: new Set() })).toEqual([]);
  });
});

// #532: whatever the holes, a rebuilt value is only ever for a room-day without any value (lost),
// never for an estimated or a measured one, and the measured total is never changed by it.
describe('#532 reconstitution : jamais ajoutée à un jour réel ou estimé', () => {
  it('rebuilds lost room-days only, the measured total untouched (fixed seed)', () => {
    let seed = 532;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    let total = 0;
    for (let round = 0; round < 30; round++) {
      const recs: DayRecord[] = [];
      const estimated = new Set<string>();
      for (let i = 0; i < 90; i++) {
        const day = addDays('2024-01-01', i);
        for (const [room, cat] of [['a', 'heating'], ['b', 'heating'], ['w', 'water_heater']] as const) {
          if (rnd() < 0.15) continue; // a hole
          recs.push({ day, room, cat, kwh: 2 + rnd() * 8 });
          if (rnd() < 0.05) estimated.add(`${room}|${day}`);
        }
      }
      const linky = new Map(Array.from({ length: 90 }, (_, i) => [addDays('2024-01-01', i), 40 + rnd() * 10] as [string, number]));
      const rebuilt = rebuildLost(recs, { weather: null, linky, estimated });
      const has = new Set(recs.map((r) => `${r.room}|${r.day}`));
      total += rebuilt.length;
      for (const r of rebuilt) for (const room of [...r.rooms, ...r.byRoom.keys()]) expect(has.has(`${room}|${r.day}`)).toBe(false);
      const measured = rebuildTotals(recs, rebuilt).reduce((a, y) => a + y.measured, 0);
      expect(measured).toBeCloseTo(recs.reduce((a, r) => a + r.kwh, 0), 6);
    }
    expect(total).toBeGreaterThan(100); // the property is tried on many rebuilt days, not on none
  });
});
