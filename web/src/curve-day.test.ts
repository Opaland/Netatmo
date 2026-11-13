// #568: 77 days of the first real report whose hours do not make the day (`somme-jour`), July and
// August 2026 whole. The « Une journée » card of the curve says the meter's total of the day, which
// counts, and says when the curve of that day does not retrieve it or misses half hours.
import { describe, expect, it } from 'vitest';
import { type Curve, DAY_GAP_SHARE, DAY_GAP_WH, SLOTS, curveVsDay, dayGapExceeded, dayNote } from './curve';
import sommeJour from './__fixtures__/somme-jour.json';

const TZ = 'Europe/Paris';

/** A fictional day: `wh` in each half hour of the local day (the spring day has 46). */
function day(d: string, wh: number, keys: string[] = SLOTS): Curve {
  return new Map(keys.map((s) => [`${d}T${s}`, wh]));
}

describe('#568 : une règle avec l’audit (somme-jour.json)', () => {
  it('les constantes sont celles de l’audit', () => {
    expect([DAY_GAP_WH, DAY_GAP_SHARE]).toEqual([sommeJour.ecart_absolu_wh, sommeJour.ecart_relatif]);
  });
  it.each(sommeJour.cases as [number, number, boolean][])('%d Wh contre %d Wh : écart %s', (fine, total, gap) => {
    expect(dayGapExceeded(fine, total)).toBe(gap);
  });
});

describe('#568 : la courbe d’un jour face au total du compteur', () => {
  it('une courbe qui retrouve le jour le dit, sans réserve', () => {
    const c = curveVsDay(day('2026-07-14', 100), TZ, '2026-07-14', 4.8); // 48 × 100 Wh = 4,8 kWh
    expect(c).toMatchObject({ ok: true, curveKwh: 4.8, halves: 48, expected: 48 });
    expect(dayNote(c)).toBe('Total du jour (compteur) : 4,8 kWh, que la courbe retrouve.');
  });

  it('une courbe au-dessus du jour (une seconde grandeur ajoutée : +20 %) : le total du jour fait foi', () => {
    const c = curveVsDay(day('2026-07-14', 120), TZ, '2026-07-14', 4.8);
    expect(c?.ok).toBe(false);
    const note = dayNote(c);
    expect(note).toContain('Total du jour (compteur) : 4,8 kWh');
    expect(note).toContain('font 5,8 kWh');
    expect(note).toContain('ne retrouvent pas le total du jour, qui fait foi');
  });

  it('une demi-heure manquante : la courbe est dite incomplète, le total du jour reste celui du compteur', () => {
    const c = curveVsDay(day('2026-07-14', 100, SLOTS.filter((s) => s !== '12:30')), TZ, '2026-07-14', 4.8);
    expect(c).toMatchObject({ ok: false, curveKwh: null, halves: 47, expected: 48 });
    expect(dayNote(c)).toContain('Courbe incomplète ce jour-là (47 demi-heures sur 48) : le total du jour fait foi');
  });

  it('le jour du changement d’heure de printemps est complet avec 46 demi-heures', () => {
    const spring = SLOTS.filter((s) => !s.startsWith('02:'));
    const c = curveVsDay(day('2026-03-29', 100, spring), TZ, '2026-03-29', 4.6);
    expect(c).toMatchObject({ ok: true, halves: 46, expected: 46 });
  });

  it('relecture : pas de « 0 demi-heures », singulier pour une, petites énergies en Wh', () => {
    expect(dayNote(curveVsDay(new Map(), TZ, '2026-07-14', 4.8))).toBe('Total du jour (compteur) : 4,8 kWh. Pas de courbe ce jour-là : le total du jour fait foi.');
    expect(dayNote(curveVsDay(day('2026-07-14', 100, ['12:00']), TZ, '2026-07-14', 0.04))).toBe(
      'Total du jour (compteur) : 40 Wh. Courbe incomplète ce jour-là (1 demi-heure sur 48) : le total du jour fait foi.',
    );
  });

  it('un jour rangé avant la nouvelle lecture le dit, pas un jour d’après', () => {
    expect(dayNote(curveVsDay(day('2026-07-14', 120), TZ, '2026-07-14', 4.8))).toContain('rangé avec l’ancienne lecture de la courbe, pas encore reprise');
    expect(dayNote(curveVsDay(day('2026-11-20', 120), TZ, '2026-11-20', 4.8))).not.toContain('ancienne lecture');
  });

  it('sans total du compteur ce jour-là, rien n’est dit', () => {
    expect(curveVsDay(day('2026-07-14', 100), TZ, '2026-07-14', undefined)).toBeNull();
    expect(dayNote(null)).toBe('');
  });
});
