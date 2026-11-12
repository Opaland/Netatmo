// #392: second mutation wave, the reconstitution heuristics (reconstitute.ts). Each test below
// kills mutants that change a rebuilt or suspect value (docs/bmad/06-qa-strategy.md §7); the
// equivalent ones are listed there with their reason. All data are synthetic.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { predictHeating, rebuildLost, rebuildTotals, suspectDays } from './reconstitute';

const D0 = '2024-01-01';
const day = (i: number) => addDays(D0, i);
const heat = (d: string, room: string, kwh: number): DayRecord => ({ day: d, room, cat: 'heating', kwh });
const water = (d: string, room: string, kwh: number): DayRecord => ({ day: d, room, cat: 'water_heater', kwh });
const none = { weather: null, linky: new Map<string, number>(), estimated: new Set<string>() };
const totalOf = (records: DayRecord[], d: string) => records.filter((r) => r.day === d).reduce((s, r) => s + r.kwh, 0);

describe('rebuildLost: typical value of a water heater (median of the nearby complete days)', () => {
  it('odd count: numeric sort, middle value', () => {
    // reference days in calendar order: 2, 10, 9 -> median 9 (not 10 unsorted, not 2 sorted as text)
    const records = [water(day(0), 'ce', 2), water(day(1), 'ce', 10), water(day(3), 'ce', 9)];
    const [r] = rebuildLost(records, none);
    expect([r.day, r.method, r.kwh]).toEqual([day(2), 'signature', 9]);
  });

  it('even count: mean of the two middle values', () => {
    // 1, 2, 10, 9 -> (2 + 9) / 2
    const records = [water(day(0), 'ce', 1), water(day(1), 'ce', 2), water(day(2), 'ce', 10), water(day(4), 'ce', 9)];
    expect(rebuildLost(records, none)[0].kwh).toBe(5.5);
  });

  it('no complete day nearby: nothing rebuilt (not 0, not NaN)', () => {
    const records = [water(day(0), 'ce', 4), water(day(2), 'ce', 4)];
    expect(rebuildLost(records, { ...none, window: 0 })).toEqual([]);
  });

  it('the window includes its last day, and skips estimated days', () => {
    const records = [0, 1, 3].map((i) => water(day(i), 'ce', 100)).concat(water(day(4), 'ce', 7));
    const estimated = new Set([0, 1, 3].map((i) => `ce|${day(i)}`));
    const [r] = rebuildLost(records, { ...none, estimated, window: 2 });
    expect([r.day, r.kwh]).toEqual([day(2), 7]);
  });

  it('lists the lost days in date order, whatever the order of the rooms', () => {
    const records = [
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map((i) => water(day(i), 'z', 3)),
      ...[0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12].map((i) => water(day(i), 'a', 3)),
    ];
    expect(rebuildLost(records, none).map((r) => r.day)).toEqual([day(5), day(10)]);
  });
});

describe('rebuildLost: the Linky method', () => {
  // Rooms a (lost on day 3) and b, 2 kWh each; 8 kWh of other usages; no weather.
  const records = [0, 1, 2, 3, 4, 5, 6].flatMap((i) => (i === 3 ? [heat(day(3), 'b', 2)] : [heat(day(i), 'a', 2), heat(day(i), 'b', 2)]));
  const linkyOn = (days: number[], withLost: boolean) => {
    const m = new Map(days.map((i) => [day(i), 12]));
    if (withLost) m.set(day(3), 8 + 2 + 3); // a used 3 kWh that day
    return m;
  };

  it('uses only the reference days that have a Linky value, from minRef of them', () => {
    const [r] = rebuildLost(records, { ...none, linky: linkyOn([1, 4, 5], true), minRef: 3 });
    expect([r.method, r.kwh, r.linky]).toEqual(['linky', 3, 3]);
  });

  it('below minRef reference days, no Linky estimate (and here no signature either)', () => {
    expect(rebuildLost(records, { ...none, linky: linkyOn([1, 4, 5], true), minRef: 4 })).toEqual([]);
  });

  it('no Linky value on the lost day: no Linky estimate', () => {
    expect(rebuildLost(records, { ...none, linky: linkyOn([0, 1, 2, 4, 5, 6], false) })).toEqual([]);
  });
});

