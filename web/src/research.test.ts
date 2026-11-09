// S-6.6: anonymised research export. Leak test on the demo (as anon.test.ts for S-6.4).
import { beforeAll, describe, expect, it } from 'vitest';
import { type Meta, toRecords } from './aggregate';
import type { Hourly } from './analysis';
import type { StationHourly } from './comfort';
import { type Envelope, type KeyInfo, decryptEnvelope, deriveKey } from './crypto';
import type { Station } from './data';
import {
  RESEARCH_COLUMNS,
  type ResearchInput,
  researchDocument,
  researchLeaks,
  researchSecrets,
  toResearchCsv,
} from './research';

const FILES = import.meta.glob('../public/demo/*.json', { eager: true, import: 'default' });
const read = <T>(name: string) => FILES[`../public/demo/${name}`] as T;

/** The whole demo, hourly documents included, decrypted the way the app does. */
async function demo(): Promise<ResearchInput> {
  const key = await deriveKey('demo', read<KeyInfo>('keyinfo.json'));
  const dec = <T>(n: string) => decryptEnvelope<T>(read<Envelope>(`${n}.enc.json`), key);
  const meta = await dec<Meta>('meta');
  type YearDoc = { daily?: Record<string, Record<string, number>>; temps?: Record<string, Record<string, [number, number | null]>> };
  const years = await Promise.all(meta.years.map(async (y) => [String(y), await dec<YearDoc>(String(y))] as const));
  const temps: ResearchInput['temps'] = new Map();
  for (const [, doc] of years)
    for (const [room, days] of Object.entries(doc.temps ?? {})) {
      const m = temps.get(room) ?? new Map();
      for (const [d, v] of Object.entries(days)) m.set(d, v);
      temps.set(room, m);
    }
  const hourly: Hourly = new Map();
  for (const y of meta.hourly_years ?? []) {
    const doc = await dec<{ hourly: Record<string, Record<string, number>> }>(`${y}.hourly`);
    for (const [room, hours] of Object.entries(doc.hourly)) {
      const m = hourly.get(room) ?? new Map();
      for (const [h, wh] of Object.entries(hours)) m.set(h, wh / 1000);
      hourly.set(room, m);
    }
  }
  const stationHourly: StationHourly = new Map();
  for (const y of meta.station_hourly_years ?? []) {
    const doc = await dec<{ hourly: Record<string, Record<string, [number | null, number | null, number | null]>> }>(`${y}.station_h`);
    for (const [mod, hours] of Object.entries(doc.hourly)) {
      const m = stationHourly.get(mod) ?? new Map();
      for (const [h, v] of Object.entries(hours)) m.set(h, v);
      stationHourly.set(mod, m);
    }
  }
  const curve = new Map<string, number>();
  for (const y of (meta as Meta & { linky_curve_years?: number[] }).linky_curve_years ?? []) {
    const doc = await dec<{ curve: Record<string, number> }>(`${y}.linky30`);
    for (const [k, wh] of Object.entries(doc.curve)) curve.set(k, wh);
  }
  const weather = await dec<{ outdoor: Record<string, [number, number, number]> }>('weather');
  const linky = await dec<{ daily: Record<string, number> }>('linky');
  const rooms = meta.rooms.filter((r) => r.category === 'heating');
  return {
    meta,
    records: toRecords(meta, Object.fromEntries(years.map(([y, d]) => [y, d.daily ?? {}]))),
    temps,
    weather: new Map(Object.entries(weather.outdoor)),
    linky: new Map(Object.entries(linky.daily).map(([d, wh]) => [d, wh / 1000])),
    station: await dec<Station>('station'),
    hourly,
    stationHourly,
    curve,
    surfaces: { [rooms[0].id]: 14, [rooms[1].id]: 22.5 },
    markers: [{ day: '2025-06-01', kind: 'isolation' }],
  };
}

let input: ResearchInput;
beforeAll(async () => {
  input = await demo();
}, 30_000);

