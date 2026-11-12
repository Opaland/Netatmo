// #452: the lower level — at equal cold, on the days with little sun and the nights, before /
// after a dated change. Fictitious days only.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Weather } from './analysis';
import { MIN_SIDE_DAYS } from './works';
import {
  type LowerDay,
  MAX_LOWER_MARKERS,
  MAX_LOWER_ROOMS,
  NO_LOWER,
  dimDays,
  lowerBeforeAfter,
  lowerDays,
  lowerSeasons,
  lowerSide,
  nightKwh,
  sunCut,
  validLower,
} from './lower';

/** A heating day: outdoor mean `t` (min = max = t), so 18 − t degree days. */
function day(d: string, t: number, kwh: number, sun: number | null, extra: Partial<LowerDay> = {}): LowerDay {
  return { day: d, kwh, night: null, tOut: t, dju: 18 - t, sun, tRoom: null, tProbe: null, ...extra };
}

/** `n` days from `from`, alternating dim (sun 2) and sunny (sun 10) days, 8 DJ each (10 °C). */
function span(from: string, n: number, dimPerDju: number, sunnyPerDju: number, extra: Partial<LowerDay> = {}): LowerDay[] {
  return Array.from({ length: n }, (_, i) => {
    const sunny = i % 2 === 1;
    return day(addDays(from, i), 10, 8 * (sunny ? sunnyPerDju : dimPerDju), sunny ? 10 : 2, extra);
  });
}

describe('niveau inférieur : préférences relues (#452)', () => {
  it('une valeur quelconque donne des préférences vides', () => {
    for (const v of [null, undefined, 3, 'x', [], [1], { rooms: 'r-salon' }]) expect(validLower(v)).toEqual({ ...NO_LOWER, rooms: [], markers: [] });
  });

  it('pièces sans doublon ni identifiant étrange, bornées ; sonde ou null', () => {
    const many = Array.from({ length: 20 }, (_, i) => `r-${i}`);
    const p = validLower({ rooms: ['r-ch2', 'r-ch2', '', '__proto__ x', 4, ...many], probe: 'm3' });
    expect(p.rooms[0]).toBe('r-ch2');
    expect(p.rooms).toHaveLength(MAX_LOWER_ROOMS);
    expect(new Set(p.rooms).size).toBe(p.rooms.length);
    expect(p.probe).toBe('m3');
    expect(validLower({ probe: { x: 1 } }).probe).toBeNull();
  });

  it('repères : vrais jours seulement, nature connue sinon « autre », triés, un par jour', () => {
    const p = validLower({
      markers: [
        { day: '2026-01-12', kind: 'joints', label: 'porte du garage' },
        { day: '2026-02-30', kind: 'joints' }, // not a day: read by Date as 2 March
        { day: '2025-12-01', kind: '__proto__', label: 'x'.repeat(200) },
        { day: '2026-01-12', kind: 'rideau' }, // same day: the last one wins
        'not a marker',
      ],
    });
    expect(p.markers.map((m) => [m.day, m.kind])).toEqual([
      ['2025-12-01', 'autre'],
      ['2026-01-12', 'rideau'],
    ]);
    expect(p.markers[0].label).toHaveLength(80);
    const lots = Array.from({ length: 50 }, (_, i) => ({ day: addDays('2025-01-01', i), kind: 'autre' }));
    expect(validLower({ markers: lots }).markers).toHaveLength(MAX_LOWER_MARKERS);
  });
});