describe('rebuildLost: split of the Linky kWh between the lost rooms', () => {
  // 8 kWh of other usages: Linky = Intuis total + 8 on the reference days.
  const linkyFor = (records: DayRecord[], lostDay: string, lostKwh: number) => {
    const days = [...new Set(records.map((r) => r.day))];
    const m = new Map(days.map((d) => [d, totalOf(records, d) + 8]));
    m.set(lostDay, totalOf(records, lostDay) + 8 + lostKwh);
    return m;
  };

  it('weights from heating days only: a day at 0.2 kWh of heating is not one', () => {
    const records: DayRecord[] = [];
    for (const i of [0, 1, 2, 8, 9, 10]) records.push(heat(day(i), 'a', 3), heat(day(i), 'b', 1));
    for (const i of [3, 4, 6, 7]) records.push(heat(day(i), 'a', 0.2), heat(day(i), 'b', 0));
    const [r] = rebuildLost(records, { ...none, linky: linkyFor(records, day(5), 4) });
    expect(r.kwh).toBe(4);
    expect(r.byRoom.get('a')!).toBeCloseTo(3, 9);
    expect(r.byRoom.get('b')!).toBeCloseTo(1, 9);
  });

  it('a heating room weighs its mean per heating day, against the water heater median', () => {
    const records: DayRecord[] = [];
    for (const i of [0, 1, 2, 4, 5, 6]) records.push(water(day(i), 'ce', 4), heat(day(i), 'a', 2));
    const [r] = rebuildLost(records, { ...none, linky: linkyFor(records, day(3), 6) });
    expect(r.kwh).toBe(6);
    expect(r.byRoom.get('ce')!).toBeCloseTo(4, 9);
    expect(r.byRoom.get('a')!).toBeCloseTo(2, 9);
  });

  it('rooms that never heated nearby share the kWh equally', () => {
    const records: DayRecord[] = [];
    for (const i of [0, 1, 2, 3, 4, 5, 6]) records.push(heat(day(i), 'c', 3));
    for (const i of [0, 1, 2, 4, 5, 6]) records.push(heat(day(i), 'a', 0), heat(day(i), 'b', 0));
    const [r] = rebuildLost(records, { ...none, linky: linkyFor(records, day(3), 4) });
    expect(r.kwh).toBe(4);
    expect([r.byRoom.get('a'), r.byRoom.get('b')]).toEqual([2, 2]);
  });
});

// A winter of N days from `from`: outdoor mean 2…13 °C, heating `coef` × (16 − t) when `cold(day)`
// (with weather), else 3 kWh/day without weather. One heating room, `a`, lost on `lost`.
function season(from: string, to: string, cold: (d: string) => number | null, lost: string, tLost: number) {
  const records: DayRecord[] = [];
  const weather: Weather = new Map();
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
    const coef = cold(d);
    const t = 2 + (i % 9);
    if (d === lost) {
      weather.set(d, [tLost - 3, tLost + 3, tLost]);
      continue;
    }
    if (coef === null) records.push(heat(d, 'a', 3));
    else {
      weather.set(d, [t - 3, t + 3, t]);
      records.push(heat(d, 'a', coef * (16 - t)));
    }
  }
  return { records, weather };
}
const winters = (d: string) => (d >= '2023-01-01' && d <= '2023-03-31' ? 2 : d >= '2024-01-01' && d <= '2024-03-31' ? 4 : null);

describe('rebuildLost: the signature', () => {
  it('a lost day in a season without signature takes the nearest season (later one)', () => {
    // fits: 2022-2023 (slope −2) and 2023-2024 (slope −4); lost day in 2024-2025 -> 2023-2024
    const { records, weather } = season('2023-01-01', '2024-10-20', winters, '2024-10-10', 6);
    const [r] = rebuildLost(records, { ...none, weather });
    expect(r.method).toBe('signature');
    expect(r.kwh).toBeCloseTo(4 * (16 - 6), 6);
  });

  it('a lost day in a season without signature takes the nearest season (earlier one)', () => {
    // lost day in 2021-2022 -> 2022-2023 (gap 1) and not 2023-2024 (gap 2)
    const { records, weather } = season('2021-11-01', '2024-03-31', winters, '2021-11-15', 6);
    const [r] = rebuildLost(records, { ...none, weather });
    expect(r.kwh).toBeCloseTo(2 * (16 - 6), 6);
  });

  it('a season whose heating rises with the temperature, or stays flat, has no signature', () => {
    const build = (kwh: (t: number) => number) => {
      const records: DayRecord[] = [];
      const weather: Weather = new Map();
      for (let i = 0; i < 40; i++) {
        const t = 2 + (i % 9);
        weather.set(day(i), [t - 3, t + 3, t]);
        if (i !== 20) records.push(heat(day(i), 'a', kwh(t)));
      }
      return rebuildLost(records, { ...none, weather });
    };
    expect(build((t) => t)).toEqual([]);
    expect(build(() => 5)).toEqual([]);
  });

  it('no heating day nearby: no share for the room, nothing rebuilt', () => {
    const records: DayRecord[] = [];
    const weather: Weather = new Map();
    for (let i = 0; i < 46; i++) {
      const t = i < 40 ? 2 + (i % 9) : 5;
      weather.set(day(i), [t - 3, t + 3, t]);
      if (i !== 43) records.push(heat(day(i), 'a', i < 40 ? 2 * (16 - t) : 0.1));
    }
    expect(rebuildLost(records, { ...none, weather, window: 2 })).toEqual([]);
  });
});

it('predictHeating: nothing at 15 °C exactly, even when the line is still above zero', () => {
  expect(predictHeating({ slope: -2, intercept: 40, r2: 1, balance: null, n: 50 }, 15)).toBe(0);
});