describe('research export of the demo', () => {
  it('shifts dates to a relative origin and writes no real date', () => {
    const doc = researchDocument(input, { license: 'CC-BY-4.0', shift: true, zone: 'H2b' });
    expect(doc.rows.length).toBeGreaterThan(10_000);
    expect(doc.rows.every((r) => typeof r.time === 'number' && r.time >= 0)).toBe(true);
    expect(doc.rows.reduce((m, r) => Math.min(m, r.time as number), Infinity)).toBe(0);
    expect(doc.generated).toBeNull();
    const csv = toResearchCsv(doc);
    const json = JSON.stringify(doc);
    expect(csv).not.toMatch(/\b20\d{2}-\d{2}-\d{2}/);
    expect(json).not.toMatch(/\b20\d{2}-\d{2}-\d{2}/);
    expect(researchLeaks(csv, input, true, toResearchCsv(doc, false))).toEqual([]);
    expect(researchLeaks(json, input, true)).toEqual([]);
  });

  it('never writes a name or an identifier (rooms, modules, home)', () => {
    const doc = researchDocument(input, { license: 'CC0-1.0', shift: false, zone: null });
    const text = toResearchCsv(doc) + JSON.stringify(doc);
    const secrets = researchSecrets(input);
    expect(secrets.length).toBeGreaterThan(8);
    for (const s of secrets) {
      // generic words the export writes itself; ids shorter than 3 characters (demo modules « m1 ») are not secrets
      if (s.length < 3 || /^(chauffe-eau|exterieur|extérieur)$/i.test(s)) continue;
      expect(text, s).not.toContain(s);
    }
    expect(researchLeaks(text, input, false, toResearchCsv(doc, false))).toEqual([]);
  });

  it('has hourly and daily values, pseudonyms, surfaces, works and the licence', () => {
    const doc = researchDocument(input, { license: 'ODbL-1.0', shift: true, zone: null });
    const entities = new Set(doc.rows.map((r) => r.entity));
    expect(entities).toContain('Pièce A');
    expect(entities).toContain('logement');
    expect(entities).toContain('exterieur');
    expect([...entities].some((e) => /^Capteur \d$/.test(e))).toBe(true);
    expect(doc.rows.some((r) => r.step_h === 1 && r.metric === 'energy')).toBe(true);
    expect(doc.rows.some((r) => r.step_h === 1 && r.metric === 'co2')).toBe(true);
    expect(doc.rows.some((r) => r.step_h === 24 && r.metric === 'temperature_mean')).toBe(true);
    expect(doc.entities.filter((e) => e.surface_m2).map((e) => e.surface_m2).sort()).toEqual([14, 22.5]);
    expect(doc.events).toHaveLength(1);
    expect(typeof doc.events[0].time).toBe('number');
    expect(doc.events[0].kind).toBe('isolation');
    const csv = toResearchCsv(doc);
    const lines = csv.split('\n');
    expect(lines[1]).toMatch(/^# Licence : ODbL-1\.0/);
    expect(lines.some((l) => /^# Limite : Un seul logement/.test(l))).toBe(true);
    expect(lines.some((l) => l === '# Localisation : non communiquée')).toBe(true);
    expect(lines.find((l) => !l.startsWith('#'))).toBe(RESEARCH_COLUMNS.join(','));
  });
});

describe('detector', () => {
  const meta = {
    home: { id: '5f1a2b3c4d5e6f7a8b9c0d1e', name: 'Maison Dupont', timezone: 'Europe/Paris' },
    rooms: [
      { id: '2871340912', name: 'Chambre de Léa', category: 'heating' as const, module_types: [] },
      { id: '1029384756', name: 'Salon', category: 'heating' as const, module_types: [] },
    ],
  };
  const station = { modules: { '70:ee:50:00:00:01': { name: 'Cave', type: 'NAModule4', indoor: true } }, daily: {} };
  it('catches names, ids and real dates', () => {
    expect(researchLeaks('Pièce A,Salon', { meta, station }, false)).toEqual(['Salon']);
    expect(researchLeaks('x 70:ee:50:00:00:01 y', { meta, station }, false)).toEqual(['70:ee:50:00:00:01']);
    expect(researchLeaks('Chambre de Léa', { meta, station }, false)).toEqual(['Chambre de Léa']);
    expect(researchLeaks('time 2025-01-12', { meta, station }, true)).toEqual(['date 2025-01-12']);
    expect(researchLeaks('time 2025-01-12', { meta, station }, false)).toEqual([]);
  });
  it('pseudonymises a home whose rooms have revealing names', () => {
    const records = [
      { day: '2025-01-01', room: '2871340912', cat: 'heating' as const, kwh: 3 },
      { day: '2025-01-01', room: '1029384756', cat: 'heating' as const, kwh: 9 },
    ];
    const doc = researchDocument(
      { meta, records, temps: new Map(), weather: null, linky: new Map(), station, hourly: null, stationHourly: new Map([['70:ee:50:00:00:01', new Map([['2025-01-01T05', [12, 80, 600] as [number, number, number]]])]]), curve: null },
      { license: 'CC-BY-4.0', shift: true, zone: 'H1a' },
    );
    expect(doc.rows.map((r) => `${r.time} ${r.entity} ${r.metric} ${r.value}`)).toEqual([
      '0 Pièce A energy 9',
      '0 Pièce B energy 3',
      '5 Capteur 1 co2 600',
      '5 Capteur 1 humidity 80',
      '5 Capteur 1 temperature 12',
    ]);
    const csv = toResearchCsv(doc);
    expect(csv).toContain('# Localisation : zone climatique H1a');
    expect(researchLeaks(csv, { meta, station }, true, toResearchCsv(doc, false))).toEqual([]);
  });
});
