// #679: the survivors of the mutation run on data-quality.ts in the readers of each source —
// intuis (radiators, water heater), linky, station — each test seen red on its mutant. Fictitious
// data only. What is left, and why: docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { CATCH_UP, type QualityInput, type SourceQuality, qualityReport } from './data-quality';

const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const ROOMS = [
  { id: 'a', name: 'Salon', category: 'heating' },
  { id: 'b', name: 'Chambre', category: 'heating' },
  { id: 'w', name: 'Chauffe-eau', category: 'water_heater' },
];
/** Records of every room of `rooms` for each day of [from, to], except the days of `skip` (room -> days). */
function recs(from: string, to: string, skip: Record<string, Set<string> | string[]> = {}, rooms = ROOMS): DayRecord[] {
  const out: DayRecord[] = [];
  const sk = Object.fromEntries(Object.entries(skip).map(([k, v]) => [k, new Set(v)]));
  for (const d of span(from, to)) {
    for (const r of rooms) {
      if (sk[r.id]?.has(d)) continue;
      out.push({ day: d, room: r.id, cat: r.category as DayRecord['cat'], kwh: r.category === 'water_heater' ? 3 : 5 });
    }
  }
  return out;
}
const input = (records: DayRecord[], extra: Partial<QualityInput> = {}): QualityInput => ({ last: '2024-06-30', rooms: ROOMS, records, estimated: new Set(), ...extra });
const src = (i: QualityInput, id: SourceQuality['id']) => qualityReport(i).sources.find((s) => s.id === id);
const gaps = (i: QualityInput, id: SourceQuality['id']) => src(i, id)!.gaps;
/** The texts put no-break spaces before some signs: read as plain spaces here. */
const sp = (t: string | undefined) => (t ?? '').replace(/[  ]/g, ' ');
const RECONSTITUTE = 'Une estimation à part reste possible (« Reconstituer », plus bas).';
const NOT_AT_INTUIS = `Non chez Intuis d’après la récupération de l’historique (ni les jours ni le total du mois) ; pour en être sûr, ${CATCH_UP}. ${RECONSTITUTE}`;
const LOST = "l'historique Intuis n'a rien renvoyé pour ces jours (ni les jours, ni le total du mois)";
const hole = span('2024-03-10', '2024-03-19'); // ten days
const allHole = { a: hole, b: hole, w: hole };

