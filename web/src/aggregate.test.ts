import { describe, expect, it } from 'vitest';
import {
  type DayRecord,
  type Meta,
  aggregate,
  bucketKeys,
  cumulativeByYear,
  minusYears,
  monthlyBySeason,
  monthlyByYear,
  seasonOf,
  toCsv,
  toRecords,
  weekStart,
} from './aggregate';
import { BadEnvelope, checkEnvelope, decryptEnvelope, deriveKey } from './crypto';
import vector from './__fixtures__/python-vector.json';
import padded from './__fixtures__/python-vector-padded.json';

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

describe('a day in two year files (#532)', () => {
  it('is one record, from the file of its own year, never the sum', () => {
    const meta = { rooms: [{ id: 'r1', name: 'Salon', category: 'heating' }] } as unknown as Meta;
    const recs = toRecords(meta, { '2024': { r1: { '2024-12-31': 3000, '2024-12-30': 1000 } }, '2025': { r1: { '2024-12-31': 9000, '2025-01-01': 2000 } } });
    expect(recs.map((r) => [r.day, r.kwh])).toEqual([
      ['2024-12-30', 1],
      ['2024-12-31', 3],
      ['2025-01-01', 2],
    ]);
    // own year wins even when its file comes second
    const back = toRecords(meta, { '2025': { r1: { '2024-12-31': 9000 } }, '2024': { r1: { '2024-12-31': 3000 } } });
    expect(back.map((r) => r.kwh)).toEqual([3]);
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
  it('#138 : lit un fichier rempli par paliers comme un fichier sans remplissage (mêmes totaux)', async () => {
    // Same vectors as tests/test_remplissage.py: written by Python before and after #138.
    const key = await deriveKey('test', { salt: padded.salt, iter: padded.iter });
    type Doc = { txt: string; daily: Record<string, Record<string, number>> };
    const before = await decryptEnvelope<Doc>(vector, key);
    const after = await decryptEnvelope<Doc>(padded, key);
    expect(atob(padded.ct).length).toBe(4096 + 16); // padded inside the ciphertext, GCM tag after
    expect(atob(vector.ct).length).toBeLessThan(4096);
    expect(after).toEqual(before);
    const total = (d: Doc) => Object.values(d.daily).flatMap((days) => Object.values(days)).reduce((a, b) => a + b, 0);
    expect(total(after)).toBe(1200.5);
  });
  it('rejects a wrong passphrase', async () => {
    const key = await deriveKey('nope', { salt: vector.salt, iter: vector.iter });
    await expect(decryptEnvelope(vector, key)).rejects.toThrow('Phrase de passe incorrecte');
  });
  it('#236 : refuse une dérivation faible et un format inconnu, avec un message clair', async () => {
    await expect(deriveKey('test', { salt: vector.salt, iter: 1000 })).rejects.toThrow(BadEnvelope);
    await expect(deriveKey('test', { salt: vector.salt, iter: '600000' as unknown as number })).rejects.toThrow(/itérations/);
    const key = await deriveKey('test', { salt: vector.salt, iter: vector.iter });
    await expect(decryptEnvelope({ ...vector, v: 2 }, key)).rejects.toThrow(/version 2/);
    await expect(decryptEnvelope({ ...vector, kdf: 'scrypt' }, key)).rejects.toThrow(BadEnvelope);
    await expect(decryptEnvelope({ ...vector, iter: 1000 }, key)).rejects.toThrow(/600/);
    expect(() => checkEnvelope(vector)).not.toThrow();
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

import { compareOffers, daySplits, parseTempoCsv } from './analysis';

describe('offer comparator', () => {
  const head = 'DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;';
  const base = parseTrveCsv(`${head}PART_VARIABLE_HT;PART_VARIABLE_TTC\n01/01/2024;;9;0;365;0;0,25\n`);
  const hphc = parseTrveCsv(`${head}PART_VARIABLE_HC_HT;PART_VARIABLE_HC_TTC;PART_VARIABLE_HP_HT;PART_VARIABLE_HP_TTC\n01/01/2024;;9;0;365;0;0,20;0;0,30\n`);
  const tempo = parseTempoCsv(
    'DATE_DEBUT;DATE_FIN;P_SOUSCRITE;PART_FIXE_HT;PART_FIXE_TTC;PART_VARIABLE_HCBleu_HT;PART_VARIABLE_HCBleu_TTC;PART_VARIABLE_HPBleu_HT;PART_VARIABLE_HPBleu_TTC;PART_VARIABLE_HCBlanc_HT;PART_VARIABLE_HCBlanc_TTC;PART_VARIABLE_HPBlanc_HT;PART_VARIABLE_HPBlanc_TTC;PART_VARIABLE_HCRouge_HT;PART_VARIABLE_HCRouge_TTC;PART_VARIABLE_HPRouge_HT;PART_VARIABLE_HPRouge_TTC\n01/01/2024;;9;0;365;0;0,1;0;0,15;0;0,12;0;0,18;0;0,14;0;0,7\n',
  );
  it('splits the rest of the home flat over 24 h and prices each offer the same days', () => {
    const tariffs = new Map([['a', new Map([['2025-01-02', [0, 4, 6] as [number, number, number]]])]]);
    const recs = [rec('2025-01-02', 10)];
    const linky = new Map([['2025-01-02', 13]]); // 3 kWh of other uses
    const splits = daySplits(recs, tariffs, 2, { perRoom: new Map(), overall: 0.3 }, linky);
    expect(splits[0].hc).toBeCloseTo(6 + 1, 6);
    expect(splits[0].hp).toBeCloseTo(4 + 2, 6);
    const r = compareOffers(splits, () => 9, base, hphc, tempo, new Map([['2025-01-02', 3]]));
    expect(r.base.energy).toBeCloseTo(13 * 0.25, 6);
    expect(r.hphc.energy).toBeCloseTo(7 * 0.2 + 6 * 0.3, 6);
    expect(r.tempo.energy).toBeCloseTo(7 * 0.14 + 6 * 0.7, 6); // red day
    expect(r.tempo.subscription).toBeCloseTo(1, 6);
  });
});

import { anomalies, daysAbove } from './analysis';

describe('anomalies', () => {
  it('flags a heating day far above the signature', () => {
    const weather = new Map<string, [number, number, number]>();
    const recs: DayRecord[] = [];
    for (let i = 0; i < 60; i++) {
      const day = addDaysTest('2025-11-01', i);
      const t = (i % 15) - 2;
      weather.set(day, [t - 2, t + 2, t]);
      recs.push(rec(day, 40 - 2 * t + (i % 3) * 0.3));
    }
    recs.push(rec('2026-01-05', 0)); // placeholder day without weather: ignored
    recs[30].kwh += 25; // one abnormal day
    const a = anomalies(recs, weather);
    expect(a.map((x) => x.day)).toEqual([recs[30].day]);
    expect(a[0].z).toBeGreaterThan(2);
    // S-1.10: a lost or estimated day is never listed
    expect(anomalies(recs, weather, new Set([recs[30].day]))).toEqual([]);
  });
  it('counts days above a threshold', () => {
    expect(daysAbove({ '2025-01-01': [0, 0, 0, 60, 1200], '2025-01-02': [0, 0, 0, 50, 800] }, 4, 1000, '2025-01-01', '2025-12-31')).toBe(1);
  });
});

function addDaysTest(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

import { inferKvaChange } from './analysis';

describe('subscribed power inferred from Linky', () => {
  it('finds the first day above the declared power and the new standard power', () => {
    const pmax = new Map([
      ['2024-01-01', 8.7],
      ['2024-01-02', 8.95],
      ['2024-02-10', 10.4],
      ['2024-12-01', 11.6],
    ]);
    expect(inferKvaChange(pmax, 9)).toEqual({ from: 9, to: 12, firstOver: '2024-02-10', lastWithin: '2024-01-02' });
    expect(inferKvaChange(pmax, 12)).toBeNull();
  });
});
