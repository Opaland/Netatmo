// #337: « Expliquer un mois ». The parts add up to the change; each is checked on a small case,
// then January 2026 of the demo (the owner's question): colder, the living room asked 1 °C
// more, the kitchen offline since October 2025 running on its last setting.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { demoDataset } from './__fixtures__/demo';
import { type ExplainInput, explainMonth, explainSentence, explainableMonths, kwhSigned, stepNote } from './explain';
import { estimateOffline, offlineRuns } from './room-offline';

const ROOMS = [
  { id: 'a', name: 'Salon', category: 'heating' },
  { id: 'b', name: 'Cuisine', category: 'heating' },
  { id: 'ce', name: 'Chauffe-eau', category: 'water_heater' },
];
const month = (ym: string) => {
  const out: string[] = [];
  for (let d = `${ym}-01`; d.startsWith(ym); d = addDays(d, 1)) out.push(d);
  return out;
};
const rec = (day: string, room: string, kwh: number): DayRecord => ({ day, room, kwh, cat: room === 'ce' ? 'water_heater' : 'heating' });

/** Two Januaries: `cold` °C colder in 2026, `sp` °C more asked in the living room, other usages +`other`/day. */
function input(o: { cold?: number; sp?: number; other?: number; offline?: boolean; linky?: boolean } = {}): ExplainInput {
  const weather: Weather = new Map();
  const records: DayRecord[] = [];
  const linky = new Map<string, number>();
  const temps = new Map<string, Map<string, [number, number | null]>>([['a', new Map()], ['b', new Map()]]);
  for (const ym of ['2025-01', '2026-01']) {
    const now = ym === '2026-01';
    for (const d of month(ym)) {
      const t = 5 - (now ? (o.cold ?? 0) : 0);
      weather.set(d, [t - 3, t + 3, t]);
      const dju = 18 - t;
      const sp = now ? (o.sp ?? 0) : 0;
      const a = 0.5 * dju * (1 + 0.07 * sp);
      const b = 0.25 * dju;
      records.push(rec(d, 'a', a), rec(d, 'ce', 3));
      temps.get('a')!.set(d, [19 + sp, 19 + sp]);
      temps.get('b')!.set(d, [19, 19]);
      const off = o.offline && now;
      if (!off) records.push(rec(d, 'b', b));
      linky.set(d, a + b * (off ? 1.5 : 1) + 3 + 4 + (now ? (o.other ?? 0) : 0));
    }
  }
  // a reference year for the estimate: December 2025, everything read
  for (const d of month('2025-12')) {
    weather.set(d, [2, 8, 5]);
    records.push(rec(d, 'a', 6.5), rec(d, 'b', 3.25), rec(d, 'ce', 3));
    linky.set(d, 6.5 + 3.25 + 3 + 4);
  }
  // other usages vary a little with the cold (not used: constant 4 here)
  const runs = offlineRuns(records, ROOMS, '2026-01-31');
  const estimate = estimateOffline(records, runs, o.linky === false ? new Map() : linky, weather);
  return { month: '2026-01', last: '2026-01-31', records, rooms: ROOMS, weather, linky: o.linky === false ? new Map() : linky, temps, runs, estimate };
}
const step = (e: ReturnType<typeof explainMonth>, k: string) => e!.steps.find((s) => s.key === k)?.kwh ?? 0;
const sumSteps = (e: ReturnType<typeof explainMonth>) => e!.steps.reduce((s, x) => s + x.kwh, 0);

