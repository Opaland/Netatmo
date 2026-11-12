// #440, #433: the rooms the stove heats — declared « poêle », or « radiateurs retirés » once wood
// is bought (the owner's Salon) — named by the stove's card and counted by the Accueil verdict.
// The app, the local store and the stopped rooms are stubbed.
import { describe, expect, it, vi } from 'vitest';
import type { StoppedRoom } from './room-offline';

const h = vi.hoisted(() => ({ ds: null as unknown, stopped: [] as unknown[] }));
vi.mock('./app', () => ({
  get ds() {
    return h.ds;
  },
  rawDataset: () => h.ds,
  onDatasetLoaded: () => {},
  rerender: () => {},
}));
vi.mock('./local-store', () => ({ loadNote: async () => null, saveNote: async () => true }));
vi.mock('./ui', () => ({ lastDay: () => '2026-11-08' }));
vi.mock('./views/offline-rooms', () => ({ stoppedRooms: () => h.stopped }));

const { stoveName, stoveRooms, verdictWood } = await import('./views/wood-state');

const PURCHASE = { day: '2025-09-27', steres: 1, species: 'chene', moisture: 20, price: 90 };
const ROOMS = [
  { id: 'r-salon', name: 'Salon' },
  { id: 'r-cuisine', name: 'Cuisine' },
  { id: 'r-ch', name: 'Chambre' },
];
/** A new dataset each time (the wood of a dataset is computed once). */
function setup(stopped: Partial<StoppedRoom>[], purchases: unknown[], roomMap?: Map<string, string>, burnt?: unknown[]) {
  h.stopped = stopped.map((s) => ({ from: '2025-10-14', label: '', ...s }));
  h.ds = { source: 'demo', key: null, meta: { rooms: ROOMS, wood: { purchases, burnt }, last_day: '2026-11-08' }, weather: null, roomMap };
}

describe('the rooms the stove heats (#440)', () => {
  it('« radiateurs retirés » is the stove’s room once wood is bought: the card keeps its name', () => {
    setup([{ room: 'r-salon', reason: 'retires' }], [PURCHASE]);
    expect(stoveRooms()).toEqual(['r-salon']);
    expect(stoveName()).toBe('Poêle à bois (Salon)');
  });
  it('without wood bought, radiators taken down say nothing of a stove', () => {
    setup([{ room: 'r-salon', reason: 'retires' }], []);
    expect(stoveRooms()).toEqual([]);
    expect(stoveName()).toBe('Poêle à bois');
  });
  it('« poêle » counts with or without wood; another reason never', () => {
    setup(
      [
        { room: 'r-cuisine', reason: 'poele' },
        { room: 'r-ch', reason: 'inoccupee' },
      ],
      [],
    );
    expect(stoveName()).toBe('Poêle à bois (Cuisine)');
    setup(
      [
        { room: 'r-cuisine', reason: 'poele' },
        { room: 'r-salon', reason: 'retires' },
        { room: 'r-ch', reason: 'autre-chauffage' },
      ],
      [PURCHASE],
    );
    expect(stoveName()).toBe('Poêle à bois (Cuisine, Salon)');
  });
});

describe('the wood the Accueil verdict counts (#433)', () => {
  it('a stove declared and wood bought: the wood of each day', () => {
    setup([{ room: 'r-salon', reason: 'retires' }], [PURCHASE]);
    const w = verdictWood('all', null);
    expect(w).not.toBeNull();
    expect([...w!.values()].reduce((s, [kwh]) => s + kwh, 0)).toBeGreaterThan(1000);
    expect(verdictWood('heating', ['r-salon'])).toBe(w);
  });
  it('none without a stove, without wood, on hot water alone, or on rooms without the stove’s', () => {
    setup([], [PURCHASE]);
    expect(verdictWood('all', null)).toBeNull();
    setup([{ room: 'r-cuisine', reason: 'poele' }], []);
    expect(verdictWood('all', null)).toBeNull();
    setup([{ room: 'r-cuisine', reason: 'poele' }], [PURCHASE]);
    expect(verdictWood('water_heater', null)).toBeNull();
    expect(verdictWood('all', ['r-ch'])).toBeNull();
  });
  it('the household view: the stove’s room under its display id', () => {
    setup([{ room: 'r-ch', reason: 'poele' }], [PURCHASE], new Map([['r-ch', 'chambres']]));
    expect(verdictWood('all', ['chambres'])).not.toBeNull();
    expect(verdictWood('all', ['r-salon'])).toBeNull();
  });
  it('#465: the wood really burnt, noted for a season, is what the verdict counts (one stock rule)', () => {
    const season = (w: Map<string, [number, number]>) => [...w].filter(([d]) => d >= '2025-09-01' && d <= '2026-08-31').reduce((s, [, [, eur]]) => s + eur, 0);
    setup([{ room: 'r-salon', reason: 'retires' }], [PURCHASE]);
    expect(season(verdictWood('all', null)!)).toBeCloseTo(90, 6);
    setup([{ room: 'r-salon', reason: 'retires' }], [PURCHASE], undefined, [{ season: 2025, steres: 0.5 }]);
    expect(season(verdictWood('all', null)!)).toBeCloseTo(45, 6);
  });
});
