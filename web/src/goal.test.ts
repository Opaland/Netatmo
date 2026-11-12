// #152: a goal for a room at equal climate. Fictitious days only.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays, minusYears } from './aggregate';
import type { Weather } from './analysis';
import { GOAL_CHOICES, MAX_GOAL, goalOf, goalProgress, goalSentence, validGoals, withGoal } from './goal';

const LAST = '2026-01-31';
/** Two seasons, Sept to `LAST`: each day `t` °C (so 18 − t degree days), `perDju` kWh per degree day. */
function seasons(tNow: number, tRef: number, perNow: number, perRef: number): { records: DayRecord[]; weather: Weather } {
  const records: DayRecord[] = [];
  const weather: Weather = new Map();
  for (let d = '2025-09-01'; d <= LAST; d = addDays(d, 1)) {
    const r = minusYears(d);
    weather.set(d, [tNow, tNow, tNow]);
    weather.set(r, [tRef, tRef, tRef]);
    records.push({ day: d, room: 'r-ch', cat: 'heating', kwh: perNow * (18 - tNow) });
    records.push({ day: r, room: 'r-ch', cat: 'heating', kwh: perRef * (18 - tRef) });
    records.push({ day: d, room: 'r-autre', cat: 'heating', kwh: 99 });
  }
  return { records, weather };
}

describe('objectif de pièce à climat égal (#152)', () => {
  it('un hiver plus froid à kWh par degré-jour égal : aucune progression ni recul', () => {
    const { records, weather } = seasons(2, 8, 0.5, 0.5); // much colder this winter, more kWh
    const p = goalProgress(records, 'r-ch', weather, LAST, 10)!;
    expect(p.now.kwh).toBeGreaterThan(p.ref.kwh);
    expect(p.change).toBeCloseTo(0, 9);
    expect(p.share).toBe(0);
  });

  it('−6 % par degré-jour pour −10 % visés : 60 % du chemin, une phrase d’encouragement', () => {
    const { records, weather } = seasons(5, 8, 0.47, 0.5);
    const p = goalProgress(records, 'r-ch', weather, LAST, 10)!;
    expect(p.change).toBeCloseTo(-6, 9);
    expect(p.share).toBeCloseTo(0.6, 9);
    expect(p.from).toBe('2025-09-01');
    expect(p.refFrom).toBe('2024-09-01');
    expect(goalSentence(p)).toBe('−6 % à climat égal : déjà 60 % du chemin vers −10 %. Continuez, chaque degré compte.');
  });

  it('objectif atteint ; hausse dite sans reproche, avec une piste', () => {
    const ok = seasons(5, 8, 0.44, 0.5);
    const done = goalProgress(ok.records, 'r-ch', ok.weather, LAST, 10)!;
    expect(goalSentence(done)).toMatch(/^Objectif atteint : −12 % à climat égal, pour −10 % visés\./);
    const up = seasons(5, 8, 0.52, 0.5);
    const p = goalProgress(up.records, 'r-ch', up.weather, LAST, 10)!;
    expect(p.share).toBe(0);
    expect(goalSentence(p)).toMatch(/^\+4 % à climat égal : la baisse reste à venir\. Une piste : 1 °C de moins demandé, c’est environ 7 % de chauffage en moins\.$/);
    expect(goalSentence(p)).not.toMatch(/trop|mauvais|échec/);
  });

  it('arrondi : −9,6 % s’affiche −10 %, et se lit comme l’objectif de −10 % atteint', () => {
    const { records, weather } = seasons(5, 8, 0.452, 0.5);
    const p = goalProgress(records, 'r-ch', weather, LAST, 10)!;
    expect(p.change).toBeCloseTo(-9.6, 9);
    expect(goalSentence(p)).toMatch(/^Objectif atteint : −10/);
  });

  it('jours sans température d’un côté : écartés des deux saisons', () => {
    const { records, weather } = seasons(5, 8, 0.5, 0.5);
    weather.delete('2024-12-25');
    records.push({ day: '2025-12-25', room: 'r-ch', cat: 'heating', kwh: 500 }); // a day not comparable
    const p = goalProgress(records, 'r-ch', weather, LAST, 10)!;
    expect(p.change).toBeCloseTo(0, 9);
  });

  it('pas assez de froid, ou pas de chauffage l’an dernier : rien', () => {
    const mild = seasons(17.9, 17.9, 0.5, 0.5);
    expect(goalProgress(mild.records, 'r-ch', mild.weather, LAST, 10)).toBeNull();
    const mildBefore = seasons(5, 17.9, 0.5, 0.5); // a cold winter after an (almost) heatless one
    expect(goalProgress(mildBefore.records, 'r-ch', mildBefore.weather, LAST, 10)).toBeNull();
    const none = seasons(5, 8, 0.5, 0);
    expect(goalProgress(none.records, 'r-ch', none.weather, LAST, 10)).toBeNull();
  });

  it('objectifs relus : pièces sûres, pourcentages entiers bornés, clés propres seulement', () => {
    expect(GOAL_CHOICES.every((g) => g >= 1 && g <= MAX_GOAL)).toBe(true);
    for (const v of [null, undefined, 3, 'x', [], [10]]) expect(validGoals(v)).toEqual({});
    const g = validGoals(JSON.parse('{"r-ch": 10, "r-x": 0, "r-y": 51, "r-z": 7.5, "r-w": "10", "": 10, "a b": 10, "__proto__": 10}'));
    expect(g).toEqual({ 'r-ch': 10 });
    expect(goalOf(g, 'constructor')).toBeNull();
    expect(goalOf(g, 'r-ch')).toBe(10);
    expect(withGoal(g, 'r-sejour', 15)).toEqual({ 'r-ch': 10, 'r-sejour': 15 });
    expect(withGoal(g, 'r-ch', null)).toEqual({});
  });
});
