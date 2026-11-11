import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import vector from './__fixtures__/quality-rule.json';
import {
  ABOVE_MARGIN_KWH,
  ABOVE_RATIO,
  SUSPECT_KWH_DAY,
  aboveMeter,
  coverParts,
  covered,
  curveParts,
  fineSource,
  lowYears,
  monthSpan,
  monthStatus,
  qualityReport,
  roomDays,
  runs,
  seenParts,
  sourceVerdict,
  type SourceQuality,
  yearVerdicts,
  type QualityInput,
} from './data-quality';
import { freshness } from './freshness';

const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const rooms = [
  { id: 'a', name: 'Salon', category: 'heating' },
  { id: 'b', name: 'Chambre', category: 'heating' },
  { id: 'c', name: 'Bureau', category: 'heating' },
  { id: 'w', name: 'Chauffe-eau', category: 'water_heater' },
];
/** Records of every room for each day of [from, to], except the days of `skip` (room -> days). */
function recs(from: string, to: string, skip: Record<string, Set<string>> = {}, kwh = 5): DayRecord[] {
  const out: DayRecord[] = [];
  for (const d of span(from, to)) {
    for (const r of rooms) {
      if (skip[r.id]?.has(d)) continue;
      out.push({ day: d, room: r.id, cat: r.category as DayRecord['cat'], kwh: r.category === 'water_heater' ? 3 : kwh });
    }
  }
  return out;
}
const base = (records: DayRecord[], extra: Partial<QualityInput> = {}): QualityInput => ({ last: '2024-12-31', rooms, records, estimated: new Set(), ...extra });

describe('dates', () => {
  it('runs of consecutive days', () => {
    expect(runs(['2023-01-01', '2023-01-02', '2023-01-04'])).toEqual([
      ['2023-01-01', '2023-01-02'],
      ['2023-01-04', '2023-01-04'],
    ]);
  });
  it('month span', () => {
    expect(monthSpan('2023-09-12', '2023-10-22')).toBe('sept.–oct. 2023');
    expect(monthSpan('2023-12-20', '2024-01-05')).toBe('déc. 2023–janv. 2024');
    expect(monthSpan('2024-11-04', '2024-11-17')).toBe('nov. 2024');
  });
});

describe('coverParts', () => {
  it('counts complete, estimated, partial and missing days per year', () => {
    const a = { name: 'a', days: new Set(span('2023-12-30', '2024-01-03').filter((d) => d !== '2024-01-02')), estimated: new Set(['2024-01-01']) };
    const b = { name: 'b', days: new Set(span('2023-12-31', '2024-01-03').filter((d) => d !== '2024-01-02' && d !== '2024-01-03')) };
    const c = coverParts([a, b], '2024-01-03');
    expect(c.years).toEqual([
      { year: 2023, expected: 2, full: 2, estimated: 0, partial: 0, missing: 0 },
      { year: 2024, expected: 3, full: 0, estimated: 1, partial: 1, missing: 1 },
    ]);
    expect(c.allMissing).toEqual(['2024-01-02']);
    expect(c.partMissing.get('b')).toEqual(['2024-01-03']);
    expect(covered(c.years[1])).toBeCloseTo(1 / 3);
  });
});

