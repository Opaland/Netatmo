// #253: app.ts, the state and the dataset shown. Default state, migration of what older
// versions saved (v1.0 single price, v1.4 `household`, unscoped names #229), the state fixed
// against a new dataset (years, rooms, pinned room, shared contract), the household view
// (S-12.2, display only) and the dataset hooks (#232 #255). Each test loads a fresh module
// against an in-memory localStorage, as the page would at start-up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset } from './data';
import type { ContractPeriod } from './offers';

function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

/** A fresh app.ts, as at page load: `saved` in localStorage, the page served under `path`. */
async function boot(saved: Record<string, string> = {}, path = '/') {
  vi.resetModules();
  const storage = fakeStorage(saved);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { baseURI: `https://exemple.github.io${path}`, getElementById: () => null });
  const app = await import('./app');
  return { app, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const room = (id: string, name: string, category: 'heating' | 'water_heater' | 'ignore' = 'heating') => ({ id, name, category, module_types: ['NMH'] });

function dataset(o: { years?: number[]; contract?: ContractPeriod[]; weather?: boolean } = {}): Dataset {
  const years = o.years ?? [2023, 2024, 2025, 2026];
  const rooms = [room('s', 'Salon'), room('c1', 'Chambre parentale'), room('c2', 'Chambre enfant'), room('w', 'Chauffe-eau', 'water_heater'), room('g', 'Garage', 'ignore'), room('v', 'Véranda')];
  const records = years.flatMap((y) =>
    ['s', 'c1', 'c2', 'w', 'g'].map((r) => ({ day: `${y}-01-15`, room: r, cat: r === 'w' ? 'water_heater' : 'heating', kwh: 2 })),
  ) as Dataset['records'];
  return {
    source: 'demo',
    key: {} as CryptoKey,
    meta: {
      home: { id: 'h', name: 'Maison', timezone: 'Europe/Paris' },
      rooms,
      years,
      first_day: `${years[0]}-01-15`,
      last_day: `${years[years.length - 1]}-01-15`,
      updated: '',
      contract: o.contract,
    },
    records,
    tariffs: new Map(),
    temps: new Map(),
    weather: o.weather ? ({} as Dataset['weather']) : null,
    indoor: new Map(),
    linky: new Map(),
    insights: null,
    estimated: new Set(),
    coverage: null,
    trve: [],
    offers: new Map(),
    pmax: new Map(),
    tempo: { rows: [], days: new Map() },
    station: null,
  } as Dataset;
}

describe('default state and what older versions saved', () => {
  it('nothing saved: the defaults, real per-room figures (household view off)', async () => {
    const { app } = await boot();
    expect(app.state).toEqual(app.DEFAULT);
    expect(app.state.groupBedrooms).toBe(false);
    expect(app.state.view).toBe('overview');
    expect(app.state.prices).toEqual({ base: null, t1: null, t2: null, sub: null });
  });

  it('v1.0 single price becomes the base price; v1.4 `household: true` is dropped', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ price: 0.21, household: true, view: 'compare' }) });
    expect(app.state.prices).toEqual({ base: 0.21, t1: null, t2: null, sub: null });
    expect(app.state.view).toBe('compare');
    expect(app.state.groupBedrooms).toBe(false);
    expect('household' in app.state).toBe(false);
    expect('price' in app.state).toBe(false);
  });

  it('partial prices are completed, new fields take their default', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ prices: { t1: 0.3 }, lockAfter: 0 }) });
    expect(app.state.prices).toEqual({ base: null, t1: 0.3, t2: null, sub: null });
    expect(app.state.lockAfter).toBe(0);
    expect(app.state.comfortThreshold).toBe(19);
    expect(app.state.roomModuleMap).toEqual({});
  });

  it('a corrupted saved state falls back to the defaults', async () => {
    const { app } = await boot({ 'intuis-history:state': '{pas du json' });
    expect(app.state).toEqual(app.DEFAULT);
  });

  it('#229: under /Netatmo/ the state moves to the scoped name and is saved there', async () => {
    const { app, storage } = await boot({ 'intuis-history:state': JSON.stringify({ view: 'rooms', simple: true }) }, '/Netatmo/');
    expect(app.state.view).toBe('rooms');
    expect(app.state.simple).toBe(true);
    expect(storage.getItem('intuis-history:state')).toBeNull();
    const render = vi.fn();
    app.setRenderer(render);
    app.setState({ view: 'analyse' });
    expect(render).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('intuis-history@Netatmo:state')!).view).toBe('analyse');
  });

  it('storage unavailable: setState still applies and re-renders', async () => {
    const { app, storage } = await boot();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const render = vi.fn();
    app.setRenderer(render);
    app.setState({ cat: 'heating' });
    expect(app.state.cat).toBe('heating');
    expect(render).toHaveBeenCalled();
  });
});