describe('#679 intuis : le trou de toutes les pièces, en entier', () => {
  it('radiateurs et chauffe-eau : libellé, qui, le trou partagé dit une fois, rien à relier, aucune note', () => {
    const i = input(recs('2024-01-01', '2024-06-30', allHole));
    const h = src(i, 'heating')!;
    expect(h.label).toBe('Radiateurs (Intuis)');
    expect(h.notes).toEqual([]);
    expect(h.gaps).toEqual([
      { from: '2024-03-10', to: '2024-03-19', days: 10, who: 'toutes les pièces', all: true, ongoing: false, cause: LOST, same: false, link: undefined, recover: NOT_AT_INTUIS },
    ]);
    const w = src(i, 'water')!;
    expect(w.label).toBe('Chauffe-eau (Intuis)');
    expect(w.gaps[0]).toMatchObject({ who: 'le chauffe-eau', same: true, cause: "même trou que les radiateurs : l'historique Intuis n'a rien renvoyé pour ces jours" });
  });
  it('le Linky a les jours à 80 % au moins : la reconstitution s’appuie dessus', () => {
    const lk = (n: number) => new Map(span('2024-01-01', '2024-06-30').filter((d) => !hole.slice(n).includes(d)).map((d) => [d, 20]));
    const rec = (n: number) => gaps(input(recs('2024-01-01', '2024-06-30', allHole), { linky: lk(n) }), 'heating')[0].recover;
    expect(rec(8)).toBe(`${NOT_AT_INTUIS} Le compteur Linky a ces jours : la reconstitution s’appuie dessus.`);
    expect(rec(7)).toBe(NOT_AT_INTUIS);
  });
  it('trois jours font un trou, deux sont épars', () => {
    const three = src(input(recs('2024-01-01', '2024-06-30', { a: hole.slice(0, 3), b: hole.slice(0, 3) })), 'heating')!;
    expect(three.gaps.map((g) => g.days)).toEqual([3]);
    const two = src(input(recs('2024-01-01', '2024-06-30', { a: hole.slice(0, 2), b: hole.slice(0, 2) })), 'heating')!;
    expect(two.gaps).toEqual([]);
    expect(two.scattered).toBe(2);
  });
  it('la passerelle redémarrée la veille ou pendant le trou, pas avant-veille ni après', () => {
    const cause = (boot: string) => sp(gaps(input(recs('2024-01-01', '2024-06-30', allHole), { devices: { boots: [boot] } }), 'heating')[0].cause);
    expect(cause('2024-03-09')).toBe('coupure de courant probable (la passerelle Intuis a redémarré le 9 mars 2024)');
    expect(cause('2024-03-19')).toBe('coupure de courant probable (la passerelle Intuis a redémarré le 19 mars 2024)');
    expect(cause('2024-03-08')).toBe(LOST);
    expect(cause('2024-03-20')).toBe(LOST);
  });
  it('une nuit de collecte en échec : « 1 nuit » ; une coupure ou un redémarrage gardent leur cause', () => {
    const i = input(recs('2024-01-01', '2024-03-20', allHole), { last: '2024-03-20', devices: { failures: { '2024-03-20': ['intuis'] } } });
    expect(gaps(i, 'heating')[0].cause).toBe('collecte Intuis en échec (1 nuit) : ces jours n’ont pas été redemandés à temps');
    const fail = Object.fromEntries(span('2024-03-10', '2024-04-30').map((d) => [d, ['intuis']]));
    const boot = input(recs('2024-01-01', '2024-06-30', allHole), { devices: { failures: fail, boots: ['2024-03-12'] } });
    expect(sp(gaps(boot, 'heating')[0].cause)).toMatch(/^coupure de courant probable/);
    const cut = input(recs('2024-01-01', '2024-06-30', allHole), { devices: { failures: fail, cuts: new Map([['2024-03-12', 'internet' as const]]) } });
    expect(sp(gaps(cut, 'heating')[0].cause)).toMatch(/^coupure Internet/);
    // the water heater's own gap keeps its cause, failed nights or not
    const water = input(recs('2024-01-01', '2024-06-30', { w: hole }), { devices: { failures: fail } });
    expect(gaps(water, 'water')[0].cause).toBe('seul le chauffe-eau manque : il ne renvoyait rien (débranché, retiré ou hors ligne ?)');
  });
  it('le chauffe-eau seul manque quand le Linky et la station manquent aussi : sa cause reste la sienne', () => {
    const silent = span('2024-01-01', '2024-06-30').filter((d) => !hole.includes(d));
    const i = input(recs('2024-01-01', '2024-06-30', { w: hole }), {
      linky: new Map(silent.map((d) => [d, 20])),
      station: { modules: { m: { name: 'Station' } }, daily: { m: Object.fromEntries(silent.map((d) => [d, 1])) } },
    });
    const g = gaps(i, 'water')[0];
    expect(g.cause).toBe('seul le chauffe-eau manque : il ne renvoyait rien (débranché, retiré ou hors ligne ?)');
    expect(g.recover).toMatch(/^Non : redemandé|^Non chez Intuis/);
  });
});

