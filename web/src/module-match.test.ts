import { describe, expect, it, vi } from 'vitest';
import { addDays } from './aggregate';
import {
  MATCH_MAX_OFFSET,
  MATCH_MAX_SD,
  MATCH_MIN_DAYS,
  MATCH_MIN_R,
  declinedPairs,
  follows,
  linkRoom,
  matchStats,
  pairKey,
  trackingModules,
} from './module-match';

const FROM = '2026-10-01';
const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(FROM, i));
// deterministic ups and downs of a room (°C), no randomness
const wave = (i: number) => 18 + Math.sin(i * 1.3) * 0.8 + ((i * 7) % 5) * 0.15;
const probe = (n: number, f: (i: number) => number = wave) => new Map(days(n).map((d, i) => [d, [f(i), 19] as [number, number | null]]));
const station = (n: number, f: (i: number) => number) => Object.fromEntries(days(n).map((d, i) => [d, [f(i) - 1, f(i) + 1, f(i), 50, 600]]));
const TO = addDays(FROM, 27);

describe('#467 matchStats', () => {
  it('a module 1,5 °C above the probe, following it: r ≈ 1, steady gap', () => {
    const s = matchStats(probe(28), station(28, (i) => wave(i) + 1.5 + (i % 2 ? 0.1 : -0.1)), FROM, TO)!;
    expect(s.n).toBe(28);
    expect(s.offset).toBeCloseTo(1.5, 1);
    expect(s.r).toBeGreaterThan(0.95);
    expect(s.sd).toBeLessThan(0.15);
    expect(follows(s)).toBe(true);
  });
  it('only the days with both readings, inside [from, to]', () => {
    const st = station(40, (i) => wave(i) + 1);
    for (const d of days(5)) st[d][2] = null as unknown as number;
    const s = matchStats(probe(40), st, FROM, TO)!;
    expect(s.n).toBe(23);
  });
  it('a flat series follows nothing (r = 0)', () => {
    const s = matchStats(probe(28, () => 19), station(28, () => 20), FROM, TO)!;
    expect(s.r).toBe(0);
    expect(follows(s)).toBe(false);
  });
  it('no day in common: null', () => {
    expect(matchStats(probe(28), {}, FROM, TO)).toBeNull();
    expect(matchStats(undefined, station(28, wave), FROM, TO)).toBeNull();
  });
});

describe('#467 follows: each threshold, just inside and just outside', () => {
  const ok = { n: MATCH_MIN_DAYS, r: MATCH_MIN_R, sd: MATCH_MAX_SD, offset: MATCH_MAX_OFFSET };
  it('at the limits: a match', () => {
    expect(follows(ok)).toBe(true);
    expect(follows({ ...ok, offset: -MATCH_MAX_OFFSET })).toBe(true);
  });
  it('one step outside any of them: no match', () => {
    expect(follows({ ...ok, n: MATCH_MIN_DAYS - 1 })).toBe(false);
    expect(follows({ ...ok, r: MATCH_MIN_R - 0.01 })).toBe(false);
    expect(follows({ ...ok, sd: MATCH_MAX_SD + 0.01 })).toBe(false);
    expect(follows({ ...ok, offset: MATCH_MAX_OFFSET + 0.01 })).toBe(false);
    expect(follows({ ...ok, offset: -MATCH_MAX_OFFSET - 0.01 })).toBe(false);
  });
});

describe('#467 trackingModules', () => {
  // three rooms with their own ups and downs; a « cellar » module that follows the weather only
  const other = (i: number) => 19 + Math.cos(i * 0.9) * 0.7 + ((i * 3) % 4) * 0.2;
  const probes = new Map([
    ['r-ch1', probe(28)],
    ['r-bureau', probe(28, other)],
    ['r-salon', probe(28, () => 20)],
  ]);
  const daily = {
    cave: station(28, (i) => wave(i) + 1.5),
    vraie: station(28, (i) => 11 + i * 0.05),
  };
  it('proposes the module that follows a room, not the others', () => {
    const m = trackingModules(probes, ['r-ch1', 'r-bureau', 'r-salon'], daily, ['cave', 'vraie'], FROM, TO);
    expect(m.map((x) => [x.room, x.module])).toEqual([['r-ch1', 'cave']]);
    expect(m[0].offset).toBeCloseTo(1.5, 5);
  });
  it('only among the rooms and modules given (the linked ones are left out by the caller)', () => {
    expect(trackingModules(probes, ['r-bureau'], daily, ['cave'], FROM, TO)).toEqual([]);
    expect(trackingModules(probes, ['r-ch1'], daily, ['vraie'], FROM, TO)).toEqual([]);
  });
  it('ambiguous: a module following two rooms is proposed nowhere', () => {
    const twins = new Map([...probes, ['r-ch2', probe(28, (i) => wave(i) + 0.3)]]);
    expect(trackingModules(twins, ['r-ch1', 'r-ch2'], daily, ['cave'], FROM, TO)).toEqual([]);
  });
  it('ambiguous: a room followed by two modules gets no proposal', () => {
    const two = { ...daily, bis: station(28, (i) => wave(i) + 1) };
    expect(trackingModules(probes, ['r-ch1'], two, ['cave', 'bis'], FROM, TO)).toEqual([]);
  });
  it('writes nothing to the console: no room or module name in a journal', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    trackingModules(probes, ['r-ch1', 'r-bureau', 'r-salon'], daily, ['cave', 'vraie'], FROM, TO);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const s of spies) s.mockRestore();
  });
});

describe('#467 linkRoom, declinedPairs', () => {
  it('freezes the links in force, then sets the room', () => {
    const cur = new Map([['r-salon', 'm0']]);
    expect(linkRoom(cur, ['r-salon', 'r-ch1', 'r-bureau'], 'r-ch1', 'm4')).toEqual({ 'r-salon': 'm0', 'r-ch1': 'm4', 'r-bureau': '' });
  });
  it('reads back only a list of strings', () => {
    expect([...declinedPairs([pairKey('r-ch1', 'm4'), 3, null])]).toEqual(['r-ch1 m4']);
    for (const v of [undefined, null, 'r-ch1 m4', { 0: 'x' }, 7]) expect(declinedPairs(v).size).toBe(0);
  });
});
