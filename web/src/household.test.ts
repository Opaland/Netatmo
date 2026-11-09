import { describe, expect, it } from 'vitest';
import type { Dataset } from './data';
import { BEDROOMS_ID, bedroomIds, householdStation, householdView, isBedroom } from './household';

const room = (id: string, name: string, category: 'heating' | 'water_heater' = 'heating') => ({ id, name, category, module_types: ['NMH'] });

function dataset(): Dataset {
  return {
    source: 'demo',
    key: {} as CryptoKey,
    meta: {
      home: { id: 'h', name: 'Maison', timezone: 'Europe/Paris' },
      rooms: [room('s', 'Salon'), room('c1', 'Chambre parentale'), room('c2', 'Chambre enfant'), room('w', 'Chauffe-eau', 'water_heater')],
      years: [2025],
      first_day: '2025-01-01',
      last_day: '2025-01-02',
      updated: '',
    },
    records: [
      { day: '2025-01-01', room: 's', cat: 'heating', kwh: 5 },
      { day: '2025-01-01', room: 'c1', cat: 'heating', kwh: 2 },
      { day: '2025-01-01', room: 'c2', cat: 'heating', kwh: 1 },
      { day: '2025-01-02', room: 'c2', cat: 'heating', kwh: 3 },
      { day: '2025-01-02', room: 'w', cat: 'water_heater', kwh: 4 },
    ],
    tariffs: new Map([
      ['c1', new Map([['2025-01-01', [0, 1, 1] as [number, number, number]]])],
      ['c2', new Map([['2025-01-01', [0, 0.5, 0.5] as [number, number, number]]])],
    ]),
    temps: new Map([
      ['c1', new Map([['2025-01-01', [18, 17] as [number, number | null]]])],
      ['c2', new Map([['2025-01-01', [20, null] as [number, number | null]]])],
      ['s', new Map([['2025-01-01', [21, 20] as [number, number | null]]])],
    ]),
    weather: null,
    indoor: new Map(),
    linky: new Map(),
    insights: { generated: '', model: '', period: '', markdown: 'La **Chambre enfant** chauffe peu.', facts: { rooms: { 'Chambre enfant': 4 } } },
    estimated: new Set(['c2|2025-01-02', 's|2025-01-01']),
    coverage: new Map([
      ['c1', new Map([['2025-01', [31, 0, 0] as [number, number, number]]])],
      ['c2', new Map([['2025-01', [29, 2, 0] as [number, number, number]]])],
    ]),
    trve: [],
    offers: new Map(),
    pmax: new Map(),
    tempo: { rows: [], days: new Map() },
    station: null,
  };
}

describe('household view (S-12.2)', () => {
  it('recognises bedrooms by name', () => {
    expect(isBedroom('Chambre des enfants')).toBe(true);
    expect(isBedroom('chambres')).toBe(true);
    expect(isBedroom('Bedroom 2')).toBe(true);
    expect(isBedroom('Salon')).toBe(false);
    expect(isBedroom('Antichambre')).toBe(false);
    expect(bedroomIds(dataset().meta.rooms)).toEqual(['c1', 'c2']);
  });

  it('merges bedrooms into one room and keeps totals', () => {
    const ds = dataset();
    const v = householdView(ds);
    expect(v.meta.rooms.map((r) => r.name)).toEqual(['Salon', 'Chambres', 'Chauffe-eau']);
    const total = (d: Dataset) => d.records.reduce((s, r) => s + r.kwh, 0);
    expect(total(v)).toBe(total(ds));
    expect(v.records.filter((r) => r.room === BEDROOMS_ID).map((r) => [r.day, r.kwh])).toEqual([
      ['2025-01-01', 3],
      ['2025-01-02', 3],
    ]);
    expect(v.records.some((r) => r.room === 'c1' || r.room === 'c2')).toBe(false);
    expect(v.tariffs.get(BEDROOMS_ID)!.get('2025-01-01')).toEqual([0, 1.5, 1.5]);
    expect(v.temps.get(BEDROOMS_ID)!.get('2025-01-01')).toEqual([19, null]);
    expect(v.temps.get('s')).toBe(ds.temps.get('s'));
    expect(v.estimated).toEqual(new Set([`${BEDROOMS_ID}|2025-01-02`, 's|2025-01-01']));
    expect(v.coverage!.get(BEDROOMS_ID)!.get('2025-01')).toEqual([29, 2, 0]);
    expect(v.roomMap!.get('c1')).toBe(BEDROOMS_ID);
    // the original dataset is untouched (detail on demand)
    expect(ds.records[1].room).toBe('c1');
    expect(ds.records[1].kwh).toBe(2);
  });

  it('hides bedroom names in the AI text', () => {
    const v = householdView(dataset());
    expect(v.insights!.markdown).toBe('La **Chambres** chauffe peu.');
    expect(v.insights!.facts).toBeUndefined();
  });

  it('returns the dataset unchanged without bedroom', () => {
    const ds = dataset();
    ds.meta.rooms = ds.meta.rooms.filter((r) => !r.id.startsWith('c'));
    expect(householdView(ds)).toBe(ds);
  });

  it('merges bedroom station modules', () => {
    const st = householdStation({
      modules: {
        m0: { name: 'Salon', type: 'NAMain', indoor: true },
        m1: { name: 'Extérieur', type: 'NAModule1', indoor: false },
        m2: { name: 'Chambre enfants', type: 'NAModule4', indoor: true },
        m3: { name: 'Chambre parents', type: 'NAModule4', indoor: true },
      },
      daily: {
        m0: { '2025-01-01': [19, 21, 20, 50, 600] },
        m2: { '2025-01-01': [17, 20, 18, 55, 900] },
        m3: { '2025-01-01': [16, 19, 18, null, 1100] },
      },
    });
    expect(Object.values(st.modules).map((m) => m.name)).toEqual(['Salon', 'Extérieur', 'Chambres']);
    expect(st.daily[BEDROOMS_ID]['2025-01-01']).toEqual([16, 20, 18, 55, 1000]);
    expect(st.daily.m2).toBeUndefined();
  });
});