describe('explain a month', () => {
  it('the same month: nothing to explain', () => {
    const e = explainMonth(input())!;
    expect(e.delta).toBeCloseTo(0, 6);
    expect(e.basis).toBe('linky');
    expect(explainSentence(e)).toBe('En janvier 2026, le logement a consommé à peu près autant qu’en janvier 2025 (0 %).');
  });

  it('colder: all of the heating change goes to the weather', () => {
    const e = explainMonth(input({ cold: 2 }))!;
    expect(step(e, 'meteo')).toBeCloseTo(e.delta, 6);
    expect(step(e, 'pieces')).toBeCloseTo(0, 6);
    expect(e.weather!.now).toBeGreaterThan(e.weather!.ref);
    expect(stepNote(e, e.steps[0])).toMatch(/^plus froid : 465 degrés-jours contre 403$/);
  });

  it('1 °C more asked: ≈ 7 % of that room, in « températures demandées »', () => {
    const e = explainMonth(input({ sp: 1 }))!;
    expect(step(e, 'consignes')).toBeCloseTo(e.delta, 6);
    expect(e.setpoint!.now - e.setpoint!.ref).toBeCloseTo(2 / 3, 6); // weighted by consumption, a: 2/3
    expect(sumSteps(e)).toBeCloseTo(e.delta, 6);
  });

  it('other usages: the meter minus heating and hot water', () => {
    const e = explainMonth(input({ other: 2 }))!;
    expect(step(e, 'autres')).toBeCloseTo(62, 6);
    expect(e.other!.now - e.other!.ref).toBeCloseTo(62, 6);
  });

  it('a room offline: estimated from the meter, never « an economy »', () => {
    const e = explainMonth(input({ offline: true }))!;
    expect(e.offline.map((o) => o.name)).toEqual(['Cuisine']);
    // it ran 1.5 × its usual consumption: + 0.5 × 0.25 × 13 DJU × 31 days
    expect(step(e, 'horsligne')).toBeCloseTo(0.5 * 0.25 * 13 * 31, 6);
    expect(e.steps.find((s) => s.key === 'horsligne')!.estimated).toBe(true);
    expect(step(e, 'pieces')).toBeCloseTo(0, 6);
    expect(sumSteps(e)).toBeCloseTo(e.delta, 6);
    expect(explainSentence(e)).toMatch(/Surtout Cuisine hors ligne \(\+50 kWh, estimé\)\.$/);
  });

  it('without Linky: radiators and water heater only, the offline room « plus mesurée »', () => {
    const e = explainMonth(input({ offline: true, linky: false }))!;
    expect(e.basis).toBe('intuis');
    expect(e.other).toBeNull();
    const off = e.steps.find((s) => s.key === 'horsligne')!;
    expect(off.kwh).toBeCloseTo(-0.25 * 13 * 31, 6);
    expect(off.estimated).toBe(false);
    expect(stepNote(e, off)).toBe('plus mesurée, sans compteur Linky pour l’estimer');
    expect(sumSteps(e)).toBeCloseTo(e.delta, 6);
  });

  it('a running month is compared on the same days; no reference, no explanation', () => {
    const i = input({ cold: 1 });
    const e = explainMonth({ ...i, last: '2026-01-10' })!;
    expect([e.from, e.to, e.refFrom, e.refTo, e.partial]).toEqual(['2026-01-01', '2026-01-10', '2025-01-01', '2025-01-10', true]);
    expect(explainSentence(e)).toMatch(/^En janvier 2026 \(du 1er au 10\), le logement a consommé \d+ kWh de plus qu’en janvier 2025/);
    expect(explainMonth({ ...i, month: '2025-01' })).toBeNull();
    expect(explainableMonths(i.records, '2026-01-31')).toEqual(['2026-01']);
  });

  it('kWh with their sign', () => {
    expect([kwhSigned(12.4), kwhSigned(-1234.6), kwhSigned(0.2)]).toEqual(['+12 kWh', '−1\u202f235 kWh', '0 kWh']);
  });
});

describe('on the demo: January 2026, the owner’s question', () => {
  it('more than January 2025: colder, warmer living room, the kitchen offline; the parts add up', async () => {
    const ds = await demoDataset();
    const last = ds.meta.last_day!;
    const runs = offlineRuns(ds.records, ds.meta.rooms, last);
    const estimate = estimateOffline(ds.records, runs, ds.linky, ds.weather);
    const e = explainMonth({ month: '2026-01', last, records: ds.records, rooms: ds.meta.rooms, weather: ds.weather, linky: ds.linky, temps: ds.temps, runs, estimate })!;
    expect(e.basis).toBe('linky');
    expect(Math.round(e.delta)).toBe(112);
    expect(sumSteps(e)).toBeCloseTo(e.delta, 6);
    expect(step(e, 'meteo')).toBeGreaterThan(50);
    expect(step(e, 'consignes')).toBeGreaterThan(10);
    expect(step(e, 'horsligne')).toBeGreaterThan(20);
    expect(e.offline).toMatchObject([{ id: 'r-cuisine', since: '2025-10-14', ongoing: true }]);
    expect(e.rooms.find((r) => r.id === 'r-salon')!.setpoint).toBeGreaterThan(10);
    const s = explainSentence(e, 0.2);
    expect(s).toMatch(/^En janvier 2026, le logement a consommé 112 kWh de plus qu’en janvier 2025 \(\+6 %, ≈ 22 €\)\. Surtout un mois plus froid \(\+77 kWh\), Cuisine hors ligne \(\+70 kWh, estimé\) et des températures demandées plus hautes \(\+27 kWh\) ; en partie compensé par les autres usages \(−66 kWh\)\.$/);
    expect(s).toMatch(/un mois plus froid/);
  });
});