describe('state fixed against a newly opened dataset', () => {
  it('years, rooms and choices that no longer exist are reset', async () => {
    const saved = { compareYears: [2019, 2024], roomsYear: 2018, analyseYear: 2019, reportYear: 2019, period: '2019', climate: true, pinnedRoom: 'gone', focusRoom: 'g', tempRoom: 's', rooms: ['s', 'gone', 'v'] };
    const { app } = await boot({ 'intuis-history:state': JSON.stringify(saved) });
    app.setDataset(dataset());
    expect(app.state.compareYears).toEqual([2024, 2025, 2026]);
    expect(app.state.roomsYear).toBe(2026);
    expect(app.state.analyseYear).toBe(2026);
    expect(app.state.reportYear).toBe(2025); // the last complete year
    expect(app.state.period).toBe('12m');
    expect(app.state.climate).toBe(false); // no weather in this dataset
    expect(app.state.pinnedRoom).toBeNull();
    expect(app.state.focusRoom).toBeNull(); // ignored room
    expect(app.state.tempRoom).toBe('s');
    expect(app.state.rooms).toEqual(['s']); // « v » has no record, « gone » does not exist
  });

  it('active rooms: neither ignored nor without data', async () => {
    const { app } = await boot();
    app.setDataset(dataset());
    expect(app.activeRooms().map((r) => r.id)).toEqual(['s', 'c1', 'c2', 'w']);
  });

  it('valid choices are kept; a single year is both the report and analysis year', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ compareYears: [2025], period: '2025', rooms: ['c1', 'c2'] }) });
    app.setDataset(dataset({ years: [2025], weather: true }));
    expect(app.state.compareYears).toEqual([2025]);
    expect(app.state.period).toBe('2025');
    expect(app.state.reportYear).toBe(2025);
    expect(app.state.rooms).toEqual(['c1', 'c2']);
  });

  it('every filtered room gone: back to all rooms', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ rooms: ['gone'] }) });
    app.setDataset(dataset());
    expect(app.state.rooms).toBeNull();
  });

  it('S-12.1: a local edit is dropped once the shared contract caught up with it', async () => {
    const contract = [{ from: '2023-01-01', offer: 'edf-trv-hphc', kva: 9 }];
    const caughtUp = { contractLocalEdit: true, priceMode: 'trve', contracts: contract };
    let { app } = await boot({ 'intuis-history:state': JSON.stringify(caughtUp) });
    app.setDataset(dataset({ contract }));
    expect(app.state.contractLocalEdit).toBe(false);

    ({ app } = await boot({ 'intuis-history:state': JSON.stringify({ ...caughtUp, contracts: [{ ...contract[0], kva: 12 }] }) }));
    app.setDataset(dataset({ contract }));
    expect(app.state.contractLocalEdit).toBe(true); // still different from the shared one

    ({ app } = await boot({ 'intuis-history:state': JSON.stringify({ ...caughtUp, contracts: [{ ...contract[0], kva: 12 }] }) }));
    app.setDataset(dataset()); // no shared contract any more
    expect(app.state.contractLocalEdit).toBe(false);
  });
});

describe('S-12.2 household view (opt-in, display only)', () => {
  it('merges the bedrooms, translates the room choices, and gives the detail back', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ rooms: ['s', 'c1'], pinnedRoom: 'c1' }) });
    app.setRenderer(() => {});
    const raw = dataset();
    app.setDataset(raw);
    expect(app.householdStatus()).toEqual({ active: false, bedrooms: 2, revealed: false, enabled: false });
    expect(app.ds).toBe(raw);

    app.setHousehold(true);
    expect(app.state.groupBedrooms).toBe(true);
    expect(app.householdStatus().active).toBe(true);
    expect(app.activeRooms().map((r) => r.id)).toEqual(['s', '__bedrooms__', 'w']);
    expect(app.state.rooms).toEqual(['s', '__bedrooms__']);
    expect(app.state.pinnedRoom).toBe('__bedrooms__');
    expect(app.rawDataset()).toBe(raw);
    const total = (d: Dataset) => d.records.reduce((s, r) => s + r.kwh, 0);
    expect(total(app.ds!)).toBe(total(raw));

    // « Afficher le détail des chambres »: every bedroom again, until the next lock
    app.revealBedrooms(true);
    expect(app.ds).toBe(raw);
    expect(app.householdStatus()).toMatchObject({ active: false, revealed: true, enabled: true });
    expect(app.state.rooms).toEqual(['s', 'c1', 'c2']);
    expect(app.state.pinnedRoom).toBeNull(); // « Chambres » is not one room any more

    app.setDataset(null); // lock
    expect(app.ds).toBeNull();
    app.setDataset(raw);
    expect(app.householdStatus()).toMatchObject({ active: true, revealed: false });
  });

  it('turned off: the real rooms again', async () => {
    const { app } = await boot({ 'intuis-history:state': JSON.stringify({ groupBedrooms: true }) });
    app.setRenderer(() => {});
    app.setDataset(dataset());
    expect(app.householdStatus().active).toBe(true);
    app.setHousehold(false);
    expect(app.householdStatus().active).toBe(false);
    expect(app.activeRooms().map((r) => r.id)).toContain('c1');
  });
});

describe('dataset hooks (#232, #255)', () => {
  it('view hooks on every change, open hooks once per decrypted dataset, lock hooks on lock', async () => {
    const { app } = await boot();
    app.setRenderer(() => {});
    const seen: string[] = [];
    app.onDatasetLoaded(() => seen.push('view'));
    app.onDatasetOpened(() => seen.push('open'));
    app.onLock(() => seen.push('lock'));
    const d = dataset();
    app.setDataset(d);
    expect(seen).toEqual(['view', 'open']);
    seen.length = 0;
    app.setHousehold(true); // display only: nothing is opened again
    app.revealBedrooms(true);
    app.setDataset(d); // same dataset installed again
    expect(seen).toEqual(['view', 'view', 'view']);
    seen.length = 0;
    app.setDataset(null);
    expect(seen).toEqual(['view', 'lock']);
  });

  it('datasetDoc: one load per dataset shown, forgotten when it changes', async () => {
    const { app } = await boot();
    app.setRenderer(() => {});
    const load = vi.fn(async (d: Dataset) => d.meta.years.length);
    const doc = app.datasetDoc(load);
    const a = dataset();
    app.setDataset(a);
    doc.get(app.ds);
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.get(app.ds)).toBe(4);
    expect(load).toHaveBeenCalledTimes(1);
    app.setDataset(dataset({ years: [2026] }));
    expect(doc.status(app.ds)).toBe('idle');
    doc.get(app.ds);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
