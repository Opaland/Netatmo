// #678: the survivors of the first mutation run on aggregate.ts (71,7 %), each test seen red on its
// mutant. The constants and the arrow functions of the module are set when it loads: the tests that
// read them load it afresh (vi.resetModules), else the mutation run replays them on no test of their
// own. Fictitious data only. What is left, and why: docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it, vi } from 'vitest';
import {
  type DayRecord,
  type Meta,
  aggregate,
  applyFilter,
  bucketLabel,
  cumulativeByYear,
  leapDayIndex,
  monthlyBySeason,
  totalsBy,
} from './aggregate';

const rec = (day: string, kwh: number, room = 'a', cat: DayRecord['cat'] = 'heating'): DayRecord => ({ day, room, cat, kwh });
const fresh = async () => {
  vi.resetModules();
  return import('./aggregate');
};

describe('#678 : ce que le module définit au chargement', () => {
  it('les noms des mois, courts et longs, et des catégories', async () => {
    const m = await fresh();
    expect(m.MONTHS_SHORT).toEqual(['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']);
    expect(m.MONTHS_LONG).toEqual(['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']);
    expect(m.CATEGORY_LABEL).toEqual({ heating: 'Chauffage', water_heater: 'Chauffe-eau', ignore: 'Ignoré' });
    expect(m.SEASON_MONTHS).toEqual([8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('keepFromYear, addDays, measuredValues et ratioChange', async () => {
    const m = await fresh();
    expect(m.keepFromYear(false, '2024-12-31', '2025')).toBe(true);
    expect(m.keepFromYear(true, '2024-12-31', '2025')).toBe(false);
    expect(m.keepFromYear(true, '2025-01-01', '2025')).toBe(true);
    expect(m.addDays('2024-02-28', 2)).toBe('2024-03-01');
    const set = m.aggregate([rec('2025-01-02', 1.26)], '2025-01-01', '2025-01-02', 'day', () => 'g');
    expect(m.measuredValues(set, 'g', (v) => Math.round(v * 10) / 10)).toEqual([null, 1.3]);
    expect(m.ratioChange(12, 10)).toBeCloseTo(20, 9);
    expect(m.ratioChange(null, 10)).toBeNull();
    expect(m.ratioChange(10, null)).toBeNull();
  });
  it('toRecords : une pièce absente de meta est du chauffage, une pièce ignorée est laissée, jours rangés', async () => {
    const m = await fresh();
    const meta = { rooms: [{ id: 'w', name: 'W', category: 'water_heater', module_types: [] }, { id: 'x', name: 'X', category: 'ignore', module_types: [] }] } as unknown as Meta;
    const recs = m.toRecords(meta, {
      '2025': { z: { '2025-01-03': 3000, '2025-01-01': 1000 }, w: { '2025-01-01': 500, '2025-01-02': 700 }, x: { '2025-01-01': 9000 } },
    });
    expect(recs).toEqual([
      { day: '2025-01-01', room: 'z', cat: 'heating', kwh: 1 },
      { day: '2025-01-01', room: 'w', cat: 'water_heater', kwh: 0.5 },
      { day: '2025-01-02', room: 'w', cat: 'water_heater', kwh: 0.7 },
      { day: '2025-01-03', room: 'z', cat: 'heating', kwh: 3 },
    ]);
  });
  it('total : la fin de la période comprise, le lendemain non', async () => {
    const m = await fresh();
    expect(m.total([rec('2025-01-01', 1), rec('2025-01-02', 2), rec('2025-01-03', 4)], '2025-01-01', '2025-01-02')).toBe(3);
  });
});

describe('#678 : filtres, étiquettes et regroupements', () => {
  const recs = [rec('2025-01-01', 1), rec('2025-01-01', 2, 'b'), rec('2025-01-01', 4, 'w', 'water_heater')];
  it('applyFilter : par catégorie, puis par pièce', () => {
    expect(applyFilter(recs, { cats: new Set(['heating']), rooms: null })).toEqual(recs.slice(0, 2));
    expect(applyFilter(recs, { cats: new Set(['heating', 'water_heater']), rooms: new Set(['b', 'w']) })).toEqual(recs.slice(1));
    expect(applyFilter(recs, { cats: new Set(['water_heater']), rooms: new Set(['a']) })).toEqual([]);
  });
  it('bucketLabel : jour, semaine, mois, année', () => {
    expect(bucketLabel('2025-03-07', 'day')).toBe('7 mars 2025');
    expect(bucketLabel('2025-12-01', 'week')).toBe('sem. du 1 déc. 2025');
    expect(bucketLabel('2025-02', 'month')).toBe('févr. 2025');
    expect(bucketLabel('2025', 'year')).toBe('2025');
  });
  it('aggregate : un jour après la fin, même dans le dernier mois, n’est pas compté', () => {
    const set = aggregate([rec('2025-01-10', 1), rec('2025-01-20', 5)], '2025-01-01', '2025-01-15', 'month', () => 'g');
    expect(set.groups.get('g')).toEqual([1]);
  });
  it('totalsBy : par clé, bornes comprises, hors période laissé', () => {
    const t = totalsBy([...recs, rec('2025-01-02', 8), rec('2024-12-31', 16), rec('2025-01-03', 32)], '2025-01-01', '2025-01-02', (r) => r.cat);
    expect([...t]).toEqual([
      ['heating', 11],
      ['water_heater', 4],
    ]);
  });
  it('monthlyBySeason : douze mois, null sans relevé, deux jours d’un mois additionnés', () => {
    const s = monthlyBySeason([rec('2025-01-01', 1), rec('2025-01-02', 2)]);
    expect(s.get('2024-2025')).toEqual([null, null, null, null, 3, null, null, null, null, null, null, null]);
  });
});

describe('#678 : l’axe des années bissextiles et le cumul', () => {
  it('leapDayIndex : 1900 et 2100 ne sont pas bissextiles, 2000 l’est', () => {
    expect(leapDayIndex('1900-03-01')).toBe(60);
    expect(leapDayIndex('2100-03-01')).toBe(60);
    expect(leapDayIndex('2000-03-01')).toBe(60);
    expect(leapDayIndex('2000-02-29')).toBe(59);
  });
  it('cumulativeByYear : le premier jour des données, même relevés dans le désordre ; deux trous dans l’année', () => {
    const c = cumulativeByYear([rec('2024-01-05', 2), rec('2024-01-03', 1), rec('2025-01-01', 4)], '2025-01-02', new Set(['2024-01-04', '2024-01-06']));
    expect(c.get(2024)!.slice(0, 7)).toEqual([null, null, 1, null, 3, null, 3]);
    // the year after the first one is drawn from 1 January
    expect(c.get(2025)!.slice(0, 3)).toEqual([4, 4, null]);
  });
});
