import { describe, expect, it } from 'vitest';
import type { SigPoint } from './indoorsig';
import { invert, ols, windSignature, windSignatures } from './windsig';

// deterministic pseudo-random numbers (the tests must not depend on Math.random)
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

function season(n: number, windEffect: number, seed = 1) {
  const r = rng(seed);
  const points: SigPoint[] = [];
  const wind = new Map<string, [number, number | null]>();
  const rain = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const day = `2025-${String(11 + Math.floor(i / 30)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}x${i}`;
    const tOut = 14 - 16 * r();
    const w = 5 + 30 * r();
    const kwh = 2 + 2.5 * (18 - tOut) + windEffect * w + gauss(r) * 2;
    points.push({ day, kwh, tOut, tIn: null });
    wind.set(day, [w, null]);
    rain.set(day, 10 * r()); // rain without any effect
  }
  return { points, wind, rain };
}

describe('ols', () => {
  it('recovers exact coefficients and gives R² = 1 without noise', () => {
    const x = [
      [1, 2],
      [2, 1],
      [3, 5],
      [4, 3],
      [5, 8],
      [6, 2],
    ];
    const y = x.map(([a, b]) => 3 + 2 * a - 0.5 * b);
    const f = ols(x, y)!;
    expect(f.coef.map((c) => Math.round(c * 1e6) / 1e6)).toEqual([3, 2, -0.5]);
    expect(f.r2).toBeCloseTo(1, 9);
  });
  it('is null when the columns are collinear or the points too few', () => {
    expect(ols([[1, 2], [2, 4], [3, 6], [4, 8], [5, 10], [6, 12]], [1, 2, 3, 4, 5, 6])).toBeNull();
    expect(ols([[1], [2], [3]], [1, 2, 3])).toBeNull();
    expect(invert([[1, 2], [2, 4]])).toBeNull();
    expect(invert([[2, 0], [0, 4]])).toEqual([[0.5, 0], [0, 0.25]]);
  });
});

describe('windSignature (#221)', () => {
  it('finds a real wind effect, with the gain of explanation, and no rain effect', () => {
    const { points, wind, rain } = season(150, 0.2);
    const w = windSignature('2025-2026', points, wind, rain)!;
    expect(w.n).toBe(150);
    expect(w.wind.real).toBe(true);
    expect(w.wind.ci[0]).toBeGreaterThan(0.1);
    expect(w.wind.ci[1]).toBeLessThan(0.3);
    expect(w.r2After).toBeGreaterThan(w.r2Before);
    expect(w.gain).toBeCloseTo((w.r2After - w.r2Before) / (1 - w.r2Before), 9);
    expect(w.rain!.real).toBe(false); // the rain was drawn without any effect
    expect(w.rain!.ci[0]).toBeLessThan(0);
    expect(w.rain!.ci[1]).toBeGreaterThan(0);
  });
  it('never calls real an effect that is not there', () => {
    let real = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { points, wind } = season(60, 0, seed);
      if (windSignature('s', points, wind)!.wind.real) real++;
    }
    expect(real).toBeLessThanOrEqual(5); // about 5 % false alarms at 95 %, 2 expected of 40
  });
  it('needs MIN_DAYS days with the wind, and keeps only the days with it', () => {
    const { points, wind } = season(40, 0.2);
    for (const p of points.slice(0, 15)) wind.delete(p.day);
    expect(windSignature('s', points, wind)).toBeNull();
    const all = season(40, 0.2);
    const sigs = windSignatures(new Map([['2024-2025', all.points], ['2025-2026', all.points.slice(0, 20)]]), all.wind);
    expect(sigs.map((s) => s.season)).toEqual(['2024-2025']);
    expect(sigs[0].rain).toBeNull(); // no rain given
  });
});