it('rebuildTotals: years in order whatever the order of the records', () => {
  for (const ys of [['2025', '2024', '2026'], ['2024', '2026', '2025'], ['2026', '2024', '2025']])
    expect(rebuildTotals(ys.map((y) => heat(`${y}-01-01`, 'a', 1)), []).map((y) => y.year)).toEqual(['2024', '2025', '2026']);
});

// ------------------------------------------------------------------ suspects
// 60 days from 1 January: outdoor mean 2…13 °C, one heating room at 2 × (16 − t), a water heater
// at 4 kWh; `low` days get the given heating instead. Linky (when asked) = Intuis total + 8.
function winter(low: Record<number, number>) {
  const records: DayRecord[] = [];
  const weather: Weather = new Map();
  for (let i = 0; i < 60; i++) {
    const t = 2 + (i % 12);
    weather.set(day(i), [t - 3, t + 3, t]);
    records.push(heat(day(i), 'a', low[i] ?? 2 * (16 - t)), water(day(i), 'ce', 4));
  }
  const linky = new Map([...Array(60).keys()].map((i) => [day(i), totalOf(records, day(i)) + 8]));
  return { records, weather, linky };
}

describe('suspectDays: thresholds', () => {
  it('days in order whatever the order of the records', () => {
    const { records, weather } = winter({ 24: 1, 12: 1 });
    const s = suspectDays([...records].reverse(), { ...none, weather });
    expect(s.map((x) => x.day)).toEqual([day(12), day(24)]);
  });

  it('a day without weather is skipped, not read', () => {
    const { records, weather } = winter({ 24: 1 });
    weather.delete(day(30));
    expect(suspectDays(records, { ...none, weather }).map((x) => x.day)).toEqual([day(24)]);
  });

  it('expected kWh from minExpected included, and the ratio is strict', () => {
    const { records, weather } = winter({ 24: 0 });
    const [s] = suspectDays(records, { ...none, weather });
    expect(s.day).toBe(day(24));
    expect(suspectDays(records, { ...none, weather, minExpected: s.expected }).map((x) => x.day)).toEqual([day(24)]);
    expect(suspectDays(records, { ...none, weather, minExpected: 1000 })).toEqual([]);
    expect(suspectDays(records, { ...none, weather, ratio: 0 })).toEqual([]);
  });
});

describe('suspectDays: what Linky says', () => {
  it('the other low days are not reference days of each other', () => {
    const { records, weather, linky } = winter({ 30: 1, 31: 1 });
    // what the radiators really used: the signature's 2 × (16 − t), t = 8 °C then 9 °C. Read as a
    // reference for day 30, day 31 would give « other usages » of 8 + 14 − 1 instead of 8.
    linky.set(day(30), 4 + 16 + 8);
    linky.set(day(31), 4 + 14 + 8);
    const s = suspectDays(records, { ...none, weather, linky, window: 1, minRef: 1 });
    expect(s[0].day).toBe(day(30));
    expect(s[0].linky).toBe(4 + 16);
  });

  it('a low day without its own Linky value stays suspect', () => {
    const { records, weather, linky } = winter({ 24: 1 });
    linky.delete(day(24));
    const s = suspectDays(records, { ...none, weather, linky });
    expect(s.map((x) => [x.day, x.linky])).toEqual([[day(24), null]]);
  });

  it('too few reference days with Linky: the day stays suspect, Linky unused', () => {
    const { records, weather } = winter({ 24: 1 });
    // Linky only on the low day, equal to what Intuis recorded
    const linky = new Map([[day(24), 1 + 4]]);
    const s = suspectDays(records, { ...none, weather, linky });
    expect(s.map((x) => [x.day, x.linky])).toEqual([[day(24), null]]);
  });

  it('small gap: Linky must exceed what Intuis recorded by more than 3 kWh', () => {
    // day 23: t = 13 °C, about 6 kWh expected; 1.5 recorded -> half the gap is under 3
    const at = (extra: number) => {
      const { records, weather, linky } = winter({ 23: 1.5 });
      linky.set(day(23), 8 + 1.5 + 4 + extra);
      return suspectDays(records, { ...none, weather, linky }).map((x) => x.day);
    };
    expect(at(3)).toEqual([]);
    expect(at(3.5)).toEqual([day(23)]);
  });

  it('large gap: Linky must exceed what Intuis recorded by half the gap', () => {
    // day 24: t = 2 °C, about 28 kWh expected; 1 recorded
    const { records, weather } = winter({ 24: 1 });
    const [{ expected }] = suspectDays(records, { ...none, weather });
    const half = 0.5 * (expected - 1);
    expect(half).toBeGreaterThan(10);
    const at = (extra: number) => {
      const { linky } = winter({ 24: 1 });
      linky.set(day(24), 8 + 1 + 4 + extra);
      return suspectDays(records, { ...none, weather, linky }).map((x) => x.day);
    };
    expect(at(10)).toEqual([]);
    expect(at(half + 0.5)).toEqual([day(24)]);
  });
});
