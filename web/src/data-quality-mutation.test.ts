// #623: the survivors of the first mutation run on data-quality.ts (66,1 %) in the four functions
// of the issue — yearVerdicts, fineSource, lowYears and the order of the gaps (sortGaps) — each test
// seen red on its mutant. Fictitious data only. What is left, and why: docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import {
  CATCH_UP,
  type Gap,
  LINKY30_KEEP_DAYS,
  type QualityReport,
  type RoomDays,
  type SourceQuality,
  type YearCover,
  curveParts,
  fineSource,
  lowYears,
  seenParts,
  yearVerdicts,
} from './data-quality';

const NB = ' ';
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

// ------------------------------------------------------------------ yearVerdicts
const yc = (year: number, expected: number, full: number, estimated = 0): YearCover => ({ year, expected, full, estimated, partial: 0, missing: expected - full - estimated });
const gap = (from: string, to: string, days: number, who: string, all: boolean, cause: string, kind?: Gap['kind']): Gap => ({ from, to, days, who, all, ongoing: false, cause, recover: '', ...(kind ? { kind } : {}) });
const src = (id: SourceQuality['id'], label: string, years: YearCover[], gaps: Gap[] = []): SourceQuality => ({ id, label, first: null, last: null, years, gaps, scattered: 0, notes: [] });
const rep = (sources: SourceQuality[], extra: Partial<QualityReport> = {}): QualityReport => ({ sources, low: [], above: [], suspects: [], roomDays: new Map(), stopped: [], ...extra });
const full = (years: number[], expected = 365) => years.map((y) => yc(y, expected, expected));
const LOST = "l'historique Intuis n'a rien renvoyé pour ces jours (ni les jours, ni le total du mois)";
const INTUIS_ANSWER = 'Ce n’est pas une panne de l’application : ces jours n’existent plus chez Intuis. Ils ne peuvent pas être récupérés, seulement estimés à part (« Reconstituer », plus bas).';
const verdict = (r: QualityReport, year: number) => yearVerdicts(r).find((v) => v.year === year)!;

describe('#623 : le niveau de chaque année, bornes vues des deux côtés', () => {
  // the radiators are not the first source: the verdict must find them by their id
  const linky = src('linky', 'Compteur Linky', full([2019]));
  const heating = src('heating', 'Radiateurs (Intuis)', [yc(2020, 1000, 970, 10), yc(2021, 1000, 979), yc(2022, 1000, 900), yc(2023, 1000, 899)]);

  it('98 % : bonne ; juste sous 98 % et 90 % : correcte ; juste sous 90 % : à vérifier ; sans radiateurs : bonne', () => {
    const v = yearVerdicts(rep([linky, heating]));
    expect(v.map((x) => [x.year, x.level])).toEqual([
      [2023, 'poor'],
      [2022, 'fair'],
      [2021, 'fair'],
      [2020, 'good'],
      [2019, 'good'],
    ]);
    expect(v[3]).toEqual({
      year: 2020,
      level: 'good',
      headline: `98${NB}% des jours complets pour les radiateurs (980 sur 1000)`,
      reasons: ['10 jours estimés depuis le total du mois (le total reste juste).'],
      answer: '',
      counts: '',
    });
    expect(v[4]).toEqual({ year: 2019, level: 'good', headline: 'pas de relevé des radiateurs cette année', reasons: [], answer: 'Rien à signaler.', counts: '' });
  });

  it('une année des radiateurs sans jour attendu : pas de pourcentage, et « bonne »', () => {
    expect(verdict(rep([src('heating', 'Radiateurs (Intuis)', [yc(2018, 0, 0)])]), 2018)).toEqual({
      year: 2018,
      level: 'good',
      headline: 'pas de relevé des radiateurs cette année',
      reasons: [],
      answer: 'Rien à signaler.',
      counts: '',
    });
  });

  it('sans source des radiateurs du tout, l’année se lit quand même', () => {
    expect(yearVerdicts(rep([linky]))).toEqual([{ year: 2019, level: 'good', headline: 'pas de relevé des radiateurs cette année', reasons: [], answer: 'Rien à signaler.', counts: '' }]);
  });
});