describe('#679 intuis : le chauffe-eau', () => {
  it('remis en service jusqu’à 30 jours avant ou après la fin du trou, pas au-delà ; jamais pour les radiateurs', () => {
    const cause = (setup: string) => gaps(input(recs('2024-01-01', '2024-06-30', { w: hole }), { devices: { waterSetup: [setup] } }), 'water')[0];
    const ok = cause('2024-04-18');
    expect(sp(ok.cause)).toBe('chauffe-eau absent, puis remis en service le 18 avr. 2024 (réinstallé)');
    expect(ok.recover).toBe('Non : le chauffe-eau ne mesurait rien pendant cette période.');
    expect(ok.same).toBe(false);
    expect(sp(cause('2024-02-18').cause)).toMatch(/remis en service le 18 févr\. 2024/);
    expect(cause('2024-04-19').cause).toMatch(/^seul le chauffe-eau/);
    expect(cause('2024-02-17').cause).toMatch(/^seul le chauffe-eau/);
    const heat = input(recs('2024-01-01', '2024-06-30', { a: hole, b: hole }), { devices: { waterSetup: ['2024-03-15'] } });
    expect(gaps(heat, 'heating')[0].cause).toBe(LOST);
  });
  it('injoignable un jour : « ce jour-là », avec le lien ; une pièce des radiateurs hors ligne n’en fait pas un trou du chauffe-eau', () => {
    const i = input(recs('2024-01-01', '2024-06-30', { w: hole }), { devices: { offline: new Map([['w', new Set(['2024-03-12'])]]) } });
    expect(gaps(i, 'water')[0]).toMatchObject({ cause: 'chauffe-eau injoignable ce jour-là (il ne répondait pas à la passerelle)', link: '#parametres-sources' });
    const heat = input(recs('2024-01-01', '2024-06-30', { a: hole, b: hole }), { devices: { offline: new Map([['a', new Set(['2024-03-12'])]]) } });
    expect(gaps(heat, 'heating')[0]).toMatchObject({ cause: LOST, link: undefined });
  });
  it('un trou du chauffe-eau à moitié dans celui des radiateurs : « même trou », mais pas « le même »', () => {
    const w = span('2024-03-10', '2024-03-29');
    const g = gaps(input(recs('2024-01-01', '2024-06-30', { a: hole, b: hole, w })), 'water')[0];
    expect(g.cause).toMatch(/^même trou que les radiateurs/);
    expect(g.same).toBe(false);
  });
  it('le trou d’une seule pièce des radiateurs n’est pas « le même trou »', () => {
    const g = gaps(input(recs('2024-01-01', '2024-06-30', { a: hole, w: hole })), 'water')[0];
    expect(g.cause).toMatch(/^seul le chauffe-eau manque/);
    expect(g.recover).toBe(NOT_AT_INTUIS);
  });
  it('un logement sans radiateurs : le chauffe-eau seul', () => {
    const rooms = [ROOMS[2]];
    const i = { ...input(recs('2024-01-01', '2024-06-30', { w: hole }, rooms)), rooms };
    expect(src(i, 'heating')).toBeUndefined();
    expect(gaps(i, 'water')[0].cause).toMatch(/^seul le chauffe-eau manque/);
  });
  it('sans relevé du chauffe-eau : pas de source', () => {
    const rooms = ROOMS.slice(0, 2);
    expect(src({ ...input(recs('2024-01-01', '2024-06-30', {}, rooms)), rooms }, 'water')).toBeUndefined();
  });
  it('0 kWh quatorze jours de suite : signalé, rangé, encore en cours ; treize non ; jamais pour un radiateur', () => {
    const zero = (from: string, to: string, room = 'w') => (r: DayRecord) => (r.room === room && r.day >= from && r.day <= to ? { ...r, kwh: 0 } : r);
    const fourteen = recs('2024-01-01', '2024-06-30').map(zero('2024-06-17', '2024-06-30')).reverse();
    expect(gaps(input(fourteen), 'water')).toEqual([
      {
        from: '2024-06-17',
        to: '2024-06-30',
        days: 14,
        who: 'Chauffe-eau',
        all: true,
        ongoing: true,
        kind: 'zero',
        cause: 'le chauffe-eau a relevé 0 kWh chaque jour : éteint, débranché ou absence prolongée ?',
        recover: 'Rien à récupérer si le chauffe-eau était vraiment éteint.',
      },
    ]);
    expect(gaps(input(recs('2024-01-01', '2024-06-30').map(zero('2024-05-01', '2024-05-14'))), 'water')[0].ongoing).toBe(false);
    expect(gaps(input(recs('2024-01-01', '2024-06-30').map(zero('2024-06-17', '2024-06-29'))), 'water')).toEqual([]);
    expect(gaps(input(recs('2024-01-01', '2024-06-30').map(zero('2024-06-20', '2024-06-20'))), 'water')).toEqual([]);
    expect(gaps(input(recs('2024-01-01', '2024-06-30').map(zero('2024-05-01', '2024-05-31', 'a'))), 'heating')).toEqual([]);
  });
});