describe('niveau inférieur : à froid égal (#452)', () => {
  it('ne garde que les jours de chauffe (moins de 15 °C dehors en moyenne)', () => {
    const weather: Weather = new Map([
      ['2026-01-01', [0, 4, 2]],
      ['2026-05-01', [12, 24, 18]],
      ['2026-04-01', [10, 20, 14.9]],
    ]);
    const heat = new Map([
      ['2026-01-01', 10],
      ['2026-05-01', 1],
      ['2026-04-01', 2],
      ['2026-01-02', 9], // no weather: left out
    ]);
    const days = lowerDays({ heat, night: new Map(), weather, sun: new Map([['2026-01-01', 3]]), room: new Map([['2026-01-01', 19]]), probe: new Map() });
    expect(days.map((d) => d.day)).toEqual(['2026-01-01', '2026-04-01']);
    expect(days[0]).toMatchObject({ kwh: 10, dju: 16, sun: 3, tRoom: 19, tProbe: null, night: null });
  });

  it('le seuil de soleil est la médiane des jours de chauffe ; aucun rayonnement : pas de seuil', () => {
    expect(sunCut([day('a', 5, 1, 4), day('b', 5, 1, 1), day('c', 5, 1, 9)])).toBe(4);
    expect(sunCut([day('a', 5, 1, 4), day('b', 5, 1, 2), day('c', 5, 1, null), day('d', 5, 1, 8), day('e', 5, 1, 6)])).toBe(5);
    expect(sunCut([day('a', 5, 1, null)])).toBeNull();
    expect(dimDays([day('a', 5, 1, 4), day('b', 5, 1, 9), day('c', 5, 1, null)], 4).map((d) => d.day)).toEqual(['a']);
    expect(dimDays([day('a', 5, 1, null)], null)).toHaveLength(1);
  });

  it('avant / après : la baisse se lit sur les jours peu ensoleillés, le soleil ne la masque pas', () => {
    // dim days 0.5 kWh/DJ before, 0.4 after (-20 %); sunny days 0.1 before and 0.3 after (a
    // sunnier spring on the south door would hide the gain if they were counted)
    const days = [...span('2025-10-01', 60, 0.5, 0.1), ...span('2026-01-12', 60, 0.4, 0.3)];
    const cut = sunCut(days);
    expect(cut).toBe(6);
    const r = lowerBeforeAfter(days, cut, '2026-01-12', '2025-10-01', '2026-03-12');
    expect(r.before.days).toBe(30);
    expect(r.after.days).toBe(30);
    expect(r.before.perDju).toBeCloseTo(0.5);
    expect(r.after.perDju).toBeCloseTo(0.4);
    expect(r.change).toBeCloseTo(-20);
    // every heating day, sunny ones included: the change turns into a rise
    const all = lowerBeforeAfter(days, null, '2026-01-12', '2025-10-01', '2026-03-12');
    expect(all.change!).toBeGreaterThan(0);
  });

  it(`sous ${MIN_SIDE_DAYS} jours retenus d'un côté, pas de chiffre`, () => {
    const days = [...span('2025-10-01', 2 * MIN_SIDE_DAYS - 2, 0.5, 0.1), ...span('2026-01-12', 60, 0.4, 0.3)];
    const r = lowerBeforeAfter(days, 6, '2026-01-12', '2025-10-01', '2026-03-12');
    expect(r.before.days).toBe(MIN_SIDE_DAYS - 1);
    expect(r.before.perDju).toBeNull();
    expect(r.change).toBeNull();
    expect(r.after.perDju).toBeCloseTo(0.4);
  });

  it('les nuits comptent tous les jours de chauffe, le soleil ne joue pas', () => {
    const before = span('2025-10-01', 40, 0.5, 0.1, { night: 2 });
    const after = span('2026-01-12', 40, 0.4, 0.3, { night: 1.5 });
    const r = lowerBeforeAfter([...before, ...after], 6, '2026-01-12', '2025-10-01', '2026-03-12');
    expect(r.before.nights).toBe(40);
    expect(r.before.nightPerDju).toBeCloseTo(2 / 8);
    expect(r.nightChange).toBeCloseTo(-25);
  });

  it('chambre et sonde : écart moyen au dehors sur les jours retenus', () => {
    const days = span('2025-10-01', 40, 0.5, 0.1, { tRoom: 19, tProbe: 13 });
    days[0].tProbe = null; // a hole in the probe is left out, not counted as 0
    const s = lowerSide(days, 6, '2025-10-01', '2026-01-01');
    expect(s.roomOverOut).toBeCloseTo(9);
    expect(s.probeOverOut).toBeCloseTo(3);
    expect(s.tOut).toBeCloseTo(10);
  });

  it('un hiver par ligne, de septembre à août', () => {
    const days = [...span('2024-12-01', 30, 0.5, 0.1), ...span('2025-08-20', 30, 0.4, 0.1)];
    const s = lowerSeasons(days, 6);
    expect(s.map((x) => [x.season, x.side.days])).toEqual([
      ['2024-2025', 21],
      ['2025-2026', 9],
    ]);
  });
});

describe('niveau inférieur : nuits à la demi-heure (#452)', () => {
  const night = (wh: number) => [...Array(12).fill(wh), ...Array(36).fill(999)];
  it('somme de 0 h à 6 h des pièces choisies, en kWh', () => {
    const a = new Map([['2026-01-05', night(100)]]);
    const b = new Map([['2026-01-05', night(50)]]);
    const n = nightKwh([a, b]);
    expect([...n.keys()]).toEqual(['2026-01-05']);
    expect(n.get('2026-01-05')).toBeCloseTo(1.8);
  });

  it('une nuit trouée ou une pièce sans relevé : la nuit est écartée, pas sous-comptée', () => {
    const holed = night(100);
    holed[3] = null;
    expect(nightKwh([new Map([['2026-01-05', holed]])]).size).toBe(0);
    const a = new Map([['2026-01-05', night(100)], ['2026-01-06', night(100)]]);
    const b = new Map([['2026-01-05', night(50)]]);
    expect([...nightKwh([a, b]).keys()]).toEqual(['2026-01-05']);
  });
});