describe('#623 : les trous cités dans le verdict de l’année', () => {
  const heating = src(
    'heating',
    'Radiateurs (Intuis)',
    [yc(2021, 365, 364, 1), ...full([2022]), yc(2023, 365, 363, 2), ...full([2024], 366)],
    [
      gap('2021-03-01', '2021-03-03', 3, 'Salon', false, 'c1'),
      gap('2021-04-01', '2021-04-04', 4, 'Chambre', false, 'c2'),
      gap('2021-05-01', '2021-05-05', 5, 'Bureau', false, 'c3'),
      gap('2021-06-01', '2021-06-06', 6, 'Cuisine', false, 'c4'), // a fourth one: not cited
      gap('2023-12-25', '2024-01-05', 12, 'toutes les pièces', true, LOST), // over two years
    ],
  );
  const water = src('water', 'Chauffe-eau (Intuis)', [yc(2022, 365, 360, 5), ...full([2025])], [
    gap('2021-07-01', '2021-07-03', 3, 'le chauffe-eau', true, 'cw'),
    // a run of 0 kWh, whatever its cause says, is not a day lost at Intuis
    gap('2022-02-01', '2022-02-14', 14, 'Chauffe-eau', true, "Intuis n'a rien renvoyé (essai)", 'zero'),
    gap('2025-05-01', '2025-05-10', 10, 'le chauffe-eau', true, LOST), // lost at Intuis: the water heater alone
  ]);
  const linky = src('linky', 'Compteur Linky', [], [
    gap('2021-08-01', '2021-08-06', 6, 'tout', true, 'cl6'), // under a week: not cited
    gap('2021-09-01', '2021-09-07', 7, 'tout', true, 'cl7'),
    gap('2022-03-01', '2022-03-10', 10, 'tout', true, "Intuis n'a rien renvoyé (pas une source Intuis)"),
  ]);
  const r = rep([heating, water, linky]);

  it('trois trous au plus par source, ceux d’une autre source à partir d’une semaine, les jours estimés des radiateurs', () => {
    expect(verdict(r, 2021)).toMatchObject({
      level: 'good',
      reasons: [
        'Radiateurs (Intuis) : trou de 3 jours (Salon) (mars 2021) : c1.',
        'Radiateurs (Intuis) : trou de 4 jours (Chambre) (avr. 2021) : c2.',
        'Radiateurs (Intuis) : trou de 5 jours (Bureau) (mai 2021) : c3.',
        '1 jour estimé depuis le total du mois (le total reste juste).',
        'Chauffe-eau (Intuis) : trou de 3 jours sur le chauffe-eau (juil. 2021) : cw.',
        'Compteur Linky : trou de 7 jours sur tout (sept. 2021) : cl7.',
      ],
      answer: '',
    });
  });

  it('0 kWh se dit, et n’est pas un jour perdu chez Intuis ; une autre source non plus', () => {
    expect(verdict(r, 2022)).toMatchObject({
      reasons: [
        'Chauffe-eau (Intuis) : 0 kWh de 14 jours sur Chauffe-eau (févr. 2022) : Intuis n\'a rien renvoyé (essai).',
        'Compteur Linky : trou de 10 jours sur tout (mars 2022) : Intuis n\'a rien renvoyé (pas une source Intuis).',
      ],
      answer: '',
    });
  });

  it('un trou du chauffe-eau seul perdu chez Intuis le dit aussi', () => {
    expect(verdict(r, 2025)).toMatchObject({ reasons: [`Chauffe-eau (Intuis) : trou de 10 jours sur le chauffe-eau (mai 2025) : ${LOST}.`], answer: INTUIS_ANSWER });
  });

  it('un trou sur deux années est cité dans les deux, et dit perdu chez Intuis', () => {
    const cited = `Radiateurs (Intuis) : trou de 12 jours sur toutes les pièces (déc. 2023–janv. 2024) : ${LOST}.`;
    expect(verdict(r, 2023)).toMatchObject({ reasons: [cited, '2 jours estimés depuis le total du mois (le total reste juste).'], answer: INTUIS_ANSWER });
    expect(verdict(r, 2024)).toMatchObject({ reasons: [cited], answer: INTUIS_ANSWER });
  });
});