describe('#679 intuis : une pièce seule', () => {
  it('trois jours font un trou, deux sont épars ; sans état des modules, la cause d’Intuis', () => {
    const three = gaps(input(recs('2024-01-01', '2024-06-30', { b: hole.slice(0, 3) })), 'heating');
    expect(three).toEqual([
      {
        from: '2024-03-10',
        to: '2024-03-12',
        days: 3,
        who: 'pièce : Chambre',
        all: false,
        ongoing: false,
        cause: "l'historique Intuis n'a rien renvoyé pour cette pièce",
        recover: NOT_AT_INTUIS,
        link: undefined,
      },
    ]);
    const two = src(input(recs('2024-01-01', '2024-06-30', { b: hole.slice(0, 2) })), 'heating')!;
    expect(two.gaps).toEqual([]);
    expect(two.scattered).toBe(2);
  });
  it('hors ligne un jour, ou plusieurs', () => {
    const cause = (off: string[]) => gaps(input(recs('2024-01-01', '2024-06-30', { b: hole }), { devices: { offline: new Map([['b', new Set(off)]]) } }), 'heating')[0];
    expect(cause(['2024-03-11'])).toMatchObject({ cause: 'module hors ligne ce jour-là (il ne répondait pas à la passerelle)', link: '#parametres-sources' });
    expect(cause(['2024-03-11', '2024-03-12', '2024-02-01']).cause).toBe('module hors ligne 2 de ces jours (il ne répondait pas à la passerelle)');
  });
  it('muette jusqu’au dernier jour : un module injoignable de CETTE pièce, sinon « plus aucune donnée »', () => {
    const silent = { b: span('2024-06-20', '2024-06-30') };
    const g = (offlineNow: { room: string; since: string }[]) => gaps(input(recs('2024-01-01', '2024-06-30', silent), { devices: { offlineNow } }), 'heating')[0];
    expect(sp(g([{ room: 'a', since: '2024-06-20' }]).cause)).toBe('plus aucune donnée depuis le 20 juin 2024 : radiateur injoignable, débranché ou retiré ?');
    const now = g([{ room: 'b', since: '2024-06-20' }]);
    expect(sp(now.cause)).toBe('pièce muette depuis le 20 juin 2024 : module injoignable (il ne répond plus à la passerelle)');
    expect(now.recover).toBe('Les jours reviendront quand le module répondra à nouveau ; les jours passés sont perdus chez Intuis.');
    // one day only, but still going on: a gap
    expect(gaps(input(recs('2024-01-01', '2024-06-30', { b: ['2024-06-30'] })), 'heating')).toHaveLength(1);
  });
});

