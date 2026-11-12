// #453: the water heater's options, on fictitious days and prices only (never a real reading).
import { describe, expect, it } from 'vitest';
import { HW_FIELDS, type HotWaterDay, type HotWaterInputs, parseHotWaterInputs, simulateHotWater, zeroAssumption } from './hotwater';

const NONE: HotWaterInputs = parseHotWaterInputs(null);
const DAYS: HotWaterDay[] = [
  { day: '2025-03-01', kwh: 10, off: 8 },
  { day: '2025-03-02', kwh: 10, off: 8 },
];
const PRICE = () => ({ hc: 0.2, hp: 0.3 });
const EIGHT_HOURS = () => 8;
const row = (sim: ReturnType<typeof simulateHotWater>, key: string) => sim!.rows.find((r) => r.key === key)!;

describe('simulateHotWater', () => {
  it('prices today at the column of each kWh and scales the window to a year', () => {
    const sim = simulateHotWater(DAYS, NONE, PRICE, EIGHT_HOURS)!;
    const now = row(sim, 'now');
    expect(sim.days).toBe(2);
    expect(sim.zeroDays).toBe(0);
    expect(sim.share).toBeCloseTo(0.8);
    expect(now.year!.kwh).toBeCloseTo(3650); // 10 kWh × 365
    expect(now.year!.eur).toBeCloseTo(2.2 * 365); // 8 × 0,2 + 2 × 0,3 a day
  });

  it('#502: the days read at 0 kWh are left out, counted, and the year is the others scaled to 365', () => {
    // 335 days at 10 kWh, 30 at 0 (an absence): the simulation says 3 650 kWh a year, not 3 350
    const year = Array.from({ length: 365 }, (_, n) => ({ day: `d${String(n).padStart(3, '0')}`, kwh: n < 30 ? 0 : 10, off: n < 30 ? 0 : 8 }));
    const sim = simulateHotWater(year, NONE, PRICE, EIGHT_HOURS)!;
    expect(sim.days).toBe(335);
    expect(sim.zeroDays).toBe(30);
    expect(row(sim, 'now').year!.kwh).toBeCloseTo(3650); // each day at 0 counted as an average day (the rule said on screen)
    const said = zeroAssumption(sim);
    expect(said).toContain('30 jours à 0\u00a0kWh relevés');
    expect(said).toContain('sont écartés : l’année est ramenée à 365 jours à partir des 335 jours avec de l’énergie');
    expect(zeroAssumption({ days: 300, zeroDays: 1 })).toMatch(/^1 jour à 0\u00a0kWh relevé dans la période .* est écarté .* comme si c’était un jour moyen/);
  });

  it('a heat-pump water heater: energy ÷ COP, same off-peak share, payback on what it costs more than a new tank', () => {
    const sim = simulateHotWater(DAYS, { ...NONE, cop: 2.5, cost: 3000, replacement: 1000 }, PRICE, EIGHT_HOURS)!;
    const t = row(sim, 'thermo');
    expect(t.year!.kwh).toBeCloseTo(1460); // 4 kWh a day
    expect(t.year!.off).toBeCloseTo(1168); // 80 %
    expect(t.savedKwh).toBeCloseTo(2190);
    expect(t.savedEur).toBeCloseTo((2.2 - 0.88) * 365);
    expect(t.payback).toBeCloseTo(2000 / ((2.2 - 0.88) * 365));
    expect(t.overflowDays).toBe(0);
  });

  it('caps the off-peak heating at power × off-peak hours of that day (#441: the ranges in force)', () => {
    // 3,2 kWh wanted off-peak at 0,5 kW: 6 h hold 3 kWh on the 1st, 8 h hold everything on the 2nd
    const hours = (day: string) => (day === '2025-03-01' ? 6 : 8);
    const t = row(simulateHotWater(DAYS, { ...NONE, cop: 2.5, thermoKw: 0.5 }, PRICE, hours), 'thermo');
    expect(t.overflowDays).toBe(1);
    expect(t.year!.off).toBeCloseTo((3 + 3.2) * 182.5);
    expect(t.year!.eur).toBeCloseTo((3 * 0.2 + 1 * 0.3 + 0.88) * 182.5);
  });

  it('a lower setpoint scales the energy by the gap to the cold water', () => {
    const sp = row(simulateHotWater(DAYS, { ...NONE, setpoint: 60, newSetpoint: 50, coldWater: 10 }, PRICE, EIGHT_HOURS), 'setpoint');
    expect(sp.year!.kwh).toBeCloseTo(8 * 365); // (50 − 10) / (60 − 10) = 0,8
    expect(sp.savedKwh).toBeCloseTo(2 * 365);
    expect(sp.savedEur).toBeCloseTo(2.2 * 0.2 * 365);
  });

  it('refuses a setpoint that would rise, or fall under the cold water, and says what is missing', () => {
    expect(row(simulateHotWater(DAYS, { ...NONE, setpoint: 55, newSetpoint: 60, coldWater: 10 }, PRICE, EIGHT_HOURS), 'setpoint').year).toBeNull();
    expect(row(simulateHotWater(DAYS, { ...NONE, setpoint: 55, newSetpoint: 8, coldWater: 10 }, PRICE, EIGHT_HOURS), 'setpoint').year).toBeNull();
    const m = row(simulateHotWater(DAYS, { ...NONE, setpoint: 55 }, PRICE, EIGHT_HOURS), 'setpoint');
    expect(m.missing).toEqual(['consigne envisagée', 'température de l’eau froide']);
    expect(row(simulateHotWater(DAYS, NONE, PRICE, EIGHT_HOURS), 'thermo').missing).toEqual(['COP moyen du chauffe-eau thermodynamique']);
  });

  it('everything off-peak: the peak-hour kWh priced off-peak, within the heater power × off-peak hours', () => {
    const free = row(simulateHotWater(DAYS, NONE, PRICE, EIGHT_HOURS), 'offpeak');
    expect(free.savedEur).toBeCloseTo(2 * 0.1 * 365);
    expect(free.savedKwh).toBe(0);
    // 1 kW × 8 h = 8 kWh: nothing moves, both days overflow
    const capped = row(simulateHotWater(DAYS, { ...NONE, heaterKw: 1 }, PRICE, EIGHT_HOURS), 'offpeak');
    expect(capped.savedEur).toBeCloseTo(0);
    expect(capped.overflowDays).toBe(2);
  });

  it('a day without split takes the share of the window; a day without price leaves the € unknown', () => {
    const days: HotWaterDay[] = [...DAYS, { day: '2025-03-03', kwh: 5, off: null }];
    const sim = simulateHotWater(days, { ...NONE, cop: 2 }, PRICE, EIGHT_HOURS)!;
    expect(sim.splitDays).toBe(2);
    expect(row(sim, 'now').year!.off).toBeCloseTo((8 + 8 + 4) * (365 / 3));
    const noPrice = simulateHotWater(days, { ...NONE, cop: 2 }, (d) => (d === '2025-03-03' ? null : PRICE()), EIGHT_HOURS)!;
    expect(row(noPrice, 'now').year!.eur).toBeNull();
    expect(row(noPrice, 'thermo').savedEur).toBeNull();
    expect(row(noPrice, 'thermo').savedKwh).toBeCloseTo(25 / 2 * (365 / 3));
  });

  it('no split at all: no € and no off-peak option', () => {
    const sim = simulateHotWater([{ day: '2025-03-01', kwh: 4, off: null }], { ...NONE, cop: 2 }, PRICE, EIGHT_HOURS)!;
    expect(sim.share).toBeNull();
    expect(row(sim, 'now').year!.eur).toBeNull();
    expect(row(sim, 'offpeak').year).toBeNull();
    expect(row(sim, 'thermo').savedKwh).toBeCloseTo(2 * 365);
  });

  it('a heat pump no dearer than a new tank pays back at once; no energy, no simulation', () => {
    const t = row(simulateHotWater(DAYS, { ...NONE, cop: 3, cost: 1500, replacement: 1500 }, PRICE, EIGHT_HOURS), 'thermo');
    expect(t.payback).toBe(0);
    expect(simulateHotWater([{ day: '2025-03-01', kwh: 0, off: 0 }], NONE, PRICE, EIGHT_HOURS)).toBeNull();
  });
});

describe('parseHotWaterInputs', () => {
  it('keeps each field in its bounds, drops the rest', () => {
    expect(parseHotWaterInputs({ cop: 3.2, setpoint: 200, coldWater: '12', cost: -1, extra: 1 })).toEqual({ ...NONE, cop: 3.2 });
    expect(Object.keys(parseHotWaterInputs([1, 2]))).toEqual(HW_FIELDS.map(([k]) => k));
  });
});
