// #622: the survivors of the first mutation run on curve.ts (76,0 %), each test seen red on its
// mutant. Fictional curves only. What is left, and why, is in docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it } from 'vitest';
import {
  type Curve,
  SLOTS,
  curveVsDay,
  dayCurve,
  dayNote,
  halfHourCounts,
  lastCurveDay,
  localMidnight,
  measuredWatts,
  peakHalfHour,
  percentile,
  talon,
  typicalDay,
  typicalHourly,
  typicalHourlyCached,
} from './curve';

const TZ = 'Europe/Paris';
// 2025-11-03 is a Monday, 2025-11-08 a Saturday, 2025-11-09 a Sunday.
const MON = '2025-11-03';
const TUE = '2025-11-04';
const WED = '2025-11-05';
const SAT = '2025-11-08';

/** `wh` in every half hour of the given days (plain 24-hour days). */
function curveOf(days: string[], wh: number | ((day: string, slot: string) => number)): Curve {
  const c: Curve = new Map();
  for (const d of days) for (const s of SLOTS) c.set(`${d}T${s}`, typeof wh === 'number' ? wh : wh(d, s));
  return c;
}

/** kWh for each local hour of a day. */
function hoursOf(day: string, kwh: (h: number) => number): [string, number][] {
  return Array.from({ length: 24 }, (_, h) => [`${day}T${String(h).padStart(2, '0')}`, kwh(h)]);
}

describe('#622 : les demi-heures de l’axe et les fuseaux', () => {
  it('48 demi-heures, de 00:00 à 23:30', () => {
    expect(SLOTS).toHaveLength(48);
    expect([SLOTS[0], SLOTS[1], SLOTS[2], SLOTS[21], SLOTS[47]]).toEqual(['00:00', '00:30', '01:00', '10:30', '23:30']);
  });

  it('un jour dont minuit n’existe pas commence à la première heure qui existe', () => {
    // Asia/Beirut moves its clocks at local midnight: 2025-03-30 starts at 01:00 (22:00 UTC)
    expect(localMidnight('Asia/Beirut', '2025-03-30')).toBe(Date.parse('2025-03-29T22:00:00Z'));
    expect(localMidnight(TZ, '2025-03-30')).toBe(Date.parse('2025-03-29T23:00:00Z'));
  });

  it('un changement d’heure d’une demi-heure double la bonne demi-heure', () => {
    // Australia/Lord_Howe goes back 30 minutes at 02:00: 01:30 happens twice
    const c = halfHourCounts('Australia/Lord_Howe', '2025-04-06')!;
    expect(c.get('01:30')).toBe(2);
    expect(c.get('01:00')).toBe(1);
  });
});

describe('#622 : la courbe d’un jour face au total du compteur', () => {
  it('ne compte que les demi-heures de ce jour', () => {
    const c = curveOf([MON], 100);
    for (const s of SLOTS.slice(0, 10)) c.set(`${TUE}T${s}`, 100);
    expect(curveVsDay(c, TZ, TUE, 1)).toMatchObject({ halves: 10, expected: 48, curveKwh: null });
  });

  it('une courbe incomplète n’est jamais « bonne », même pour un jour à 0 kWh', () => {
    const c: Curve = new Map([[`${MON}T12:00`, 0]]);
    expect(curveVsDay(c, TZ, MON, 0)?.ok).toBe(false);
  });

  it('le premier jour de la nouvelle lecture est déjà « nouveau »', () => {
    const c = curveOf(['2026-11-13'], 120);
    expect(curveVsDay(c, TZ, '2026-11-13', 4.8)?.reading).toBe('new');
    expect(dayNote(curveVsDay(c, TZ, '2026-11-13', 4.8))).toBe(
      'Total du jour (compteur) : 4,8 kWh. Les demi-heures de la courbe font 5,8 kWh : elles ne retrouvent pas le total du jour, qui fait foi ; la courbe de ce jour est à lire avec prudence.',
    );
  });

  it('une petite énergie se dit en Wh entiers', () => {
    expect(dayNote(curveVsDay(new Map(), TZ, MON, 0.0404))).toBe('Total du jour (compteur) : 40\u00a0Wh. Pas de courbe ce jour-là : le total du jour fait foi.');
  });

  it('1 kWh tout juste se dit en kWh', () => {
    expect(dayNote(curveVsDay(new Map(), TZ, MON, 1))).toBe('Total du jour (compteur) : 1,0 kWh. Pas de courbe ce jour-là : le total du jour fait foi.');
  });
});

describe('#622 : le dernier jour de la courbe (vues Linky, voiture, panneaux)', () => {
  it('rend le jour le plus récent, quel que soit l’ordre des clés', () => {
    const c: Curve = new Map([
      [`${TUE}T10:00`, 1],
      [`${WED}T00:00`, 1],
      [`${MON}T23:30`, 1],
    ]);
    expect(lastCurveDay(c)).toBe(WED);
  });

  it('une courbe vide n’a pas de dernier jour', () => {
    expect(lastCurveDay(new Map())).toBeNull();
  });
});

describe('#622 : journée type de la courbe', () => {
  it('le samedi est un jour de week-end, et seule la fenêtre compte', () => {
    const c = curveOf(['2025-11-02', SAT, '2025-11-10'], 100); // Sunday and Monday outside the window
    c.set(`${SAT}T00:15`, 999); // not a half hour of the axis: neither a value nor a day
    c.set(`${MON}T00:15`, 999);
    const t = typicalDay(c, TZ, MON, '2025-11-09');
    expect(t.days).toEqual({ weekday: 0, weekend: 1 });
    expect(t.weekend[0]).toBe(200);
    expect(t.weekday[0]).toBeNull();
  });
});