describe('#679 intuis : pièces arrêtées et jours estimés', () => {
  const stopped = [
    { room: 'a', from: '2024-05-01', text: 'arrêtée A' },
    { room: 'b', from: '2024-05-01', text: 'arrêtée B' },
  ];
  it('chaque pièce arrêtée a sa phrase', () => {
    const i = input(recs('2024-01-01', '2024-06-30', { a: span('2024-06-10', '2024-06-30'), b: span('2024-05-01', '2024-06-30') }), { stopped });
    expect(src(i, 'heating')!.notes).toEqual([
      'Salon : arrêtée A : pas de données attendues, ces jours ne comptent pas comme manquants.',
      'Chambre : arrêtée B : pas de données attendues, ces jours ne comptent pas comme manquants.',
    ]);
  });
  it('une pièce arrêtée n’est « présente » que les jours où une autre pièce des radiateurs l’est', () => {
    // b is stopped; a misses five days while the water heater keeps sending: every room is missing then
    const a = span('2024-06-01', '2024-06-05');
    const i = input(recs('2024-01-01', '2024-06-30', { a, b: span('2024-05-01', '2024-06-30') }), { stopped: [stopped[1]] });
    expect(gaps(i, 'heating').map((g) => [g.from, g.who])).toEqual([['2024-06-01', 'toutes les pièces']]);
  });
  it('les jours estimés d’une autre source ne comptent pas ; un, puis deux, sur deux années', () => {
    const one = src(input(recs('2023-01-01', '2024-06-30'), { estimated: new Set(['w|2024-03-01']) }), 'heating')!;
    expect(one.years.map((y) => y.estimated)).toEqual([0, 0]);
    expect(one.notes).toEqual([]);
    expect(src(input(recs('2023-01-01', '2024-06-30'), { estimated: new Set(['w|2024-03-01']) }), 'water')!.notes).toEqual([
      '1 jour estimé : Intuis a gardé le total du mois mais perdu le détail du jour ; le total du mois reste juste.',
    ]);
    const two = src(input(recs('2023-01-01', '2024-06-30'), { estimated: new Set(['a|2023-03-01', 'b|2024-03-01']) }), 'heating')!;
    expect(two.notes).toEqual(['2 jours estimés : Intuis a gardé le total du mois mais perdu le détail du jour ; le total du mois reste juste.']);
  });
});

describe('#679 linky', () => {
  const linkyOf = (skip: string[], from = '2021-01-01', to = '2024-06-30') => new Map(span(from, to).filter((d) => !skip.includes(d)).map((d) => [d, 20]));
  const lg = (extra: Partial<QualityInput>) => src(input(recs('2024-01-01', '2024-06-30'), extra), 'linky')!;
  it('le trou en entier, le libellé ; rangé même lu dans le désordre', () => {
    const l = lg({ linky: new Map([...linkyOf(hole)].reverse()) });
    expect(l.label).toBe('Compteur Linky (par jour)');
    expect(l.last).toBe('2024-06-30');
    expect(l.notes).toEqual([]);
    expect(l.gaps).toEqual([
      {
        from: '2024-03-10',
        to: '2024-03-19',
        days: 10,
        who: 'compteur',
        all: true,
        ongoing: false,
        cause: 'Enedis n’a pas transmis ces jours',
        recover: 'Encore chez Enedis (moins de 3 ans), mais la collecte ne redemande que les 10 derniers jours.',
      },
    ]);
  });
  it('trois jours font un trou, deux sont épars', () => {
    expect(lg({ linky: linkyOf(hole.slice(0, 3)) }).gaps).toHaveLength(1);
    const two = lg({ linky: linkyOf(hole.slice(0, 2)) });
    expect(two.gaps).toEqual([]);
    expect(two.scattered).toBe(2);
  });
  it('plus de 3 ans : la limite elle-même est encore chez Enedis', () => {
    const limit = addDays('2024-06-30', -3 * 365);
    const at = lg({ linky: linkyOf(span(addDays(limit, -4), limit)) });
    expect(at.gaps[0].recover).toMatch(/^Encore chez Enedis/);
    const before = lg({ linky: linkyOf(span(addDays(limit, -5), addDays(limit, -1))) });
    expect(before.gaps[0].recover).toBe('Non : Enedis ne garde que 3 ans.');
  });
  it('une nuit en échec : « 1 nuit »', () => {
    const l = src(input(recs('2024-01-01', '2024-03-20'), { last: '2024-03-20', linky: linkyOf(hole, '2024-01-01', '2024-03-20'), devices: { failures: { '2024-03-20': ['linky'] } } }), 'linky')!;
    expect(l.gaps[0].cause).toBe('collecte Linky en échec (1 nuit) : ces jours n’ont pas été redemandés à temps');
  });
  it('dernier relevé plus de 3 jours avant la fin des données : la note ; 3 jours tout juste, non', () => {
    expect(sp(lg({ linky: linkyOf([], '2024-01-01', '2024-06-26') }).notes[0])).toBe(
      'Dernier relevé Linky le 26 juin 2024 : la collecte Linky est peut-être en échec (voir l’état des sources).',
    );
    expect(lg({ linky: linkyOf([], '2024-01-01', '2024-06-27') }).notes).toEqual([]);
    expect(lg({ linky: linkyOf([], '2024-01-01', '2024-07-03') }).notes).toEqual([]);
  });
  it('« la station manque aussi » : seulement entre le premier et le dernier jour de la station, même lus dans le désordre', () => {
    const cause = (stationDays: string[]) =>
      lg({ linky: linkyOf(hole), station: { modules: { m: { name: 'Station' } }, daily: { m: Object.fromEntries(stationDays.map((d) => [d, 1])) } } }).gaps[0].cause;
    // the station starts after the gap, or stops before it: it says nothing of it
    expect(cause(span('2024-03-20', '2024-06-30'))).toBe('Enedis n’a pas transmis ces jours');
    expect(cause(span('2024-01-01', '2024-03-09'))).toBe('Enedis n’a pas transmis ces jours');
    // around the gap, silent during it, read latest first
    expect(cause(span('2024-01-01', '2024-06-30').filter((d) => !hole.includes(d)).reverse())).toBe('collecte arrêtée : la station manque aussi ces jours-là');
  });
});

