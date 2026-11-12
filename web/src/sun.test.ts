// #117: the sun of the day as a possible explanation of a day heated less than expected.
// Fictitious days only.
import { describe, expect, it } from 'vitest';
import type { Weather } from './analysis';
import { median, sunHint, sunMedian, sunnyDay } from './sun';

const w = (t: number): [number, number, number] => [t, t, t];

describe('ensoleillement : la moitié la plus ensoleillée des jours de chauffe (#117)', () => {
  it('médiane : impaire, paire, vide, valeurs non finies écartées', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([4, 2, 8, 6])).toBe(5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 3])).toBe(3);
  });

  it('seuls les jours de chauffe (moyenne sous 15 °C) comptent', () => {
    const weather: Weather = new Map([
      ['2026-01-10', w(2)],
      ['2026-01-11', w(5)],
      ['2026-01-12', w(8)],
      ['2026-06-20', w(22)], // summer: a sunny day that does not count
      ['2026-04-20', w(15)], // 15 °C: not a heating day
    ]);
    const sun = new Map([
      ['2026-01-10', 3],
      ['2026-01-11', 6],
      ['2026-01-12', 9],
      ['2026-06-20', 29],
      ['2026-04-20', 20],
      ['2026-01-13', 40], // no weather: left out
    ]);
    expect(sunMedian(sun, weather)).toBe(6);
    expect(sunMedian(new Map(), weather)).toBeNull();
  });

  it('un jour est ensoleillé strictement au-dessus de la médiane', () => {
    const sun = new Map([
      ['a', 6],
      ['b', 6.1],
    ]);
    expect(sunnyDay('a', sun, 6)).toBeNull();
    expect(sunnyDay('b', sun, 6)).toBe(6.1);
    expect(sunnyDay('c', sun, 6)).toBeNull();
    expect(sunnyDay('b', sun, null)).toBeNull();
    expect(sunnyDay('b', undefined, 6)).toBeNull();
  });

  it('cité seulement pour un jour en dessous de l’attendu, en hypothèse', () => {
    const sun = new Map([['d', 12.34]]);
    expect(sunHint('d', true, sun, 6)).toBe('journée ensoleillée (12,3 MJ/m²)'); // #518: the « why » is said once, under the table
    expect(sunHint('d', false, sun, 6)).toBeNull(); // the sun never raises the heating
    expect(sunHint('d', true, sun, 13)).toBeNull();
  });
});