describe('#622 : journée type des radiateurs (moyenne par jour)', () => {
  it('chaque heure vaut la moyenne des jours, calculée à la main', () => {
    // Monday 1 kWh each hour, Tuesday 3 kWh: 2 000 W on average; a room left out of the set
    const hourly = new Map([
      ['r1', new Map([...hoursOf(TUE, () => 3), ...hoursOf(MON, () => 1)])],
      ['r2', new Map(hoursOf(MON, () => 50))],
    ]);
    const out = typicalHourly(hourly, new Set(['r1']), TZ, new Set([MON, TUE]));
    expect(out.weekday).toEqual(new Array(48).fill(2000));
    expect(out.weekend).toEqual(new Array(48).fill(0));
  });

  it('un jour de la courbe sans relevé horaire, mais avant le dernier relevé, compte pour zéro', () => {
    const hourly = new Map([['r1', new Map([...hoursOf(MON, () => 2), ...hoursOf(WED, () => 0)])]]);
    const out = typicalHourly(hourly, new Set(['r1']), TZ, new Set([MON, TUE]));
    expect(out.weekday[0]).toBe(1000); // (2 000 + 0) / 2
  });

  it('un jour après le dernier relevé horaire n’est pas un zéro, même rangé dans le désordre', () => {
    // the later day comes first in the map: the last day is the latest, not the last read
    const hourly = new Map([['r1', new Map([...hoursOf(TUE, () => 1), ...hoursOf(MON, () => 3)])]]);
    const out = typicalHourly(hourly, new Set(['r1']), TZ, new Set([MON, TUE, WED]));
    expect(out.weekday[0]).toBe(2000); // (3 000 + 1 000) / 2, Wednesday not collected yet
  });

  it('le cache distingue deux fenêtres de jours', () => {
    const hourly = new Map([['r1', new Map([...hoursOf(MON, () => 1), ...hoursOf(TUE, () => 3)])]]);
    expect(typicalHourlyCached(hourly, new Set(['r1']), TZ, new Set([MON])).weekday[0]).toBe(1000);
    expect(typicalHourlyCached(hourly, new Set(['r1']), TZ, new Set([TUE])).weekday[0]).toBe(3000);
  });
});

describe('#622 : centile (talon)', () => {
  it('interpole entre deux valeurs non triées, en nombre pair et impair', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25); // position 1,5 : 20 + (30 − 20) × 0,5
    expect(percentile([5, 1, 3], 0.25)).toBe(2); // position 0,5 : 1 + (3 − 1) × 0,5
    expect(percentile([100, 2, 30], 0.75)).toBe(65); // position 1,5 sur [2, 30, 100]
  });
});

describe('#622 : puissance mesurée par les radiateurs', () => {
  it('l’heure doublée du passage à l’heure d’hiver vaut deux heures', () => {
    const m = measuredWatts(new Map([['r1', new Map([['2025-10-26T02', 1]])]]), new Set(['r1']), TZ);
    expect(m.byHour.get('2025-10-26T02')).toBe(500);
  });

  it('bornes de la fenêtre comprises, dernier jour le plus récent', () => {
    const hours = new Map([...hoursOf(WED, () => 1), ...hoursOf(TUE, () => 1), ...hoursOf(MON, () => 1), ...hoursOf('2025-11-02', () => 1)]);
    const m = measuredWatts(new Map([['r1', hours]]), new Set(['r1']), TZ, MON, TUE);
    expect(m.last).toBe(TUE);
    expect([...m.byHour.keys()].map((k) => k.slice(0, 10)).filter((d, i, a) => a.indexOf(d) === i).sort()).toEqual([MON, TUE]);
  });
});

describe('#622 : talon et pointe, bornes de la fenêtre', () => {
  // a night load of 400 W inside the window, 100 W the day before and after; a 9 000 W peak
  // on each side of the window, 5 000 W on its first and last day
  const nights = (d: string) => (d === MON || d === TUE ? 200 : 50);
  const c = curveOf(['2025-11-02', MON, TUE, WED], (d, s) => (s >= '01:00' && s < '05:00' ? nights(d) : 10));
  c.set(`2025-11-02T18:00`, 4500);
  c.set(`${WED}T18:00`, 4500);
  c.set(`${MON}T18:00`, 2500);
  c.set(`${TUE}T19:00`, 2500);

  it('le talon ne lit que les nuits de [from, to]', () => {
    expect(talon(c, TZ, MON, TUE)).toEqual({ watts: 400, samples: 16 });
  });

  it('pas de nuit dans la fenêtre : pas de talon', () => {
    expect(talon(c, TZ, '2025-12-01', '2025-12-02')).toBeNull();
  });

  it('la pointe ne lit que [from, to], et garde la première à égalité', () => {
    expect(peakHalfHour(c, TZ, MON, TUE)).toEqual({ key: `${MON}T18:00`, watts: 5000 });
    // the highest is neither the first nor the last half hour read
    expect(peakHalfHour(c, TZ, TUE, TUE)).toEqual({ key: `${TUE}T19:00`, watts: 5000 });
  });
});

describe('#622 : la courbe d’un jour', () => {
  it('en watts, demi-heure doublée de l’automne comprise', () => {
    const c: Curve = new Map([
      ['2025-10-26T02:00', 1000], // 1 000 Wh over two real half hours: 1 000 W, not 2 000
      ['2025-10-26T12:00', 250],
    ]);
    const v = dayCurve(c, TZ, '2025-10-26').values;
    expect(v[SLOTS.indexOf('02:00')]).toBe(1000);
    expect(v[SLOTS.indexOf('12:00')]).toBe(500);
  });
});
