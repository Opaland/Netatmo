// #678: the survivors of the first mutation run on analysis.ts (58,2 %), function by function, each
// test seen red on its mutant. Fictitious data only. What is left, and why: docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it, vi } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import {
  type Prices,
  type TariffMap,
  type TrveRow,
  type Weather,
  anomalies,
  compareOffers,
  dayProfile,
  daySplits,
  daysAbove,
  djuBetween,
  energyCost,
  energyCostTrve,
  fitSeason,
  inferKvaChange,
  linearFit,
  monthlyDju,
  offPeakColumn,
  offPeakShares,
  parseTempoCsv,
  parseTrveCsv,
  projectYear,
  roomDeltas,
  signaturePoints,
  subscriptionCost,
  subscriptionTrve,
  tariffSplit,
  trveAt,
  verdict,
  weekHourGrid,
} from './analysis';

const rec = (day: string, kwh: number, room = 'a', cat: DayRecord['cat'] = 'heating'): DayRecord => ({ day, room, cat, kwh });
const tmap = (entries: [string, [string, [number, number, number]][]][]): TariffMap => new Map(entries.map(([room, days]) => [room, new Map(days)]));
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** A weather whose mean is `t` every day (min t − 2, max t + 2): `18 − t` degree days when t < 18. */
const weatherOf = (days: string[], t: (d: string, i: number) => number): Weather => new Map(days.map((d, i) => [d, [t(d, i) - 2, t(d, i) + 2, t(d, i)]]));

describe('#678 : le coût de l’énergie, colonnes du tarif', () => {
  const tariffs = tmap([['a', [['2025-01-02', [1, 2, 3]]]]]);
  // the columns of the day add up to 6 kWh, the day itself says 7: each sum is told apart
  const recs = [rec('2025-01-02', 7), rec('2025-01-03', 10)];
  it('chaque colonne à son prix, un jour sans détail au prix de base', () => {
    const p: Prices = { base: 0.1, t1: 0.2, t2: 0.3, sub: null };
    expect(energyCost(recs, tariffs, p)).toBeCloseTo(1 * 0.1 + 2 * 0.2 + 3 * 0.3 + 10 * 0.1, 9);
  });
  it('une seule colonne connue : l’autre au prix de base, dans les deux sens', () => {
    expect(energyCost(recs, tariffs, { base: 0.1, t1: 0.2, t2: null, sub: null })).toBeCloseTo(1 * 0.1 + 2 * 0.2 + 3 * 0.1 + 1, 9);
    expect(energyCost(recs, tariffs, { base: 0.1, t1: null, t2: 0.3, sub: null })).toBeCloseTo(1 * 0.1 + 2 * 0.1 + 3 * 0.3 + 1, 9);
  });
  it('sans prix des colonnes, le détail n’est pas lu : les kWh du jour au prix de base', () => {
    expect(energyCost(recs, tariffs, { base: 0.1, t1: null, t2: null, sub: null })).toBeCloseTo(17 * 0.1, 9);
  });
  it('hasPrices : une colonne seule suffit (module rechargé : la fonction est définie au chargement)', async () => {
    vi.resetModules();
    const m = await import('./analysis');
    expect(m.hasPrices({ base: null, t1: 0.2, t2: null, sub: null })).toBe(true);
    expect(m.hasPrices({ base: null, t1: null, t2: 0.3, sub: null })).toBe(true);
    expect(m.hasPrices({ base: 0.1, t1: null, t2: null, sub: null })).toBe(true);
    expect(m.hasPrices(m.NO_PRICES)).toBe(false);
    // the readers of the CRE files: dates and decimals in French
    expect(m.parseTrveCsv('DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_TTC;PART_VARIABLE_TTC\n01/02/2025;31/07/2025;9;220,1;0,25')).toEqual([
      { from: '2025-02-01', to: '2025-07-31', kva: 9, fixedYear: 220.1, hc: 0.25, hp: 0.25 },
    ]);
  });
  it('abonnement nul ou absent : 0 €', () => {
    expect(subscriptionCost('2025-01-01', '2025-12-31', { base: 0.1, t1: null, t2: null, sub: null })).toBe(0);
    expect(subscriptionCost('2025-01-01', '2025-01-01', { base: 0.1, t1: null, t2: null, sub: 10 })).toBeCloseTo((10 * 12) / 365.25, 9);
  });
});

