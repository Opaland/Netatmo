// #253: ui.ts helpers seen by the user: contract in force (S-12.1, memoised), price mode, cost
// of a period with the prorated subscription, room colours and « Autres pièces », formatting.
// The price-per-kWh rules and the cost cache are in ui-prices.test.ts; app, charts and the
// tenant setting are stubbed here the same way.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayRecord, Room } from './aggregate';
import { NO_PRICES, type Prices } from './analysis';

const h = vi.hoisted(() => ({
  ds: null as unknown,
  state: null as unknown,
  rooms: [] as Room[],
  tenant: { on: false, leaseFrom: null, leaseTo: null },
}));

vi.mock('./app', () => ({
  get ds() {
    return h.ds;
  },
  get state() {
    return h.state;
  },
  activeRooms: () => h.rooms,
  rawRooms: () => h.rooms,
  onLock: () => {},
}));
// a CSS token is returned by name: the colour assertions read which token was chosen
vi.mock('./charts', () => ({ cssVar: (n: string) => n, escapeHtml: (s: string) => s, waterfallChart: () => {}, fmtKwh: String }));
vi.mock('./tenant', () => ({ tenant: () => h.tenant }));

const ui = await import('./ui');

const room = (id: string, category: Room['category'] = 'heating'): Room => ({ id, name: `Pièce ${id}`, category, module_types: [] });
const row = { from: '2020-01-01', to: null, kva: 9, fixedYear: 365, hc: 0.2, hp: 0.3 };
const records = (n: number, kwh = 10): DayRecord[] =>
  Array.from({ length: n }, (_, i) => ({ day: `2025-01-${String(i + 1).padStart(2, '0')}`, room: 'r1', cat: 'heating', kwh })) as DayRecord[];

function setup(o: { contract?: unknown; state?: Record<string, unknown>; years?: number[]; tariffs?: Map<string, Map<string, [number, number, number]>> } = {}) {
  h.ds = {
    meta: { contract: o.contract, first_day: '2024-01-01', last_day: '2025-01-10', rooms: h.rooms, years: o.years ?? [2023, 2024, 2025] },
    records: records(10),
    tariffs: o.tariffs ?? new Map(),
    offers: new Map([['edf-trv-hphc', [row]]]),
  };
  h.state = { priceMode: 'trve', prices: NO_PRICES, contracts: [], contractLocalEdit: false, kva: 6, ...o.state };
  h.tenant = { on: false, leaseFrom: null, leaseTo: null };
}

beforeEach(() => {
  h.rooms = [room('r1')];
});

describe('S-12.1 contract in force on this device', () => {
  const shared = [{ from: '2024-01-01', offer: 'edf-trv-hphc', kva: 9 }];
  const local = [{ from: '2024-01-01', offer: 'edf-trv-base', kva: 6 }];

  it('no contract anywhere: EDF HP/HC at the subscribed power, from the first day of data', () => {
    setup();
    expect(ui.contractInfo()).toMatchObject({ source: 'default', shared: false });
    expect(ui.contracts()).toEqual([{ from: '2024-01-01', offer: 'edf-trv-hphc', kva: 6 }]);
  });

  it('the shared contract wins over the one saved here, unless edited here on purpose', () => {
    setup({ contract: shared, state: { contracts: local } });
    expect(ui.contractInfo()).toMatchObject({ source: 'shared', differs: true });
    expect(ui.contracts()).toEqual(shared);
    setup({ contract: shared, state: { contracts: local, contractLocalEdit: true } });
    expect(ui.contractInfo()).toMatchObject({ source: 'local', differs: true, shared: true });
    expect(ui.contracts()).toEqual(local);
  });

  it('memoised: the same object until an input changes', () => {
    setup({ state: { contracts: local } });
    const first = ui.contractInfo();
    expect(ui.contractInfo()).toBe(first);
    (h.state as { contracts: unknown }).contracts = [...local, { from: '2025-01-01', offer: 'edf-trv-hphc', kva: 9 }];
    const next = ui.contractInfo();
    expect(next).not.toBe(first);
    expect(next.periods).toHaveLength(2);
  });

  it('price mode: the device choice, the official tariffs under a shared contract, manual for a tenant', () => {
    setup({ state: { priceMode: 'manual' } });
    expect(ui.priceMode()).toBe('manual');
    setup({ contract: shared, state: { priceMode: 'manual' } });
    expect(ui.priceMode()).toBe('trve');
    h.tenant = { on: true, leaseFrom: null, leaseTo: null };
    expect(ui.priceMode()).toBe('manual');
  });

  it('priceAt: the regulated row of the contract in force that day (the first one before it)', () => {
    setup({ contract: shared });
    expect(ui.priceAt('2025-01-05')).toBe(row);
    expect(ui.priceAt('2023-06-01')).toBe(row);
    (h.ds as { offers: Map<string, unknown> }).offers = new Map();
    expect(ui.priceAt('2025-01-05')).toBeNull(); // offer prices not loaded
  });
});

