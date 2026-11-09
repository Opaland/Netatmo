import { describe, expect, it } from 'vitest';
import {
  type DayRecord,
  aggregate,
  bucketKeys,
  cumulativeByYear,
  minusYears,
  monthlyBySeason,
  monthlyByYear,
  seasonOf,
  toCsv,
  weekStart,
} from './aggregate';
import { decryptEnvelope, deriveKey } from './crypto';
import vector from './__fixtures__/python-vector.json';

const rec = (day: string, kwh: number, room = 'a', cat: DayRecord['cat'] = 'heating'): DayRecord => ({ day, room, cat, kwh });

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2025-01-05')).toBe('2024-12-30'); // Sunday
    expect(weekStart('2025-01-06')).toBe('2025-01-06');
  });
  it('leap day maps to 28 Feb a year earlier', () => {
    expect(minusYears('2024-02-29')).toBe('2023-02-28');
  });
  it('bucket keys include empty buckets', () => {
    expect(bucketKeys('2024-11-15', '2025-02-01', 'month')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
    expect(bucketKeys('2024-01-01', '2024-01-15', 'week')).toEqual(['2024-01-01', '2024-01-08', '2024-01-15']);
  });
  it('heating seasons run September to August', () => {
    expect(seasonOf('2024-09-01')).toBe('2024-2025');
    expect(seasonOf('2025-08-31')).toBe('2024-2025');
  });
});

describe('aggregation', () => {
  const records = [rec('2024-01-01', 1), rec('2024-01-02', 2, 'b', 'water_heater'), rec('2024-02-10', 4), rec('2025-01-01', 8)];
  it('sums per bucket and group', () => {
    const s = aggregate(records, '2024-01-01', '2024-03-31', 'month', (r) => r.cat);
    expect(s.keys).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(s.groups.get('heating')).toEqual([1, 4, 0]);
    expect(s.groups.get('water_heater')).toEqual([2, 0, 0]);
  });
  it('monthly by year leaves months without data as null', () => {
    const m = monthlyByYear(records);
    expect(m.get(2024)!.slice(0, 3)).toEqual([3, 4, null]);
  });
  it('cumulative stops after the last day of the current year', () => {
    const c = cumulativeByYear(records, '2025-01-01');
    expect(c.get(2025)![0]).toBe(8);
    expect(c.get(2025)![1]).toBeNull();
    expect(c.get(2024)![365]).toBe(7);
  });
  it('season months start in September', () => {
    const s = monthlyBySeason([rec('2024-09-03', 5), rec('2025-01-03', 1)]);
    expect(s.get('2024-2025')![0]).toBe(5);
    expect(s.get('2024-2025')![4]).toBe(1);
  });
  it('csv uses semicolons and decimal commas', () => {
    const csv = toCsv([rec('2024-01-01', 1.5)], [{ id: 'a', name: 'Salon; nord', category: 'heating', module_types: [] }]);
    expect(csv).toBe('date;piece;categorie;kwh\n2024-01-01;"Salon; nord";Chauffage;1,500\n');
  });
});

describe('crypto', () => {
  it('decrypts what the Python collector encrypted', async () => {
    const key = await deriveKey('test', { salt: vector.salt, iter: vector.iter });
    const out = await decryptEnvelope<{ txt: string; daily: Record<string, Record<string, number>> }>(vector, key);
    expect(out.txt).toBe('Salle de bain é');
    expect(out.daily['100']['2024-01-01']).toBe(1200.5);
  });
  it('rejects a wrong passphrase', async () => {
    const key = await deriveKey('nope', { salt: vector.salt, iter: vector.iter });
    await expect(decryptEnvelope(vector, key)).rejects.toThrow('Phrase de passe incorrecte');
  });
});

import { energyCostTrve, parseTrveCsv, subscriptionTrve, trveAt } from './analysis';

describe('regulated tariff (CRE open data)', () => {
  const csv = `DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC\r
01/02/2024;31/01/2025;9;161,4;200,33;0,1513;0,2068;0,204;0,27\r
01/02/2025;;9;172,8;214,88;0,1076;0,1696;0,1451;0,2146\r
`;
  const rows = parseTrveCsv(csv);
  it('parses French dates and decimals', () => {
    expect(rows[0]).toEqual({ from: '2024-02-01', to: '2025-01-31', kva: 9, fixedYear: 200.33, hc: 0.2068, hp: 0.27 });
    expect(trveAt(rows, 9, '2025-06-01')!.hc).toBe(0.1696);
    expect(trveAt(rows, 6, '2025-06-01')).toBeNull();
  });
  it('prices each day at the tariff in force, estimating the split without detail', () => {
    const tariffs = new Map([['a', new Map([['2025-03-01', [0, 2, 8] as [number, number, number]]])]]);
    const recs = [rec('2025-03-01', 10), rec('2024-03-01', 10)];
    const c = energyCostTrve(recs, tariffs, rows, 9, 2, { perRoom: new Map([['a', 0.8]]), overall: 0.5 });
    const expected = 8 * 0.1696 + 2 * 0.2146 + 10 * (0.8 * 0.2068 + 0.2 * 0.27);
    expect(c.energy).toBeCloseTo(expected, 6);
    expect(c.estimatedKwh).toBe(10);
  });
  it('prorates the yearly subscription per day', () => {
    expect(subscriptionTrve(rows, 9, '2025-03-01', '2025-03-02')).toBeCloseTo((2 * 214.88) / 365, 6);
  });
});