describe('#678 : colonne des heures creuses et répartition', () => {
  it('à égalité de kWh du chauffe-eau, la colonne 2', () => {
    expect(offPeakColumn(tmap([['w', [['2025-01-01', [0, 3, 3]]]]]), ['w'])).toBe(2);
    expect(offPeakColumn(tmap([['w', [['2025-01-01', [0, 4, 3]]]]]), ['w'])).toBe(1);
    expect(offPeakColumn(tmap([['w', [['2025-01-01', [5, 0, 0]]]]]), ['w'])).toBeNull();
  });
  it('tariffSplit additionne chaque colonne, et les kWh sans détail à part', () => {
    const t = tmap([['a', [['2025-01-02', [1, 2, 3]], ['2025-01-03', [4, 5, 6]]]]]);
    expect(tariffSplit([rec('2025-01-02', 6), rec('2025-01-03', 15), rec('2025-01-04', 7)], t)).toEqual([5, 7, 9, 7]);
  });
});

describe('#678 : degrés-jours', () => {
  it('djuBetween compte les jours qui ont une météo, pas les autres', () => {
    const w = weatherOf(['2025-01-01', '2025-01-03'], () => 8);
    expect(djuBetween(w, '2025-01-01', '2025-01-03')).toEqual({ dju: 20, days: 2 });
  });
  it('monthlyDju : par année et par mois, la normale sur les mois d’au moins 28 jours', () => {
    const days = [...span('2022-01-01', '2022-01-27'), ...span('2023-01-01', '2023-01-28'), ...span('2024-01-01', '2024-01-31'), ...span('2024-03-01', '2024-03-10')];
    const w = weatherOf(days, (d) => (d.startsWith('2023') ? 10 : d.startsWith('2024-01') ? 8 : 6)); // 8, 10, 12 DJ a day
    const { byYear, normal } = monthlyDju(w);
    expect([...byYear.keys()]).toEqual([2022, 2023, 2024]);
    expect(byYear.get(2022)![0]).toBeCloseTo(27 * 12, 9);
    expect(byYear.get(2023)![0]).toBeCloseTo(28 * 8, 9);
    expect(byYear.get(2024)).toEqual([31 * 10, 0, 10 * 12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // January: 2023 (28 days) and 2024 (31), not 2022 (27); March: no complete year
    expect(normal[0]).toBeCloseTo((28 * 8 + 31 * 10) / 2, 9);
    expect(normal.slice(1)).toEqual(new Array(11).fill(0));
  });
});

describe('#678 : la droite de la signature', () => {
  const line = (n: number, f: (x: number) => number): [number, number][] => Array.from({ length: n }, (_, i) => [i, f(i)]);
  it('dix points au moins', () => {
    expect(linearFit(line(9, (x) => 2 * x))).toBeNull();
    expect(linearFit(line(10, (x) => 2 * x))!.n).toBe(10);
  });
  it('r² calculé à la main, et l’équilibre d’une pente négative', () => {
    const pts: [number, number][] = line(10, (x) => 20 - 2 * x + (x % 2 ? 1 : -1));
    const fit = linearFit(pts)!;
    const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
    const ssTot = pts.reduce((s, [, y]) => s + (y - my) ** 2, 0);
    const ssRes = pts.reduce((s, [x, y]) => s + (y - (fit.slope * x + fit.intercept)) ** 2, 0);
    expect(ssRes).toBeGreaterThan(0);
    expect(fit.r2).toBeCloseTo(1 - ssRes / ssTot, 9);
    expect(fit.r2).toBeLessThan(1);
    expect(fit.balance).toBeCloseTo(-fit.intercept / fit.slope, 9);
  });
  it('une consommation constante : r² 0, pente nulle, pas d’équilibre', () => {
    const fit = linearFit(line(10, () => 5))!;
    expect(fit.slope).toBe(0);
    expect(fit.r2).toBe(0);
    expect(fit.balance).toBeNull();
  });
  it('une pente positive n’a pas d’équilibre', () => {
    expect(linearFit(line(10, (x) => x))!.balance).toBeNull();
  });
  it('signaturePoints : le chauffage seul, par saison, jours sans météo écartés', () => {
    const w = weatherOf(['2024-08-31', '2024-09-01'], () => 5);
    const pts = signaturePoints([rec('2024-08-31', 2), rec('2024-08-31', 1), rec('2024-09-01', 3), rec('2024-09-01', 9, 'w', 'water_heater'), rec('2024-09-02', 4)], w);
    expect([...pts]).toEqual([
      ['2023-2024', [[5, 3, '2024-08-31']]],
      ['2024-2025', [[5, 3, '2024-09-01']]],
    ]);
  });
  it('fitSeason ne garde que les jours sous 15 °C et au-dessus de 0,2 kWh', () => {
    const pts: [number, number, string][] = Array.from({ length: 10 }, (_, i) => [i, 30 - i, `d${i}`]);
    const extra: [number, number, string][] = [
      [15, 50, 'x'],
      [16, 50, 'y'],
      [3, 0.2, 'z'],
      [3, 0.1, 'v'],
    ];
    expect(fitSeason([...pts, ...extra])!.n).toBe(10);
    expect(fitSeason([...pts.slice(0, 9), [14.9, 15, 'e'] as [number, number, string]])!.n).toBe(10);
    expect(fitSeason([...pts.slice(0, 9), [3, 0.21, 'e'] as [number, number, string]])!.n).toBe(10);
  });
});

describe('#678 : la projection de fin d’année', () => {
  it('le premier jour des données, même rangées dans le désordre (module rechargé)', async () => {
    vi.resetModules();
    const m = await import('./analysis');
    const recs = [rec('2024-03-01', 10), rec('2023-01-01', 10), rec('2023-12-01', 30), rec('2024-01-15', 5)];
    // 2023 measured from 1 January: ratio 30 / 10 = 3
    expect(m.projectYear(recs, '2024-06-30')).toEqual({ projected: 15 * 4, ytd: 15, basis: 1 });
    // first day 2024-03-01 (the first record): 2023 not measured from 1 January
    expect(m.projectYear(recs, '2024-06-30', '2023-06-01')).toBeNull();
    expect(m.verdict([rec('2024-01-10', 4), rec('2023-01-10', 2)], '2024-01-10', '2024-01-10', null)!.expected).toBe(2);
  });
  it('les jours après le dernier jour et les années suivantes ne comptent pas', () => {
    const recs = [rec('2023-03-01', 10), rec('2023-09-01', 20), rec('2024-03-01', 5), rec('2024-09-01', 100), rec('2025-03-01', 7), rec('2025-09-01', 1)];
    expect(projectYear(recs, '2024-06-30', '2023-01-01')).toEqual({ projected: 5 * 3, ytd: 5, basis: 1 });
  });
  it('une année d’avant sans « jusqu’ici » ou sans « reste » n’est pas une base', () => {
    const recs = [rec('2021-03-01', 10), rec('2022-09-01', 40), rec('2023-03-01', 10), rec('2023-09-01', 20), rec('2024-03-01', 5), rec('2022-03-01', 0), rec('2021-09-01', 0)];
    expect(projectYear(recs, '2024-06-30', '2021-01-01')).toEqual({ projected: 5 * 3, ytd: 5, basis: 1 });
  });
});

describe('#678 : le verdict, bornes vues des deux côtés', () => {
  it('une année de référence sans aucun kWh n’est pas une référence', () => {
    const recs = [rec('2025-01-10', 10), rec('2024-01-10', 10)];
    expect(verdict(recs, '2025-01-10', '2025-01-10', null, '2023-01-01')!.expected).toBe(10);
  });
  it('rien mesuré cette fois : pas de verdict', () => {
    expect(verdict([rec('2025-01-10', 0), rec('2024-01-10', 10)], '2025-01-10', '2025-01-10', null)).toBeNull();
  });
  it('+10 % et −10 % tout juste : normal', () => {
    expect(verdict([rec('2025-01-10', 11), rec('2024-01-10', 10)], '2025-01-10', '2025-01-10', null)!.level).toBe('normal');
    expect(verdict([rec('2025-01-10', 9), rec('2024-01-10', 10)], '2025-01-10', '2025-01-10', null)!.level).toBe('normal');
    expect(verdict([rec('2025-01-10', 11.5), rec('2024-01-10', 10)], '2025-01-10', '2025-01-10', null)!.level).toBe('high');
    expect(verdict([rec('2025-01-10', 8.5), rec('2024-01-10', 10)], '2025-01-10', '2025-01-10', null)!.level).toBe('low');
  });
  it('à climat égal : seulement les références de plus de 5 DJ, et un froid mesuré cette fois', () => {
    const days = ['2025-01-10', '2024-01-10', '2023-01-10'];
    // 2025: 10 DJ; 2024: 5 DJ exactly (left out); 2023: 8 DJ
    const w = weatherOf(days, (d) => (d.startsWith('2025') ? 8 : d.startsWith('2024') ? 13 : 10));
    const recs = [rec('2025-01-10', 20), rec('2024-01-10', 30), rec('2023-01-10', 16), rec('2023-01-10', 4, 'w', 'water_heater')];
    const v = verdict(recs, '2025-01-10', '2025-01-10', w, '2023-01-01')!;
    expect(v.climate).toBe(true);
    expect(v.expected).toBeCloseTo((16 / 8) * 10 + 4, 9);
    // no degree day now: the plain average
    const warm = weatherOf(days, (d) => (d.startsWith('2025') ? 20 : 10));
    const v2 = verdict(recs, '2025-01-10', '2025-01-10', warm, '2023-01-01')!;
    expect(v2.climate).toBe(false);
    expect(v2.expected).toBe(25);
    // every reference at 5 DJ or less: the plain average
    const mild = weatherOf(days, (d) => (d.startsWith('2025') ? 8 : 13));
    const v3 = verdict(recs, '2025-01-10', '2025-01-10', mild, '2023-01-01')!;
    expect(v3.climate).toBe(false);
    expect(v3.expected).toBe(25);
  });
});

describe('#678 : la grille semaine × heure et le profil du jour', () => {
  // 2025-01-06 is a Monday
  const hourly = new Map([
    [
      'a',
      new Map([
        ['2025-01-06T08', 2],
        ['2025-01-13T08', 4],
        ['2025-01-07T23', 1],
        ['2025-01-05T10', 50], // Sunday, before the window
        ['2025-01-14T00', 70], // after the window
      ]),
    ],
    ['b', new Map([['2025-01-06T08', 10]])],
  ]);
  it('la moyenne par jour de la semaine de chaque heure, la fenêtre bornes comprises', () => {
    const g = weekHourGrid(hourly, null, '2025-01-06', '2025-01-13');
    expect(g).toHaveLength(7);
    expect(g.every((row) => row.length === 24)).toBe(true);
    expect(g[0][8]).toBe((2 + 4 + 10) / 2); // two Mondays
    expect(g[1][23]).toBe(1);
    expect(g[6][10]).toBe(0);
    expect(g.flat().reduce((s, v) => s + v, 0)).toBe(9);
  });
  it('une pièce hors du choix est laissée', () => {
    expect(weekHourGrid(hourly, new Set(['a']), '2025-01-06', '2025-01-13')[0][8]).toBe(3);
    const sunday = weekHourGrid(hourly, new Set(['a']), '2025-01-05', '2025-01-05');
    expect(sunday[6][10]).toBe(50);
    expect(weekHourGrid(hourly, null, '2025-01-14', '2025-01-14')[1][0]).toBe(70);
  });
  it('le profil du jour : la moyenne des sept jours', () => {
    const p = dayProfile(hourly, new Set(['a', 'b']), '2025-01-06', '2025-01-13');
    expect(p).toHaveLength(24);
    expect(p[8]).toBeCloseTo(8 / 7, 9);
    expect(p[23]).toBeCloseTo(1 / 7, 9);
    expect(p[0]).toBe(0);
  });
});

describe('#678 : par pièce, cette période et la même un an avant', () => {
  it('un jour avant la période d’il y a un an ne compte pas', () => {
    const d = roomDeltas([rec('2025-01-10', 3), rec('2024-01-10', 2), rec('2024-01-09', 50)], '2025-01-10', '2025-01-20');
    expect(d.get('a')).toEqual({ now: 3, before: 2 });
  });
});

const TRVE_HEAD = 'DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC';
describe('#678 : le fichier HP/HC de la CRE', () => {
  it('fins de ligne LF, ligne vide en tête, lignes rangées par date de début', () => {
    const rows = parseTrveCsv(`\n${TRVE_HEAD}\n01/02/2025;;6;0;150,5;0;0,15;0;0,25\n01/02/2024;31/01/2025;6;0;140;0;0,14;0;0,24\n01/08/2024;;9;0;200;0;0,16;0;0,26\n`);
    expect(rows).toEqual([
      { from: '2024-02-01', to: '2025-01-31', kva: 6, fixedYear: 140, hc: 0.14, hp: 0.24 },
      { from: '2024-08-01', to: null, kva: 9, fixedYear: 200, hc: 0.16, hp: 0.26 },
      { from: '2025-02-01', to: null, kva: 6, fixedYear: 150.5, hc: 0.15, hp: 0.25 },
    ]);
  });
  it('une ligne sans date de début, sans prix HC ou sans prix HP est laissée', () => {
    const csv = `${TRVE_HEAD}\n;;6;0;1;0;0,1;0;0,2\n01/01/2024;;6;0;1;0;;0;0,2\n01/01/2024;;6;0;1;0;0,1;0;\n01/01/2025;;6;0;1;0;0,1;0;0,2`;
    expect(parseTrveCsv(csv).map((r) => r.from)).toEqual(['2025-01-01']);
  });
  it('une offre à prix unique (Base), même en première colonne', () => {
    const rows = parseTrveCsv('PART_VARIABLE_TTC;DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_TTC\r\n0,2516;01/02/2025;;9;220,1\r\n');
    expect(rows).toEqual([{ from: '2025-02-01', to: null, kva: 9, fixedYear: 220.1, hc: 0.2516, hp: 0.2516 }]);
  });
  it('trveAt : le jour de fin compris, le lendemain non, la bonne puissance', () => {
    const rows: TrveRow[] = [{ from: '2024-02-01', to: '2025-01-31', kva: 6, fixedYear: 1, hc: 0.1, hp: 0.2 }];
    expect(trveAt(rows, 6, '2025-01-31')).toBe(rows[0]);
    expect(trveAt(rows, 6, '2025-02-01')).toBeNull();
    expect(trveAt(rows, 6, '2024-01-31')).toBeNull();
    expect(trveAt(rows, 9, '2024-06-01')).toBeNull();
  });
});

describe('#678 : parts des heures creuses et coût au tarif réglementé', () => {
  it('offPeakShares : par pièce et en tout, une pièce sans kWh laissée, 30 % sans détail', () => {
    const s = offPeakShares(
      tmap([
        ['a', [['2025-01-01', [1, 3, 6]], ['2025-01-02', [0, 0, 10]]]],
        ['b', [['2025-01-01', [0, 0, 0]]]],
        ['c', [['2025-01-01', [2, 4, 4]]]],
      ]),
      2,
    );
    expect([...s.perRoom]).toEqual([
      ['a', 16 / 20],
      ['c', 4 / 10],
    ]);
    expect(s.overall).toBeCloseTo(20 / 30, 9);
    expect(offPeakShares(tmap([['b', [['2025-01-01', [0, 0, 0]]]]]), 1).overall).toBe(0.3);
    expect(offPeakShares(new Map(), 1).overall).toBe(0.3);
  });
  const rows: TrveRow[] = [{ from: '2024-01-01', to: null, kva: 6, fixedYear: 366, hc: 0.1, hp: 0.3 }];
  it('energyCostTrve : colonne 1 creuse, colonne 0 au prix plein, jour sans prix laissé', () => {
    const t = tmap([['a', [['2025-01-02', [1, 4, 2]], ['2025-01-03', [5, 0, 0]]]]]);
    const c = energyCostTrve([rec('2025-01-02', 7), rec('2025-01-03', 5), rec('2023-06-01', 100)], t, rows, 6, 1, { perRoom: new Map(), overall: 0.25 });
    expect(c.energy).toBeCloseTo(4 * 0.1 + (2 + 1) * 0.3 + 5 * (0.25 * 0.1 + 0.75 * 0.3), 9);
    expect(c.estimatedKwh).toBe(5);
  });
  it('subscriptionTrve : 366 jours en année bissextile, rien sans prix', () => {
    expect(subscriptionTrve(rows, 6, '2024-03-01', '2024-03-01')).toBeCloseTo(1, 9);
    expect(subscriptionTrve(rows, 6, '2025-03-01', '2025-03-01')).toBeCloseTo(366 / 365, 9);
    expect(subscriptionTrve(rows, 6, '2023-12-31', '2023-12-31')).toBe(0);
  });
});

const TEMPO_HEAD =
  'DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HCBleu_HT;PART_VARIABLE_HCBleu_TTC;PART_VARIABLE_HPBleu_HT;PART_VARIABLE_HPBleu_TTC;PART_VARIABLE_HCBlanc_HT;PART_VARIABLE_HCBlanc_TTC;PART_VARIABLE_HPBlanc_HT;PART_VARIABLE_HPBlanc_TTC;PART_VARIABLE_HCRouge_HT;PART_VARIABLE_HCRouge_TTC;PART_VARIABLE_HPRouge_HT;PART_VARIABLE_HPRouge_TTC';
describe('#678 : le fichier Tempo de la CRE', () => {
  it('fins de ligne LF, ligne vide en tête, trois couleurs, rangé par date', () => {
    const rows = parseTempoCsv(
      `\n${TEMPO_HEAD}\n01/02/2025;;9;0;200,5;0;0,11;0;0,12;0;0,13;0;0,14;0;0,15;0;0,66\n01/02/2024;31/01/2025;9;0;190;0;0,1;0;0,2;0;0,3;0;0,4;0;0,5;0;0,6\n01/08/2024;;6;0;150;0;0,1;0;0,2;0;0,3;0;0,4;0;0,5;0;0,6\n`,
    );
    expect(rows).toEqual([
      { from: '2024-02-01', to: '2025-01-31', kva: 9, fixedYear: 190, prices: { 1: [0.1, 0.2], 2: [0.3, 0.4], 3: [0.5, 0.6] } },
      { from: '2024-08-01', to: null, kva: 6, fixedYear: 150, prices: { 1: [0.1, 0.2], 2: [0.3, 0.4], 3: [0.5, 0.6] } },
      { from: '2025-02-01', to: null, kva: 9, fixedYear: 200.5, prices: { 1: [0.11, 0.12], 2: [0.13, 0.14], 3: [0.15, 0.66] } },
    ]);
  });
  it('une ligne sans part fixe ou sans prix HP rouge est laissée ; une colonne absente vaut 0', () => {
    const rows = parseTempoCsv(`${TEMPO_HEAD}\n01/01/2024;;9;0;;0;0,1;0;0,2;0;0,3;0;0,4;0;0,5;0;0,6\n01/01/2024;;9;0;1;0;0,1;0;0,2;0;0,3;0;0,4;0;0,5;0;\n01/01/2025;;9;0;1;0;0,1;0;0,2;0;0,3;0;0,4;0;0,5;0;0,6`);
    expect(rows.map((r) => r.from)).toEqual(['2025-01-01']);
    const short = parseTempoCsv('DATE_DEBUT;P_SOUSCRITE;PART_FIXE_TTC;PART_VARIABLE_HPRouge_TTC\n01/01/2025;9;1;0,6');
    expect(short[0].prices[1]).toEqual([0, 0]);
    expect(short[0].prices[3]).toEqual([0, 0.6]);
  });
});

describe('#678 : le comparateur d’offres', () => {
  const base: TrveRow[] = [{ from: '2024-01-01', to: '2025-06-30', kva: 9, fixedYear: 366, hc: 0.25, hp: 0.25 }];
  const hphc: TrveRow[] = [{ from: '2024-01-01', to: null, kva: 9, fixedYear: 732, hc: 0.2, hp: 0.3 }];
  const tempo = [{ from: '2024-01-02', to: null, kva: 9, fixedYear: 366, prices: { 1: [0.1, 0.15], 2: [0.12, 0.18], 3: [0.14, 0.7] } as Record<1 | 2 | 3, [number, number]> }];
  it('daySplits : colonne 1 creuse, colonne 0 au plein, la part mesurée d’une pièce, sinon la part de tout', () => {
    const t = tmap([['a', [['2025-01-02', [1, 4, 2]], ['2025-01-03', [5, 0, 0]]]]]);
    const recs = [rec('2025-01-02', 7), rec('2025-01-03', 5), rec('2025-01-03', 10, 'b')];
    const s = daySplits(recs, t, 1, { perRoom: new Map([['a', 0.4]]), overall: 0.25 }, null);
    expect(s).toEqual([
      { day: '2025-01-02', hc: 4, hp: 3 },
      { day: '2025-01-03', hc: 5 * 0.4 + 10 * 0.25, hp: 5 * 0.6 + 10 * 0.75 },
    ]);
  });
  it('daySplits avec le Linky : chaque jour du compteur, rangé, même sans relevé des radiateurs', () => {
    const linky = new Map([
      ['2025-01-04', 9],
      ['2025-01-02', 7],
    ]);
    expect(daySplits([rec('2025-01-02', 4)], new Map(), 2, { perRoom: new Map(), overall: 0.5 }, linky)).toEqual([
      { day: '2025-01-02', hc: 2 + 1, hp: 2 + 2 },
      { day: '2025-01-04', hc: 3, hp: 6 },
    ]);
  });
  it('compareOffers : seulement les jours que les trois offres tarifent, abonnements au jour', () => {
    const splits = [
      { day: '2024-01-01', hc: 1, hp: 1 }, // no Tempo price yet
      { day: '2024-01-02', hc: 2, hp: 1 },
      { day: '2024-01-03', hc: 1, hp: 1 }, // no colour
      { day: '2025-07-01', hc: 1, hp: 1 }, // no Base price
      { day: '2025-01-02', hc: 1, hp: 2 }, // 6 kVA: no price of that power
    ];
    const colours = new Map<string, number>([
      ['2024-01-01', 1],
      ['2024-01-02', 3],
      ['2025-07-01', 1],
      ['2025-01-02', 2],
    ]);
    const r = compareOffers(splits, (d) => (d === '2025-01-02' ? 6 : 9), base, hphc, tempo, colours);
    expect(r.base).toEqual({ energy: 3 * 0.25, subscription: 1, days: 1 });
    expect(r.hphc.energy).toBeCloseTo(2 * 0.2 + 0.3, 9);
    expect(r.hphc.subscription).toBe(2);
    expect(r.hphc.days).toBe(1);
    expect(r.tempo.energy).toBeCloseTo(2 * 0.14 + 0.7, 9);
    expect(r.tempo.days).toBe(1);
    // a common year: 365 days
    const r2 = compareOffers([{ day: '2025-01-02', hc: 1, hp: 0 }], () => 9, base, hphc, tempo, new Map([['2025-01-02', 1]]));
    expect(r2.base.subscription).toBeCloseTo(366 / 365, 9);
    // the last day of a price, included
    expect(compareOffers([{ day: '2025-06-30', hc: 1, hp: 0 }], () => 9, base, hphc, tempo, new Map([['2025-06-30', 1]])).base.days).toBe(1);
  });
});

describe('#678 : les anomalies', () => {
  /** 60 heating days on the line kWh = 40 − 2 t (± 0,3), plus the given extra points. */
  const season = (extra: [string, number, number][], noise = (i: number) => (i % 3) * 0.3) => {
    const weather: Weather = new Map();
    const recs: DayRecord[] = [];
    for (let i = 0; i < 60; i++) {
      const day = addDays('2025-11-01', i);
      const t = (i % 15) - 2;
      weather.set(day, [t - 2, t + 2, t]);
      recs.push(rec(day, 40 - 2 * t + noise(i)));
    }
    for (const [day, t, k] of extra) weather.set(day, [t - 2, t + 2, t]), recs.push(rec(day, k));
    return { weather, recs };
  };
  it('un jour doux ou un jour sans chauffage n’est ni ajusté ni listé', () => {
    const { weather, recs } = season([
      ['2026-01-05', 16, 30],
      ['2026-01-06', 15, 30],
      ['2026-01-07', 5, 0.1],
      ['2026-01-08', 5, 0.2],
    ]);
    expect(anomalies(recs, weather)).toEqual([]);
  });
  it('z et attendu calculés sur la droite de la saison', () => {
    const { weather, recs } = season([['2026-01-05', 4, 60]]);
    const a = anomalies(recs, weather);
    expect(a.map((x) => x.day)).toEqual(['2026-01-05']);
    const pts = [...signaturePoints(recs, weather).values()][0];
    const fit = fitSeason(pts)!;
    const res = pts.filter(([t, k]) => t < 15 && k > 0.2).map(([t, k]) => k - (fit.slope * t + fit.intercept));
    const sigma = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / (res.length - 2));
    expect(a[0].expected).toBeCloseTo(fit.slope * 4 + fit.intercept, 9);
    expect(a[0].kwh).toBe(60);
    expect(a[0].z).toBeCloseTo((60 - a[0].expected) / sigma, 9);
  });
  it('au-delà de 2 σ mais à 3 kWh ou moins : pas une anomalie', () => {
    // no noise: σ is set by the outlier alone, 2,5 kWh above the line
    const { weather, recs } = season([['2026-01-05', 4, 32 + 2.5]], () => 0);
    expect(anomalies(recs, weather)).toEqual([]);
  });
  it('au-delà de 3 kWh mais sous 2 σ : pas une anomalie', () => {
    const { weather, recs } = season([['2026-01-05', 4, 32 + 4]], (i) => (i % 2 ? 4 : -4));
    expect(anomalies(recs, weather)).toEqual([]);
  });
  it('les plus récentes d’abord, une saison de moins de dix jours laissée', () => {
    const { weather, recs } = season([
      ['2026-01-05', 4, 60],
      ['2026-01-07', 4, 0.5],
      ['2026-01-06', 4, 61],
      ['2025-03-01', 4, 20],
    ]);
    expect(anomalies(recs, weather).map((x) => x.day)).toEqual(['2026-01-07', '2026-01-06', '2026-01-05']);
  });
});

describe('#678 : jours au-dessus d’un seuil', () => {
  it('bornes de la période comprises, le seuil lui-même non, une valeur absente non', () => {
    const daily = { '2025-01-01': [1200], '2025-01-02': [1000], '2025-01-03': [null], '2025-01-04': [1500], '2024-12-31': [2000] };
    expect(daysAbove(daily, 0, 1000, '2025-01-01', '2025-01-04')).toBe(2);
    expect(daysAbove(daily, 0, 1000, '2025-01-02', '2025-01-03')).toBe(0);
  });
});

describe('#678 : la puissance souscrite déduite du Linky', () => {
  it('le premier dépassement est le plus haut, les jours rangés', () => {
    const pmax = new Map([
      ['2024-02-10', 14.2],
      ['2024-01-01', 9.3],
      ['2024-03-01', 10.1],
    ]);
    expect(inferKvaChange(pmax, 9)).toEqual({ from: 9, to: 15, firstOver: '2024-02-10', lastWithin: '2024-01-01' });
    // a later day read first: the first over is still the earliest
    const late = new Map([
      ['2024-03-01', 10.1],
      ['2024-02-10', 14.2],
      ['2024-01-01', 9.3],
    ]);
    expect(inferKvaChange(late, 9)).toEqual({ from: 9, to: 15, firstOver: '2024-02-10', lastWithin: '2024-01-01' });
  });
  it('la plus petite puissance au-dessus du pic moins la tolérance (module rechargé : la liste est définie au chargement)', async () => {
    vi.resetModules();
    const m = await import('./analysis');
    expect(m.KVA_STEPS).toEqual([3, 6, 9, 12, 15, 18, 24, 30, 36]);
    expect(m.inferKvaChange(new Map([['2024-01-01', 12.3]]), 9)!.to).toBe(12);
    expect(m.inferKvaChange(new Map([['2024-01-01', 11.9]]), 9)!.to).toBe(12);
    expect(m.inferKvaChange(new Map([['2024-01-01', 40]]), 9)!.to).toBe(36);
  });
});