describe('cost of a period', () => {
  it('manual base price, subscription prorated over the days of the period', () => {
    const prices: Prices = { ...NO_PRICES, base: 0.25, sub: 12 };
    setup({ state: { priceMode: 'manual', prices } });
    expect(ui.costAvailable()).toBe(true);
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10')).toBeCloseTo(25, 10);
    // 10 days of a 12 €/month subscription: 12 × 12 × 10 / 365.25
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10', true)).toBeCloseTo(25 + (144 * 10) / 365.25, 10);
    // only the records inside the range are costed
    expect(ui.costOf(records(10), '2025-01-06', '2025-01-10')).toBeCloseTo(12.5, 10);
  });

  it('regulated tariff: HP/HC split of the day, subscription of the offer', () => {
    // half of the kWh in each column, column 2 is off-peak (default)
    const tariffs = new Map([['r1', new Map(records(10).map((r) => [r.day, [0, 5, 5] as [number, number, number]]))]]);
    setup({ contract: [{ from: '2024-01-01', offer: 'edf-trv-hphc', kva: 9 }], tariffs });
    const energy = 10 * (5 * 0.3 + 5 * 0.2);
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10')).toBeCloseTo(energy, 6);
    // fixedYear 365 € in 2025: 1 € a day
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10', true)).toBeCloseTo(energy + 10, 6);
  });

  it('no price at all: no cost, nothing shown', () => {
    setup({ state: { priceMode: 'manual' } });
    expect(ui.costAvailable()).toBe(false);
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10')).toBeNull();
    expect(ui.eurOf(records(10), '2025-01-01', '2025-01-10')).toBe('');
    expect(ui.avgPrice()).toBeNull();
  });

  it('tenant: the average price applies to every kWh, HP/HC prices ignored', () => {
    setup({ state: { priceMode: 'manual', prices: { ...NO_PRICES, base: 0.2, t1: 0.5, t2: 0.1 } } });
    h.tenant = { on: true, leaseFrom: null, leaseTo: null };
    const tariffs = new Map([['r1', new Map(records(10).map((r) => [r.day, [0, 5, 5] as [number, number, number]]))]]);
    (h.ds as { tariffs: unknown }).tariffs = tariffs;
    expect(ui.costOf(records(10), '2025-01-01', '2025-01-10')).toBeCloseTo(20, 10);
  });
});

describe('tariff names', () => {
  it('follow the off-peak column detected from the water heater', () => {
    h.rooms = [room('r1'), room('w', 'water_heater')];
    setup({ tariffs: new Map([['w', new Map([['2025-01-01', [0, 0, 4] as [number, number, number]]])]]) });
    expect(ui.tariffNames()).toEqual(['Heures pleines', 'Heures creuses']);
    expect(ui.offCol()).toBe(2);
    setup({ tariffs: new Map([['w', new Map([['2025-01-01', [0, 4, 0] as [number, number, number]]])]]) });
    expect(ui.tariffNames()).toEqual(['Heures creuses', 'Heures pleines']);
    expect(ui.offCol()).toBe(1);
    setup();
    expect(ui.tariffNames()).toEqual(['Tarif 1', 'Tarif 2']);
    expect(ui.offCol()).toBe(2);
  });
});

describe('room colours: they follow the room, never its rank', () => {
  it('water heater in its usage colour, rooms on the room palette, past six shown in « Autres pièces »', () => {
    h.rooms = [room('w', 'water_heater'), ...Array.from({ length: 8 }, (_, i) => room(`h${i}`))];
    setup();
    expect(ui.roomColor('w')).toBe('--usage-water');
    expect(ui.roomColor('h0')).toBe('--room-1');
    expect(ui.roomColor('h5')).toBe('--room-6');
    expect(ui.roomColor('h6')).toBe('--room-7');
    expect(ui.roomColor(ui.OTHER)).toBe('--usage-standby');
    expect(ui.roomGroup('w')).toBe('w');
    expect(ui.roomGroup('h5')).toBe('h5');
    expect(ui.roomGroup('h6')).toBe(ui.OTHER);
    expect(ui.roomGroup('h7')).toBe(ui.OTHER);
    expect(ui.roomName(ui.OTHER)).toBe('Autres pièces');
  });

  it('a room keeps its colour when the other rooms are filtered out', () => {
    h.rooms = [room('a'), room('b'), room('c')];
    setup({ state: { rooms: ['c'] } });
    expect(ui.roomColor('c')).toBe('--room-3');
  });

  it('#300: the latest year takes year-0, older ones the lighter steps of the ramp', () => {
    setup({ years: [2020, 2021, 2022, 2023, 2024, 2025] });
    expect(ui.yearColor(2025)).toBe('--year-0');
    expect(ui.yearColor(2023)).toBe('--year-2');
    expect(ui.yearColor(2020)).toBe('--year-3');
  });
});

describe('formatting', () => {
  it('signed percentage without « -0 », euros, long date', () => {
    expect(ui.pct(12.4)).toBe('+12 %');
    expect(ui.pct(-0.4)).toBe('0 %');
    expect(ui.pct(-7.6)).toBe('−8 %');
    expect(ui.fmtEur(1234.4).replace(/\s/g, ' ')).toBe('1 234 €');
    expect(ui.longDate('2025-03-07')).toBe('7 mars 2025');
  });

  it('change versus last year, with a word when there is no reference', () => {
    expect(ui.delta(110, 100)).toContain('class="delta up"');
    expect(ui.delta(90, 100)).toContain('class="delta down"');
    expect(ui.delta(100, 100)).toContain('class="delta neutral"');
    expect(ui.delta(100, 0)).toContain("pas de comparaison avec l'an dernier");
    // #310: the reference is always written out
    expect(ui.delta(90, 100, 'vs nov. 2025 au 8')).toContain('<b>−10 %</b> <span class="vs">vs nov. 2025 au 8</span>');
    expect(ui.delta(90, 100)).not.toContain('N-1');
  });
});