describe('qualityReport: Intuis', () => {
  it('a gap on every room, with the Intuis cause and what can be recovered', () => {
    const lost = new Set(span('2023-09-10', '2023-10-20'));
    const r = qualityReport(base(recs('2023-01-01', '2024-12-31', { a: lost, b: lost, c: lost, w: lost }), { linky: new Map(span('2023-01-01', '2024-12-31').map((d) => [d, 30])) }));
    const heating = r.sources.find((s) => s.id === 'heating')!;
    expect(heating.gaps[0]).toMatchObject({ from: '2023-09-10', to: '2023-10-20', days: 41, all: true, who: 'toutes les pièces' });
    expect(heating.gaps[0].cause).toMatch(/historique Intuis n'a rien renvoyé/);
    expect(heating.gaps[0].recover).toMatch(/Non chez Intuis.*Linky a ces jours/);
    const y2023 = heating.years.find((y) => y.year === 2023)!;
    expect(y2023.missing).toBe(41);
    const v = yearVerdicts(r);
    expect(v.map((x) => x.year)).toEqual([2024, 2023]);
    expect(v[0].level).toBe('good');
    expect(v[1].level).toBe('poor');
    expect(v[1].headline).toBe('88 % des jours complets pour les radiateurs (324 sur 365)');
    expect(v[1].reasons.join(' ')).toMatch(/trou de 41 jours sur toutes les pièces \(sept\.–oct\. 2023\)/);
  });

  it('a room silent until the last day: module not answering, link to the devices', () => {
    const r = qualityReport(
      base(recs('2025-01-01', '2025-12-31', { b: new Set(span('2025-10-05', '2025-12-31')) }), {
        last: '2025-12-31',
        devices: { offlineNow: [{ room: 'b', since: '2025-10-05' }] },
      }),
    );
    const g = r.sources.find((s) => s.id === 'heating')!.gaps[0];
    expect(g).toMatchObject({ who: 'pièce : Chambre', ongoing: true, all: false, link: '#parametres-sources' });
    expect(g.cause).toMatch(/pièce muette depuis le 5 oct\. 2025 : module injoignable/);
  });

  it('#346: a radiator switched off on purpose (a stove): no data expected, no gap, the year stays good', () => {
    const silent = { b: new Set(span('2025-10-05', '2025-12-31')) };
    const stopped = [{ room: 'b', from: '2025-10-05', text: 'radiateur arrêté volontairement depuis le 5 oct. 2025 (chauffée par un poêle)' }];
    const input = base(recs('2025-01-01', '2025-12-31', silent), { last: '2025-12-31', devices: { offlineNow: [{ room: 'b', since: '2025-10-05' }] }, stopped });
    const r = qualityReport(input);
    const heating = r.sources.find((x) => x.id === 'heating')!;
    expect(heating.gaps).toEqual([]);
    expect(heating.years[0]).toMatchObject({ year: 2025, missing: 0, partial: 0 });
    expect(heating.notes[0]).toBe('Chambre : radiateur arrêté volontairement depuis le 5 oct. 2025 (chauffée par un poêle) : pas de données attendues, ces jours ne comptent pas comme manquants.');
    const v = yearVerdicts(r)[0];
    expect(v.level).toBe('good');
    expect(v.reasons.join(' ')).not.toMatch(/muette|injoignable/);
    expect(monthStatus(input)).toMatchObject({ missing: 0, ok: 31 });
    // without the setting: the room out of reach, the year to check
    const without = qualityReport(base(recs('2025-01-01', '2025-12-31', silent), { last: '2025-12-31', devices: { offlineNow: [{ room: 'b', since: '2025-10-05' }] } }));
    expect(yearVerdicts(without)[0].level).toBe('poor');
    expect(monthStatus({ ...input, stopped: [] }).missing).toBe(31);
  });

  it('water heater absent then set up again: « réinstallé », not an Intuis gap', () => {
    const gone = new Set(span('2023-09-01', '2024-12-10'));
    const r = qualityReport(base(recs('2023-01-01', '2024-12-31', { w: gone }), { devices: { waterSetup: ['2024-12-11'] } }));
    const w = r.sources.find((s) => s.id === 'water')!;
    expect(w.gaps[0]).toMatchObject({ from: '2023-09-01', to: '2024-12-10', all: true });
    expect(w.gaps[0].cause).toMatch(/remis en service le 11 déc\. 2024 \(réinstallé\)/);
    expect(r.sources.find((s) => s.id === 'heating')!.gaps).toEqual([]);
  });

  it('the same hole in two rooms is listed once; the water heater sharing the radiators’ hole is said once', () => {
    const two = new Set(span('2024-11-04', '2024-11-17'));
    const all = new Set(span('2024-02-12', '2024-03-08'));
    const r = qualityReport(base(recs('2024-01-01', '2024-12-31', { a: new Set([...two, ...all]), b: new Set([...two, ...all]), c: all, w: all })));
    const h = r.sources.find((s) => s.id === 'heating')!;
    expect(h.gaps.map((g) => g.who)).toEqual(['toutes les pièces', 'pièces : Chambre, Salon']);
    const w = r.sources.find((s) => s.id === 'water')!;
    expect(w.gaps[0]).toMatchObject({ same: true });
    expect(w.gaps[0].cause).toMatch(/même trou que les radiateurs/);
    const [v] = yearVerdicts(r);
    expect(v.reasons.filter((x) => x.startsWith('Chauffe-eau'))).toEqual([]);
    expect(v.answer).toMatch(/pas une panne de l’application/);
  });

  it('water heater missing alone, without a setup date', () => {
    const r = qualityReport(base(recs('2023-01-01', '2023-12-31', { w: new Set(span('2023-03-01', '2023-03-20')) }), { last: '2023-12-31' }));
    expect(r.sources.find((s) => s.id === 'water')!.gaps[0].cause).toMatch(/seul le chauffe-eau manque/);
  });

  it('a water heater at 0 kWh for weeks is flagged', () => {
    const records = recs('2023-01-01', '2023-06-30').map((r) => (r.room === 'w' && r.day >= '2023-02-01' && r.day <= '2023-03-15' ? { ...r, kwh: 0 } : r));
    const w = qualityReport(base(records, { last: '2023-06-30' })).sources.find((s) => s.id === 'water')!;
    expect(w.gaps[0]).toMatchObject({ kind: 'zero', days: 43 });
  });

  it('short holes are scattered, estimated days are noted', () => {
    const r = qualityReport(
      base(recs('2024-01-01', '2024-12-31', { a: new Set(['2024-02-02']) }), { estimated: new Set(['a|2024-03-01', 'b|2024-03-01']) }),
    );
    const h = r.sources.find((s) => s.id === 'heating')!;
    expect(h.gaps).toEqual([]);
    expect(h.scattered).toBe(1);
    expect(h.years[0]).toMatchObject({ estimated: 1, partial: 1 });
    expect(h.notes[0]).toMatch(/1 jour estimé/);
  });
});

describe('qualityReport: Linky and station', () => {
  it('Linky gaps: recoverable within 3 years only', () => {
    const days = span('2021-01-01', '2024-12-31').filter((d) => !(d >= '2021-02-01' && d <= '2021-02-10') && !(d >= '2024-05-01' && d <= '2024-05-05'));
    const r = qualityReport(base(recs('2024-01-01', '2024-12-31'), { linky: new Map(days.map((d) => [d, 20])) }));
    const l = r.sources.find((s) => s.id === 'linky')!;
    expect(l.gaps.map((g) => g.days)).toEqual([10, 5]);
    expect(l.gaps[0].recover).toMatch(/ne garde que 3 ans/);
    expect(l.gaps[1].recover).toMatch(/Encore chez Enedis/);
  });

  it('station: a module stopped after a low battery', () => {
    const all = span('2024-01-01', '2024-03-31');
    const m1 = all.filter((d) => d < '2024-02-10' || d > '2024-02-25');
    const r = qualityReport(
      base(recs('2024-01-01', '2024-03-31'), {
        last: '2024-03-31',
        station: {
          modules: { m0: { name: 'Intérieur' }, m1: { name: 'Extérieur' } },
          daily: { m0: Object.fromEntries(all.map((d) => [d, 1])), m1: Object.fromEntries(m1.map((d) => [d, 1])) },
          health: { m1: { '2024-02-08': [9, 80, 1] } },
        },
      }),
    );
    const s = r.sources.find((x) => x.id === 'station')!;
    expect(s.gaps[0]).toMatchObject({ who: 'module : Extérieur', days: 16, link: '#parametres-sources' });
    expect(s.gaps[0].cause).toMatch(/pile faible/);
  });
});

describe('values that look wrong', () => {
  it('a year whose radiators recorded far less than the meter, the others being alike', () => {
    const y = (year: number, kwh: number) => recs(`${year}-01-01`, `${year}-03-31`, {}, kwh);
    const records = [...y(2022, 10), ...y(2023, 10), ...y(2024, 3)];
    const linky = new Map(records.map((r) => [r.day, 40]));
    const low = lowYears(records, linky, new Set());
    expect(low.map((l) => l.year)).toEqual([2024]);
    expect(low[0].share).toBeCloseTo(9 / 40);
    const v = yearVerdicts({ sources: [], low, above: [], suspects: [], roomDays: new Map(), stopped: [] });
    expect(v).toEqual([]); // no source: no year
  });
  it('days above the meter', () => {
    expect(aboveMeter(recs('2024-01-01', '2024-01-02'), new Map([['2024-01-01', 5], ['2024-01-02', 50]]))).toEqual(['2024-01-01']);
  });
  it('suspects and low values lower the verdict of a year', () => {
    const r = qualityReport(base(recs('2024-01-01', '2024-12-31'), { suspects: ['2024-01-14', '2024-01-15'] }));
    r.low.push({ year: 2024, share: 0.2, usual: 0.6 });
    const [v] = yearVerdicts(r);
    expect(v.level).toBe('fair');
    expect(v.reasons.join(' ')).toMatch(/Valeurs basses.*20\s%.*60\s%/);
    expect(v.reasons.join(' ')).toMatch(/2 jours suspects/);
  });
});

describe('fine sources', () => {
  it('Linky curve: thin days and gaps', () => {
    const curve = new Map<string, number>();
    for (const d of span('2026-01-01', '2026-01-20')) {
      if (d >= '2026-01-05' && d <= '2026-01-09') continue;
      const n = d === '2026-01-02' ? 10 : 48;
      for (let i = 0; i < n; i++) curve.set(`${d}T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, 100);
    }
    const s = fineSource('linky30', curveParts(curve), null)!;
    expect(s.years[0]).toMatchObject({ expected: 20, full: 14, partial: 1, missing: 5 });
    expect(s.gaps[0].days).toBe(5);
    expect(s.notes[0]).toMatch(/1 jour incomplet/);
  });
  it('hourly snapshots: bitmask of the hours', () => {
    const s = fineSource('roomstate', seenParts({ '2026-01-01': 0xffffff, '2026-01-02': 0b111, '2026-01-03': 0xffffff }), null)!;
    expect(s.years[0]).toMatchObject({ full: 2, partial: 1 });
    expect(s.gaps[0]?.recover ?? 'Non').toMatch(/Non/);
  });
  it('rooms at the half hour: catch-up note', () => {
    const s = fineSource('room30', { parts: [{ name: 'a', days: new Set(span('2026-06-01', '2026-06-30')) }], last: '2026-06-30' }, '2022-01-01', [{ id: 'a', name: 'Salon' }])!;
    expect(s.notes[0]).toMatch(/rattrapé.*1er juin 2026/);
  });
});

describe('monthStatus', () => {
  it('this month: complete, estimated, incomplete', () => {
    const records = recs('2026-10-25', '2026-11-08', { b: new Set(['2026-11-03']) });
    const m = monthStatus({ last: '2026-11-08', rooms, records, estimated: new Set(['a|2026-11-05']) });
    expect(m).toEqual({ expected: 8, ok: 6, estimated: 1, missing: 1 });
  });
});

describe('sourceVerdict (#387: one line per source)', () => {
  const y = (year: number, expected: number, full: number, missing = 0, estimated = 0) => ({ year, expected, full, estimated, partial: 0, missing });
  const src = (years: ReturnType<typeof y>[], gaps: SourceQuality['gaps'] = []): SourceQuality => ({ id: 'heating', label: 'Radiateurs', first: null, last: null, years, gaps, scattered: 0, notes: [] });
  it('names the worst year, not the first one under the threshold', () => {
    const v = sourceVerdict(src([y(2023, 365, 347, 18), y(2024, 366, 326, 40), y(2025, 365, 365)]));
    expect(v).toMatchObject({ level: 'poor', worst: { year: 2024 }, text: 'à vérifier : 2024 (89 %)' });
    expect(v.overall).toBeCloseTo((347 + 326 + 365) / (365 + 366 + 365));
  });
  it('estimated days count as covered; 90 to 98 %: « presque complet »', () => {
    expect(sourceVerdict(src([y(2022, 365, 300, 0, 65)])).text).toBe('complet depuis 2022');
    expect(sourceVerdict(src([y(2022, 100, 95, 5), y(2023, 100, 100)]))).toMatchObject({ level: 'fair', text: 'presque complet : 2022 (95 %)' });
  });
  it('a source silent right now says so, and is not « good »', () => {
    const gap = { from: '2026-11-05', to: '2026-11-08', days: 4, who: 'Chambre', all: false, ongoing: true, cause: '', recover: '' };
    expect(sourceVerdict(src([y(2026, 312, 312)], [gap]))).toMatchObject({ level: 'fair', text: 'complet depuis 2026 · muet depuis 4 jours (Chambre)' });
  });
  it('nothing expected', () => {
    expect(sourceVerdict(src([])).text).toBe('aucun jour attendu');
  });
});

describe('freshness (header pill)', () => {
  const now = Date.parse('2026-11-09T08:00:00Z');
  it('green when up to date', () => {
    expect(freshness({ last: '2026-11-08', now, demo: false })).toMatchObject({ level: 'ok', stale: false, text: 'à jour' });
  });
  it('red after more than 2 days', () => {
    expect(freshness({ last: '2026-11-05', now, demo: false })).toMatchObject({ level: 'bad', stale: true, days: 3, text: 'arrêtées depuis 3 jours' });
    expect(freshness({ last: '2026-11-05', now, demo: true }).level).toBe('ok');
  });
  it('orange with a failing source or estimated days', () => {
    const f = freshness({ last: '2026-11-08', now, demo: false, sources: { linky: { ok: '2026-11-01T04:00', error: '2026-11-09T04:00' }, intuis: { ok: '2026-11-09T04:00', error: '2026-11-01T04:00' } } });
    expect(f).toMatchObject({ level: 'warn', failing: ['linky'], text: 'une source en échec' });
    expect(freshness({ last: '2026-11-08', now, demo: false, uncertain: 2 })).toMatchObject({ level: 'warn', text: '2 jours estimés ce mois-ci' });
  });
  it('no data yet', () => {
    expect(freshness({ last: null, now, demo: false }).level).toBe('warn');
  });
});

describe('#336: one room-day rule with `diagnose --qualite` (quality-rule.json)', () => {
  type Run = [string, string, string, number];
  const V = vector as unknown as {
    suspect_kwh_day: number;
    above_ratio: number;
    above_margin_kwh: number;
    last: string;
    rooms: { id: string; category: string }[];
    stopped: { room: string; from: string }[];
    runs: Run[];
    remove: [string, string, string][];
    estimated: [string, string, string][];
    linky: { from: string; to: string; kwh: number; days: Record<string, number> };
    expected: { months: Record<string, Record<string, number[]>>; above: string[] };
  };
  const cells = new Map<string, number>();
  for (const [room, from, to, kwh] of V.runs) for (const d of span(from, to)) cells.set(`${room}|${d}`, kwh);
  for (const [room, from, to] of V.remove) for (const d of span(from, to)) cells.delete(`${room}|${d}`);
  const cat = (id: string) => V.rooms.find((r) => r.id === id)!.category as DayRecord['cat'];
  const records: DayRecord[] = [...cells].map(([k, kwh]) => ({ room: k.split('|')[0], day: k.split('|')[1], cat: cat(k.split('|')[0]), kwh }));
  const estimated = new Set(V.estimated.flatMap(([room, from, to]) => span(from, to).map((d) => `${room}|${d}`)));
  const linkyDaily = new Map(span(V.linky.from, V.linky.to).map((d) => [d, V.linky.days[d] ?? V.linky.kwh]));
  const input = { last: V.last, rooms: V.rooms.map((r) => ({ ...r, name: r.id })), records, estimated, stopped: V.stopped.map((s) => ({ ...s, text: '' })) };

  it('the thresholds are the ones of the shared file', () => {
    expect([SUSPECT_KWH_DAY, ABOVE_RATIO, ABOVE_MARGIN_KWH]).toEqual([V.suspect_kwh_day, V.above_ratio, V.above_margin_kwh]);
  });
  it('room-days per month: real / estimated / missing / suspect / stopped', () => {
    const got = roomDays(input);
    const asLists = Object.fromEntries(
      [...got].map(([m, c]) => [m, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [v.real, v.estimated, v.missing, v.suspect, v.stopped]]))]),
    );
    expect(asLists).toEqual(V.expected.months);
  });
  it('days above the meter: measured values of the followed rooms only', () => {
    expect(aboveMeter(records, linkyDaily, estimated)).toEqual(V.expected.above);
  });
  it('the year verdict says the room-days and the room stopped on purpose (#440)', () => {
    const r = qualityReport({
      ...input,
      rooms: input.rooms.map((x) => (x.id === 's' ? { ...x, name: 'Pièce S' } : x)),
      stopped: [{ room: 's', from: '2024-02-01', text: 'radiateurs retirés depuis le 1er févr. 2024' }],
    });
    const v = yearVerdicts(r).find((y) => y.year === 2024)!;
    expect(v.counts).toBe('En jours × pièces : 130 relevés, 5 estimés, 3 manquants, 28 arrêtés volontairement.');
    expect(v.reasons).toContain('Pièce S : radiateurs retirés depuis le 1er févr. 2024 : pas de données attendues, ce n’est pas un trou.');
    expect(v.reasons.some((x) => x.startsWith('2 valeurs impossibles'))).toBe(true);
  });
});

describe('#336: the known cause of each gap', () => {
  const daily = (list: string[]) => Object.fromEntries(list.map((d) => [d, 1]));
  it('a power or an Internet cut explains a gap on every room (#394)', () => {
    const lost = new Set(span('2024-03-10', '2024-03-14'));
    const records = recs('2024-01-01', '2024-06-30', { a: lost, b: lost, c: lost, w: lost });
    const power = qualityReport(base(records, { last: '2024-06-30', devices: { cuts: new Map([['2024-03-10', 'power']]) } }));
    expect(power.sources.find((s) => s.id === 'heating')!.gaps[0].cause).toBe('coupure de courant le 10 mars 2024 : la passerelle Intuis ne pouvait plus envoyer ses relevés');
    const net = qualityReport(base(records, { last: '2024-06-30', devices: { cuts: new Map([['2024-03-09', 'internet']]) } }));
    expect(net.sources.find((s) => s.id === 'heating')!.gaps[0].cause).toMatch(/^coupure Internet le 9 mars 2024/);
    const far = qualityReport(base(records, { last: '2024-06-30', devices: { cuts: new Map([['2024-03-20', 'power']]) } }));
    expect(far.sources.find((s) => s.id === 'heating')!.gaps[0].cause).toMatch(/historique Intuis n'a rien renvoyé/);
  });
  it('a water heater out of reach (nightly status), alone', () => {
    const off = new Set(span('2024-04-01', '2024-04-09'));
    const r = qualityReport(base(recs('2024-01-01', '2024-06-30', { w: off }), { last: '2024-06-30', devices: { offline: new Map([['w', new Set(['2024-04-02', '2024-04-03'])]]) } }));
    const g = r.sources.find((s) => s.id === 'water')!.gaps[0];
    expect(g.cause).toBe('chauffe-eau injoignable 2 de ces jours (il ne répondait pas à la passerelle)');
    expect(g.link).toBe('#parametres-sources');
  });
  it('Linky: a failed collection, a stopped collection (the station is missing too), or Enedis', () => {
    const all = span('2024-01-01', '2024-06-30');
    const hole = (d: string) => d >= '2024-03-01' && d <= '2024-03-20';
    const linky = new Map(all.filter((d) => !hole(d)).map((d) => [d, 20]));
    const cause = (extra: Partial<QualityInput>) => qualityReport(base(recs('2024-01-01', '2024-06-30'), { last: '2024-06-30', linky, ...extra })).sources.find((s) => s.id === 'linky')!.gaps[0].cause;
    expect(cause({})).toBe('Enedis n’a pas transmis ces jours');
    expect(cause({ devices: { failures: { '2024-03-05': ['linky'], '2024-03-28': ['linky', 'netatmo'], '2024-04-15': ['linky'] } } })).toBe(
      'collecte Linky en échec (2 nuits) : ces jours n’ont pas été redemandés à temps',
    );
    const station = { modules: { m0: { name: 'Intérieur' } }, daily: { m0: daily(all.filter((d) => !hole(d))) } };
    expect(cause({ station })).toBe('collecte arrêtée : la station manque aussi ces jours-là');
    const s = qualityReport(base(recs('2024-01-01', '2024-06-30'), { last: '2024-06-30', linky, station })).sources.find((x) => x.id === 'station')!;
    expect(s.gaps[0].cause).toBe('collecte arrêtée : le compteur Linky manque aussi ces jours-là');
    const failed = qualityReport(base(recs('2024-01-01', '2024-06-30'), { last: '2024-06-30', station, devices: { failures: { '2024-03-02': ['netatmo'] } } }));
    expect(failed.sources.find((x) => x.id === 'station')!.gaps[0].cause).toMatch(/^collecte de la station en échec \(1 nuit\)/);
  });
  it('the hourly snapshot: a cut made the home unreachable', () => {
    const seen = Object.fromEntries(span('2026-01-01', '2026-01-20').filter((d) => d < '2026-01-08' || d > '2026-01-11').map((d) => [d, 0xffffff]));
    expect(fineSource('roomstate', seenParts(seen), null)!.gaps[0].cause).toMatch(/relevé horaire non passé/);
    const s = fineSource('roomstate', seenParts(seen), null, [], new Map([['2026-01-08', 'internet']]))!;
    expect(s.gaps[0].cause).toBe('coupure Internet le 8 janv. 2026 : la maison était injoignable');
  });
});