describe('#623 : années basses, jours suspects, au-dessus du compteur, valeurs impossibles, pièces arrêtées', () => {
  const heating = src('heating', 'Radiateurs (Intuis)', [...full([2020, 2021, 2022, 2023]), yc(2024, 1000, 800)]);
  const sus = (year: number, n: number) => Array.from({ length: n }, (_, i) => `${year}-01-${String(i + 10).padStart(2, '0')}`);
  const cell = (o: Partial<RoomDays>): RoomDays => ({ real: 0, estimated: 0, missing: 0, suspect: 0, stopped: 0, ...o });

  it('une année basse passe de « bonne » à « correcte », jamais une autre année, jamais au-dessus', () => {
    const r = rep([heating], {
      low: [
        { year: 2020, share: 0.2, usual: 0.6 },
        { year: 2024, share: 0.1, usual: 0.5 },
      ],
    });
    expect(verdict(r, 2020)).toMatchObject({ level: 'fair', reasons: [`Valeurs basses : en hiver, les radiateurs représentent 20${NB}% du compteur Linky, contre 60${NB}% les autres années.`] });
    expect(verdict(r, 2021)).toMatchObject({ level: 'good', reasons: [], answer: 'Rien à signaler.' });
    expect(verdict(r, 2024).level).toBe('poor');
  });

  it('5 jours suspects font « correcte », 4 non ; une année « à vérifier » le reste', () => {
    const r = rep([heating], { suspects: [...sus(2020, 4), ...sus(2021, 5), ...sus(2022, 1), ...sus(2024, 5)] });
    const said = (n: number) => `${n} jours suspects : chauffage relevé bien trop bas un jour froid, alors que le compteur a vu la consommation.`;
    expect(verdict(r, 2020)).toMatchObject({ level: 'good', reasons: [said(4)] });
    expect(verdict(r, 2021)).toMatchObject({ level: 'fair', reasons: [said(5)] });
    expect(verdict(r, 2022)).toMatchObject({ level: 'good', reasons: ['1 jour suspect : chauffage relevé bien trop bas un jour froid, alors que le compteur a vu la consommation.'] });
    expect(verdict(r, 2023)).toMatchObject({ level: 'good', reasons: [] });
    expect(verdict(r, 2024).level).toBe('poor');
  });

  it('jours au-dessus du compteur, comptés par année', () => {
    const r = rep([heating], { above: ['2020-02-01', '2021-02-01', '2021-02-02'] });
    expect(verdict(r, 2020).reasons).toEqual(['1 jour où les radiateurs dépassent le compteur Linky (impossible : valeurs Intuis douteuses ces jours-là).']);
    expect(verdict(r, 2021).reasons).toEqual(['2 jours où les radiateurs dépassent le compteur Linky (impossible : valeurs Intuis douteuses ces jours-là).']);
    expect(verdict(r, 2022).reasons).toEqual([]);
  });

  it('valeurs impossibles et jours × pièces, au singulier et au pluriel ; une pièce arrêtée seulement à partir de son année', () => {
    const r = rep([heating], {
      roomDays: new Map([
        ['2020-01', { heating: cell({ real: 10, suspect: 1 }) }],
        ['2021-02', { heating: cell({ real: 20, estimated: 3, missing: 2, suspect: 2, stopped: 4 }) }],
        ['2022-03', { heating: cell({ real: 5 }) }],
      ]),
      stopped: [{ who: 'Bureau', from: '2021-03-01', text: 'arrêté exprès' }],
    });
    expect(verdict(r, 2020)).toMatchObject({
      reasons: [`1 valeur impossible (négative ou au-dessus de 80${NB}kWh pour une pièce en un jour) : comptée comme relevée mais douteuse.`],
      counts: 'En jours × pièces : 10 relevés.',
    });
    expect(verdict(r, 2021)).toMatchObject({
      reasons: [
        `2 valeurs impossibles (négative ou au-dessus de 80${NB}kWh pour une pièce en un jour) : comptées comme relevées mais douteuses.`,
        'Bureau : arrêté exprès : pas de données attendues, ce n’est pas un trou.',
      ],
      counts: 'En jours × pièces : 20 relevés, 3 estimés, 2 manquants, 4 arrêtés volontairement.',
    });
    expect(verdict(r, 2022)).toMatchObject({ reasons: ['Bureau : arrêté exprès : pas de données attendues, ce n’est pas un trou.'], counts: 'En jours × pièces : 5 relevés.' });
    expect(verdict(r, 2023)).toMatchObject({ counts: '' });
  });
});