describe('#679 station', () => {
  const daily = (list: string[]) => Object.fromEntries(list.map((d) => [d, 1]));
  const all = span('2024-01-01', '2024-06-30');
  const st = (station: QualityInput['station'], extra: Partial<QualityInput> = {}) => src(input(recs('2024-01-01', '2024-06-30'), { station, ...extra }), 'station');
  it('le trou de tous les modules en entier, le libellé ; dernier jour trouvé même lu dans le désordre', () => {
    const s = st({ modules: { m: { name: 'Intérieur' } }, daily: { m: daily(all.filter((d) => !hole.includes(d)).reverse()) } })!;
    expect(s.label).toBe('Station Netatmo');
    expect(s.last).toBe('2024-06-30');
    expect(s.notes).toEqual([]);
    expect(s.gaps).toEqual([
      {
        from: '2024-03-10',
        to: '2024-03-19',
        days: 10,
        who: 'tous les modules',
        all: true,
        ongoing: false,
        cause: 'collecte de la station interrompue (connexion Netatmo à renouveler ?)',
        recover: `Oui : Netatmo garde l’historique de la station ; ${CATCH_UP}.`,
      },
    ]);
  });
  it('sans aucun relevé : pas de source', () => {
    expect(st({ modules: {}, daily: { m: {} } })).toBeUndefined();
  });
  it('trois jours font un trou, deux sont épars ; une nuit en échec', () => {
    const three = st({ modules: {}, daily: { m: daily(all.filter((d) => !hole.slice(0, 3).includes(d))) } })!;
    expect(three.gaps.map((g) => g.days)).toEqual([3]);
    const two = st({ modules: {}, daily: { m: daily(all.filter((d) => !hole.slice(0, 2).includes(d))) } })!;
    expect(two.gaps).toEqual([]);
    expect(two.scattered).toBe(2);
    const s = src(input(recs('2024-01-01', '2024-03-20'), { last: '2024-03-20', station: { modules: {}, daily: { m: daily(span('2024-01-01', '2024-03-20').filter((d) => !hole.includes(d))) } }, devices: { failures: { '2024-03-20': ['netatmo'] } } }), 'station')!;
    expect(s.gaps[0].cause).toBe('collecte de la station en échec (1 nuit) : connexion Netatmo à renouveler ?');
  });
  describe('un module seul', () => {
    const two = (m1: string[], health?: Record<string, [number | null, number | null, number]>, modules: Record<string, { name: string }> = { m0: { name: 'Intérieur' }, m1: { name: 'Extérieur' } }) =>
      st({ modules, daily: { m0: daily(all), m1: daily(m1) }, health: health ? { m1: health } : undefined })!;
    const gap = span('2024-03-10', '2024-03-15');
    const without = all.filter((d) => !gap.includes(d));
    it('le module n’a rien renvoyé : en entier, un nom manquant dit « module »', () => {
      expect(two(without).gaps).toEqual([
        {
          from: '2024-03-10',
          to: '2024-03-15',
          days: 6,
          who: 'module : Extérieur',
          all: false,
          ongoing: false,
          cause: 'le module n’a rien renvoyé',
          recover: `Oui : Netatmo garde l’historique de la station ; ${CATCH_UP}.`,
          link: undefined,
        },
      ]);
      expect(two(without, undefined, { m0: { name: 'Intérieur' } }).gaps[0].who).toBe('module : module');
      // a station document without its modules (the type allows none at run time): the same word
      const bare = st({ daily: { m0: daily(all), m1: daily(without) } } as unknown as QualityInput['station'])!;
      expect(bare.gaps[0].who).toBe('module : module');
    });
    it('deux modules muets les mêmes jours : « modules : … »', () => {
      const s = st({ modules: { m0: { name: 'Intérieur' }, m1: { name: 'Extérieur' }, m2: { name: 'Pluie' } }, daily: { m0: daily(all), m1: daily(without), m2: daily(without) } })!;
      expect(s.gaps.map((g) => g.who)).toEqual(['modules : Extérieur, Pluie']);
    });
    it('deux jours sont épars, sauf à la fin : un module muet le dernier jour est un trou en cours', () => {
      const short = two(all.filter((d) => d !== '2024-03-10' && d !== '2024-03-11'));
      expect(short.gaps).toEqual([]);
      expect(short.scattered).toBe(2);
      const end = two(all.filter((d) => d !== '2024-06-30'));
      expect(end.gaps).toMatchObject([{ from: '2024-06-30', to: '2024-06-30', ongoing: true }]);
    });
    it('pile faible (sous 15 %) dans les 10 jours d’avant ou pendant : la pile ; sinon non', () => {
      const cause = (health: Record<string, [number | null, number | null, number]>) => two(without, health).gaps[0];
      const low = cause({ '2024-02-29': [14, 80, 1] });
      expect(low).toMatchObject({ cause: 'pile faible juste avant : le module s’est arrêté', recover: 'Changer la pile ; les jours sans relevé sont perdus.', link: '#parametres-sources' });
      expect(cause({ '2024-03-15': [14, 80, 1] }).cause).toMatch(/^pile faible/);
      expect(cause({ '2024-02-28': [14, 80, 1] }).cause).toBe('le module n’a rien renvoyé');
      expect(cause({ '2024-03-16': [14, 80, 1] }).cause).toBe('le module n’a rien renvoyé');
      expect(cause({ '2024-03-01': [15, 80, 1] }).cause).toBe('le module n’a rien renvoyé');
      expect(cause({ '2024-03-01': [null, 80, 1] }).cause).toBe('le module n’a rien renvoyé');
    });
    it('hors de portée (signal nul) un des jours : injoignable', () => {
      const g = two(without, { '2024-03-01': [80, 80, 1], '2024-03-02': [80, 80, 0] }).gaps[0];
      expect(g).toMatchObject({ cause: 'module injoignable (hors de portée de la station ?)', link: '#parametres-sources' });
      expect(g.recover).toBe(`Oui : Netatmo garde l’historique de la station ; ${CATCH_UP}.`);
      expect(two(without, { '2024-03-01': [80, 80, 1] }).gaps[0].cause).toBe('le module n’a rien renvoyé');
    });
  });
});
