// S-9.7: the long export of the demo respects the JSON Schema published in docs/.
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import schema from '../../docs/export-long.schema.json';
import { type Meta, toRecords } from './aggregate';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';
import type { Station } from './data';
import { LONG_COLUMNS, type LongInput, longDocument, longFileName, longRows, parseLongCsv, toLongCsv } from './export';

const FILES = import.meta.glob('../public/demo/*.json', { eager: true, import: 'default' });
const read = <T>(name: string) => FILES[`../public/demo/${name}`] as T;

/** The demo, decrypted the way the app does (passphrase « demo »). */
async function demo(): Promise<LongInput> {
  const key = await deriveKey('demo', read<KeyInfo>('keyinfo.json'));
  const dec = <T>(n: string) => decryptEnvelope<T>(read<Envelope>(`${n}.enc.json`), key);
  const meta = await dec<Meta>('meta');
  type YearDoc = { daily?: Record<string, Record<string, number>>; temps?: Record<string, Record<string, [number, number | null]>> };
  const years = await Promise.all(meta.years.map(async (y) => [String(y), await dec<YearDoc>(String(y))] as const));
  const temps: LongInput['temps'] = new Map();
  for (const [, doc] of years)
    for (const [room, days] of Object.entries(doc.temps ?? {})) {
      const m = temps.get(room) ?? new Map();
      for (const [d, v] of Object.entries(days)) m.set(d, v);
      temps.set(room, m);
    }
  const weather = await dec<{ outdoor: Record<string, [number, number, number]> }>('weather');
  const linky = await dec<{ daily: Record<string, number>; pmax: Record<string, number> }>('linky');
  return {
    meta,
    records: toRecords(meta, Object.fromEntries(years.map(([y, d]) => [y, d.daily ?? {}]))),
    temps,
    weather: new Map(Object.entries(weather.outdoor)),
    linky: new Map(Object.entries(linky.daily).map(([d, wh]) => [d, wh / 1000])),
    pmax: new Map(Object.entries(linky.pmax)),
    station: await dec<Station>('station'),
  };
}

const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
const validateDoc = ajv.compile(schema);
const validateRow = ajv.getSchema(`${schema.$id}#/$defs/row`)!;

describe('long export of the demo', () => {
  let input: LongInput;
  beforeAll(async () => {
    input = await demo();
  }, 30000);

  it('respects the JSON Schema of the repository', () => {
    const doc = longDocument(input, new Date('2026-11-09T10:00:00Z'));
    const valid = validateDoc(doc);
    expect(validateDoc.errors?.slice(0, 3) ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(Number.isNaN(Date.parse(doc.generated))).toBe(false);
    expect(doc.first_day).toBe('2022-01-01');
  });

  it('has one row per day, entity and metric, from every source', () => {
    const rows = longRows(input);
    const keys = new Set(rows.map((r) => `${r.date}|${r.source}|${r.entity}|${r.metric}`));
    expect(keys.size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['intuis', 'linky', 'weather', 'station']));
    const salon = rows.filter((r) => r.source === 'intuis' && r.entity === 'Salon' && r.metric === 'energy');
    expect(salon.length).toBeGreaterThan(1000);
    // kWh of the export = kWh of the app
    const total = rows.filter((r) => r.source === 'intuis' && r.metric === 'energy').reduce((s, r) => s + r.value, 0);
    const app = input.records.reduce((s, r) => s + r.kwh, 0);
    expect(Math.abs(total - app)).toBeLessThan(1);
  });

  it('writes a CSV with ISO dates and a decimal point, whose rows respect the schema', () => {
    const rows = longRows(input);
    const csv = toLongCsv(rows);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(LONG_COLUMNS.join(','));
    expect(lines.length).toBe(rows.length + 1);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(lines.slice(1).every((l) => /^\d{4}-\d{2}-\d{2},/.test(l))).toBe(true);
    expect(csv).not.toMatch(/;/);
    const back = parseLongCsv(csv);
    expect(back).toEqual(rows);
    const bad = back.find((r) => !validateRow(r));
    expect(bad).toBeUndefined();
  });
});

describe('long export details', () => {
  const meta: Meta = {
    home: { id: 'h', name: 'Maison', timezone: 'Europe/Paris' },
    rooms: [
      { id: 'a', name: 'Salon, "grand"', category: 'heating', module_types: [] },
      { id: 'x', name: 'Garage', category: 'ignore', module_types: [] },
    ],
    years: [2025],
    first_day: '2025-01-01',
    last_day: '2025-01-02',
    updated: '',
  };
  const input: LongInput = {
    meta,
    records: [
      { day: '2025-01-02', room: 'a', cat: 'heating', kwh: 1.23456 },
      { day: '2025-01-01', room: 'x', cat: 'ignore', kwh: 9 },
    ],
    temps: new Map([['a', new Map<string, [number, number | null]>([['2025-01-02', [19.456, null]]])]]),
    weather: null,
    linky: new Map(),
    pmax: new Map([['2025-01-01', 6.789]]),
    station: null,
  };

  it('rounds, skips ignored rooms and missing values, and sorts', () => {
    expect(longRows(input)).toEqual([
      { date: '2025-01-01', source: 'linky', entity: 'logement', metric: 'power_max', value: 6.79, unit: 'kVA' },
      { date: '2025-01-02', source: 'intuis', entity: 'Salon, "grand"', metric: 'energy', value: 1.235, unit: 'kWh' },
      { date: '2025-01-02', source: 'intuis', entity: 'Salon, "grand"', metric: 'temperature', value: 19.46, unit: '°C' },
    ]);
  });

  it('quotes names with commas or quotes in the CSV', () => {
    const csv = toLongCsv(longRows(input));
    expect(csv).toContain('2025-01-02,intuis,"Salon, ""grand""",energy,1.235,kWh');
    expect(parseLongCsv(csv)).toEqual(longRows(input));
  });

  it('names the files with the format version', () => {
    expect(longFileName('csv', new Date(2026, 10, 9))).toBe('energie-long-v1-2026-11-09.csv');
  });

  it('is valid even when empty', () => {
    const doc = longDocument({ ...input, records: [], temps: new Map(), pmax: new Map() });
    expect(doc.rows).toEqual([]);
    expect(validateDoc(doc)).toBe(true);
  });
});