// ------------------------------------------------------------------ fineSource
describe('#623 : sources à la demi-heure, trous par pièce', () => {
  const rooms = [
    { id: 'a', name: 'Salon' },
    { id: 'b', name: 'Chambre' },
  ];
  const month = span('2026-01-01', '2026-01-31');
  const without = (...out: string[][]) => new Set(month.filter((d) => !out.some((o) => o.includes(d))));
  const all = span('2026-01-22', '2026-01-24'); // no room these days
  const f = {
    parts: [
      { name: 'a', days: without(span('2026-01-05', '2026-01-07'), ['2026-01-20'], all) }, // 3 days: a gap; 1 day: scattered
      { name: 'b', days: without(span('2026-01-12', '2026-01-13'), span('2026-01-25', '2026-01-31'), all) }, // 2 days scattered; up to the last day
      { name: 'c', days: without(span('2026-01-15', '2026-01-17'), all) }, // a part without a name
    ],
    last: '2026-01-31',
  };
  const RECOVER = 'La collecte redemande l’historique à la demi-heure nuit après nuit ; un trou déjà parcouru n’est pas redemandé.';
  const CAUSE = "Intuis n'a rien renvoyé à la demi-heure";
  const g = (from: string, to: string, days: number, who: string, all: boolean, ongoing: boolean) => ({ from, to, days, who, all, ongoing, cause: CAUSE, recover: RECOVER });

  it('chaque pièce a son trou, nommé ; un trou court est épars ; seul celui du dernier jour est en cours ; le plus long d’abord, puis le plus ancien', () => {
    expect(fineSource('room30', f, '2025-12-01', rooms, new Map([['2026-01-22', 'power']]))).toEqual({
      id: 'room30',
      label: 'Pièces à la demi-heure (Intuis)',
      first: '2026-01-01',
      last: '2026-01-31',
      years: [{ year: 2026, expected: 31, full: 12, estimated: 0, partial: 16, missing: 3 }],
      gaps: [
        g('2026-01-25', '2026-01-31', 7, 'pièce : Chambre', false, true),
        g('2026-01-05', '2026-01-07', 3, 'pièce : Salon', false, false),
        g('2026-01-15', '2026-01-17', 3, 'pièce : c', false, false),
        g('2026-01-22', '2026-01-24', 3, 'toutes les pièces', true, false), // the cut explains only the hourly snapshot
      ],
      scattered: 3,
      notes: ['Historique rattrapé du plus récent au plus ancien, quelques semaines par nuit : disponible depuis le 1er janv. 2026 pour l’instant.'],
    });
  });

  it('la note du rattrapage seulement au-delà de 30 jours après le premier jour Intuis, et pour les pièces seulement', () => {
    expect(fineSource('room30', f, '2025-12-02', rooms)!.notes).toEqual([]);
    expect(fineSource('roomstate', { parts: [{ name: 'roomstate', days: new Set(month) }], last: '2026-01-31' }, '2020-01-01')!.notes).toEqual([]);
  });

  it('un même trou dans deux pièces est dit une fois, « pièces » ; deux jours sans aucune pièce sont épars', () => {
    const two = fineSource(
      'room30',
      {
        parts: [
          { name: 'a', days: without(span('2026-01-10', '2026-01-14'), span('2026-01-20', '2026-01-21')) },
          { name: 'b', days: without(span('2026-01-10', '2026-01-14'), span('2026-01-20', '2026-01-21')) },
          { name: 'c', days: without(span('2026-01-20', '2026-01-21')) },
        ],
        last: '2026-01-31',
      },
      null,
      rooms,
    )!;
    expect(two.gaps).toEqual([g('2026-01-10', '2026-01-14', 5, 'pièces : Chambre, Salon', false, false)]);
    expect(two.scattered).toBe(2);
  });

  it('aucune partie avec des jours : rien ; une partie vide à côté d’une autre ne compte pas', () => {
    expect(fineSource('room30', { parts: [{ name: 'a', days: new Set() }], last: '2026-01-31' }, null)).toBeNull();
    const one = fineSource('room30', { parts: [{ name: 'a', days: new Set() }, { name: 'b', days: new Set(month) }], last: '2026-01-31' }, null)!;
    expect(one.years[0]).toMatchObject({ expected: 31, full: 31 });
  });

  it('le relevé horaire : « tout », la coupure comme cause, les heures d’un jour incomplet', () => {
    const seen: Record<string, number> = {};
    for (const d of span('2026-02-01', '2026-02-20')) seen[d] = 0xffffff;
    for (const d of span('2026-02-05', '2026-02-08')) delete seen[d];
    seen['2026-02-06'] = 0; // no hour at all: not a day present
    seen['2026-02-10'] = 0b1111_1111_1111_1111_1110; // 19 hours: thin
    seen['2026-02-11'] = 0b1111_1111_1111_1111_1111; // 20 hours: complete
    seen['2026-02-12'] = 0b1111_1111_1111_1111_1110;
    const s = fineSource('roomstate', seenParts(seen), null, [], new Map([['2026-02-04', 'internet']]))!;
    expect(s.label).toBe('Relevé horaire de l’état des pièces');
    expect(s.years).toEqual([{ year: 2026, expected: 20, full: 14, estimated: 0, partial: 2, missing: 4 }]);
    expect(s.gaps).toEqual([
      {
        from: '2026-02-05',
        to: '2026-02-08',
        days: 4,
        who: 'tout',
        all: true,
        ongoing: false,
        cause: 'coupure Internet le 4 févr. 2026 : la maison était injoignable',
        recover: 'Non : c’est un relevé de l’instant, Intuis n’en garde pas l’historique.',
      },
    ]);
    expect(s.notes).toEqual(['2 jours incomplets (une partie des heures seulement).']);
  });

  it('la courbe Linky : un jour incomplet sous 40 demi-heures, au singulier', () => {
    const curve = new Map<string, number>();
    const slot = (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
    for (const d of span('2026-03-01', '2026-03-10')) for (let i = 0; i < (d === '2026-03-02' ? 39 : d === '2026-03-03' ? 40 : 48); i++) curve.set(`${d}T${slot(i)}`, 100);
    const s = fineSource('linky30', curveParts(curve), null)!;
    expect(s.label).toBe('Compteur Linky à la demi-heure');
    expect(s.years[0]).toMatchObject({ full: 9, partial: 1 });
    expect(s.notes).toContain('1 jour incomplet (une partie des demi-heures seulement).');
  });

  it('la courbe Linky : récupérable jusqu’au premier jour gardé par Enedis compris, perdue avant', () => {
    const last = '2026-06-30';
    const start = addDays(last, 1 - LINKY30_KEEP_DAYS); // first day Enedis keeps
    const lostGap = span(addDays(start, -20), addDays(start, -16));
    const keptGap = span(addDays(start, -4), start);
    const have = new Set(span(addDays(start, -30), last).filter((d) => !lostGap.includes(d) && !keptGap.includes(d)));
    const s = fineSource('linky30', { parts: [{ name: 'linky30', days: have }], last }, null)!;
    expect(s.gaps.map((x) => [x.from, x.who, x.cause, x.recover])).toEqual([
      [lostGap[0], 'tout', 'courbe de charge non transmise par Enedis', 'Probablement non : Enedis ne garde vraisemblablement plus la courbe de charge (24 mois d’après sa documentation, à confirmer).'],
      [keptGap[0], 'tout', 'courbe de charge non transmise par Enedis', `Oui, sans doute (24 mois chez Enedis d’après sa documentation) ; ${CATCH_UP}.`],
    ]);
    expect(s.notes).toEqual([]);
  });

  it('la courbe Linky : la note des demi-heures d’avant à partir de 8 jours après le début gardé', () => {
    const last = '2026-06-30';
    const start = addDays(last, 1 - LINKY30_KEEP_DAYS);
    const from = (d: string) => fineSource('linky30', { parts: [{ name: 'linky30', days: new Set(span(d, last)) }], last }, null)!.notes;
    expect(from(addDays(start, 7))).toEqual([]);
    expect(from(addDays(start, 8))).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ lowYears
describe('#623 : années basses des radiateurs face au Linky', () => {
  /** `n` winter days of `year` from `first` on, radiators `kwh` a day against a meter at 10 kWh. */
  const winter = (first: string, n: number, kwh: number): [DayRecord[], [string, number][]] => {
    const ds = span(first, addDays(first, n - 1));
    return [ds.map((day) => ({ day, room: 'r', cat: 'heating' as const, kwh })), ds.map((d) => [d, 10])];
  };
  const run = (parts: [DayRecord[], [string, number][]][], uncertain = new Set<string>()) =>
    lowYears(
      parts.flatMap((p) => p[0]),
      new Map(parts.flatMap((p) => p[1])),
      uncertain,
    );

  it('médiane des autres années, non triées, en nombre impair', () => {
    // others of 2023: 0,5 ; 0,9 ; 0,4 → median 0,5 (not the middle one as read, 0,9)
    const low = run([winter('2020-01-01', 30, 5), winter('2021-01-01', 30, 9), winter('2022-01-01', 30, 4), winter('2023-01-01', 30, 2)]);
    expect(low).toEqual([{ year: 2023, share: 0.2, usual: 0.5 }]);
  });

  it('médiane en nombre pair ; sous 60 % : basse ; à 60 % tout juste : non', () => {
    expect(run([winter('2020-01-01', 30, 4), winter('2021-01-01', 30, 6), winter('2022-01-01', 30, 2)])).toEqual([{ year: 2022, share: 0.2, usual: 0.5 }]);
    expect(run([winter('2020-01-01', 30, 4), winter('2021-01-01', 30, 6), winter('2022-01-01', 30, 3)])).toEqual([]);
  });

  it('deux années suffisent, une seule ne compare rien', () => {
    expect(run([winter('2020-01-01', 30, 5), winter('2021-01-01', 30, 2)])).toEqual([{ year: 2021, share: 0.2, usual: 0.5 }]);
    expect(run([winter('2021-01-01', 30, 2)])).toEqual([]);
  });

  it('novembre et mars comptent, octobre et avril non ; 30 jours au moins ; ni Linky nul, ni jour incertain', () => {
    const low = run([
        winter('2020-03-01', 30, 5),
        winter('2021-03-01', 30, 5),
        winter('2022-11-01', 30, 2), // the low year, counted from November
        winter('2022-10-01', 30, 9), // October: not winter
        winter('2022-04-01', 30, 9), // April: not winter
        winter('2019-01-01', 29, 1), // 29 days: not enough to be judged
    ]);
    // days the meter says 0, and uncertain days: left out (they would lift 2022 above 60 %)
    expect(low).toEqual([{ year: 2022, share: 0.2, usual: 0.5 }]);
    const withZero = run([winter('2020-03-01', 30, 5), winter('2021-03-01', 30, 5), winter('2022-11-01', 30, 2), [winter('2022-12-01', 10, 9)[0], span('2022-12-01', '2022-12-10').map((d) => [d, 0])]]);
    expect(withZero).toEqual([{ year: 2022, share: 0.2, usual: 0.5 }]);
    const withUncertain = run([winter('2020-03-01', 30, 5), winter('2021-03-01', 30, 5), winter('2022-11-01', 30, 2), winter('2022-12-11', 10, 9)], new Set(span('2022-12-11', '2022-12-20')));
    expect(withUncertain).toEqual([{ year: 2022, share: 0.2, usual: 0.5 }]);
  });

  it('une médiane nulle n’est pas une référence (valeurs impossibles négatives comprises)', () => {
    expect(run([winter('2020-01-01', 30, 0), winter('2021-01-01', 30, 0), winter('2022-01-01', 30, -1)])).toEqual([]);
  });
});
