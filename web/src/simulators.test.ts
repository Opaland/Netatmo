// S-2.14 (EV charging), S-2.15 (heat pump), S-12.5 (prolonged cold), S-12.6 (tenant).
import { describe, expect, it } from 'vitest';
import type { DaySplit, Fit, Weather } from './analysis';
import { coldJson, coldPseudonym, coldStatus, parseColdConfig } from './cold';
import { type Curve, SLOTS } from './curve';
import { addCharge, chargePeaks, evPlan, kmPerYear, kwhPerWeek } from './ev';
import { COP_CURVE, copAt, simulateHeatPump } from './heatpump';
import { leaseWindow, parseTenant } from './tenant';

const TZ = 'Europe/Paris';

describe('EV charging plan', () => {
  it('charges at constant power from the start hour, past midnight when needed', () => {
    // 70 kWh a week = 10 kWh a day; at 4 kW from 23 h: 2 kWh per half hour, 2 h 30
    const p = evPlan({ kwhWeek: 70, powerKw: 4, startHour: 23 })!;
    expect(p.kwhDay).toBeCloseTo(10);
    expect(p.hours).toBeCloseTo(2.5);
    expect(p.same[46]).toBeCloseTo(4000); // 23:00
    expect(p.same[47]).toBeCloseTo(4000); // 23:30
    expect(p.next[0]).toBeCloseTo(4000); // 00:00 next day
    expect(p.next[2]).toBeCloseTo(4000); // 01:00, last full half hour
    expect(p.next[3]).toBe(0);
    expect(p.hc).toBeCloseTo(10); // all within 22 h → 6 h
    expect(p.hp).toBe(0);
  });

  it('counts peak-hour charging and partial half hours', () => {
    // 21 kWh/week = 3 kWh/day at 7 kW from 18 h: less than the 3.5 kWh of a full half hour
    const p = evPlan({ kwhWeek: 21, powerKw: 7, startHour: 18 })!;
    expect(p.same[36]).toBeCloseTo(6000); // 3 kWh in 30 min = 6 kW average
    expect(p.hp).toBeCloseTo(3);
    expect(p.hc).toBe(0);
  });

  it('refuses impossible inputs', () => {
    expect(evPlan({ kwhWeek: 0, powerKw: 7, startHour: 22 })).toBeNull();
    expect(evPlan({ kwhWeek: 70, powerKw: 0, startHour: 22 })).toBeNull();
    // 1000 kWh a day cannot be charged at 2 kW within two days
    expect(evPlan({ kwhWeek: 7000, powerKw: 2, startHour: 22 })).toBeNull();
  });

  it('adds the daily charge to every day', () => {
    const splits: DaySplit[] = [
      { day: '2025-01-01', hc: 5, hp: 10 },
      { day: '2025-01-02', hc: 4, hp: 8 },
    ];
    const p = evPlan({ kwhWeek: 70, powerKw: 4, startHour: 23 })!;
    expect(addCharge(splits, p)).toEqual([
      { day: '2025-01-01', hc: 15, hp: 10 },
      { day: '2025-01-02', hc: 14, hp: 8 },
    ]);
  });

  it('converts distance to energy and back', () => {
    const w = kwhPerWeek(12000, 17);
    expect(w).toBeCloseTo((12000 * 0.17) / 0.9 / 52);
    expect(kmPerYear(w, 17)).toBeCloseTo(12000);
  });

  it('counts the half hours above the subscribed power once the charge is added', () => {
    // two plain days at 1 kW, 3 kW at 23:00 on the first day
    const c: Curve = new Map();
    for (const d of ['2025-01-14', '2025-01-15']) for (const s of SLOTS) c.set(`${d}T${s}`, 500);
    c.set('2025-01-14T23:00', 1500);
    const p = evPlan({ kwhWeek: 70, powerKw: 4, startHour: 23 })!; // 4 kW from 23:00 to 01:30
    const r = chargePeaks(c, TZ, '2025-01-14', '2025-01-15', p, () => 6);
    // > 6 kW: only 23:00 on the 14th (3 + 4 = 7 kW); elsewhere 1 + 4 = 5 kW
    expect(r.slots).toBe(1);
    expect(r.days).toBe(1);
    expect(r.slotsBefore).toBe(0);
    expect(r.maxW).toBeCloseTo(7000);
    expect(r.maxKey).toBe('2025-01-14T23:00');
    expect(r.covered).toBe(96);
    const r3 = chargePeaks(c, TZ, '2025-01-14', '2025-01-15', p, () => 3);
    // 3 kVA: every charging half hour, 2 before and 3 after midnight on each day (3 kW alone is not above)
    expect(r3.slotsBefore).toBe(0);
    expect(r3.slots).toBe(2 + 3 + 2 + 3);
  });
});

describe('heat pump estimate', () => {
  const fit: Fit = { slope: -2, intercept: 30, r2: 0.9, balance: 15, n: 100 };
  const weather: Weather = new Map([
    ['2025-01-01', [0, 10, 5]],
    ['2025-01-02', [-2, 2, 0]],
    ['2025-01-03', [14, 20, 17]], // above the balance: no heating
  ]);

  it('interpolates the COP curve and stays flat beyond its ends', () => {
    expect(copAt(-30)).toBe(COP_CURVE[0][1]);
    expect(copAt(30)).toBe(COP_CURVE[COP_CURVE.length - 1][1]);
    expect(copAt(7)).toBeCloseTo(3.8);
    expect(copAt(4.5)).toBeCloseTo(3.4);
  });

  it('divides the heat need by the seasonal COP range', () => {
    // heat = 2 × (15 − 5) + 2 × (15 − 0) = 50 kWh
    const s = simulateHeatPump(weather, '2025-01-01', '2025-01-03', fit, { kind: 'scop', low: 3, high: 4 })!;
    expect(s.days).toBe(3);
    expect(s.heatKwh).toBeCloseTo(50);
    expect(s.highKwh).toBeCloseTo(50 / 3);
    expect(s.lowKwh).toBeCloseTo(12.5);
    expect(s.savedLow).toBeCloseTo(50 - 50 / 3);
    expect(s.savedHigh).toBeCloseTo(37.5);
  });

  it('keeps the rest of the heating direct electric when the heat pump covers part of it', () => {
    const s = simulateHeatPump(weather, '2025-01-01', '2025-01-03', fit, { kind: 'scop', low: 4, high: 4 }, 0.5)!;
    expect(s.lowKwh).toBeCloseTo(25 / 4 + 25);
    expect(s.savedHigh).toBeCloseTo(50 - 25 / 4 - 25);
  });

  it('uses the COP of each day with the curve, and a 15 % worse case', () => {
    const s = simulateHeatPump(weather, '2025-01-01', '2025-01-03', fit, { kind: 'curve' })!;
    const best = 20 / copAt(5) + 30 / copAt(0);
    expect(s.lowKwh).toBeCloseTo(best);
    expect(s.highKwh).toBeCloseTo(20 / (copAt(5) * 0.85) + 30 / (copAt(0) * 0.85));
    expect(s.copHigh).toBeCloseTo(50 / best);
  });

  it('needs a heating signature', () => {
    expect(simulateHeatPump(weather, '2025-01-01', '2025-01-03', { ...fit, slope: 1, balance: null }, { kind: 'scop', low: 3, high: 4 })).toBeNull();
  });
});

describe('prolonged cold', () => {
  it('validates the repository variable, disabled by default', () => {
    expect(parseColdConfig(null)).toBeNull();
    expect(parseColdConfig({ threshold: 14, rooms: [] })).toBeNull();
    expect(parseColdConfig({ threshold: 40, rooms: ['a'] })).toBeNull();
    expect(parseColdConfig({ threshold: 14, days: 0, rooms: ['a'] })).toBeNull();
    const c = parseColdConfig({ threshold: 14, rooms: ['a', 'b', 'a', 3] })!;
    expect(c).toEqual({ threshold: 14, days: 1, rooms: ['a', 'b'] });
    expect(JSON.parse(coldJson(c))).toEqual(c);
    expect(coldPseudonym(0)).toBe('Pièce A');
    expect(coldPseudonym(2)).toBe('Pièce C');
  });

  it('counts the last consecutive days below the threshold', () => {
    const m = new Map([
      ['2025-01-01', 13],
      ['2025-01-02', 15],
      ['2025-01-03', 12],
      ['2025-01-04', 11],
    ]);
    expect(coldStatus(m, 14, 1, '2025-01-04')).toEqual({ status: 'cold', lastDay: '2025-01-04', streak: 2, lastMean: 11 });
    expect(coldStatus(m, 14, 3, '2025-01-04').status).toBe('ok');
    expect(coldStatus(m, 10, 1, '2025-01-04').status).toBe('ok');
  });

  it('breaks the streak on a missing day, and reports old readings as stale', () => {
    const m = new Map([
      ['2025-01-01', 10],
      ['2025-01-03', 10],
    ]);
    expect(coldStatus(m, 14, 2, '2025-01-03').streak).toBe(1);
    expect(coldStatus(m, 14, 1, '2025-01-09').status).toBe('stale');
    expect(coldStatus(new Map(), 14, 1, '2025-01-09').status).toBe('stale');
  });
});

describe('tenant mode', () => {
  it('validates the stored settings', () => {
    expect(parseTenant(null)).toEqual({ on: false, leaseFrom: null, leaseTo: null });
    expect(parseTenant({ on: true, leaseFrom: '2024-09-01', leaseTo: '2024-01-01' })).toEqual({ on: true, leaseFrom: '2024-09-01', leaseTo: null });
    expect(parseTenant({ on: 'yes', leaseFrom: 'hier' })).toEqual({ on: false, leaseFrom: null, leaseTo: null });
  });

  it('clips the lease to the archive', () => {
    const t = { on: true, leaseFrom: '2023-07-01', leaseTo: '2025-06-30' };
    expect(leaseWindow(t, '2022-01-01', '2026-11-08')).toEqual({ from: '2023-07-01', to: '2025-06-30' });
    expect(leaseWindow({ ...t, leaseTo: null }, '2024-01-01', '2026-11-08')).toEqual({ from: '2024-01-01', to: '2026-11-08' });
    expect(leaseWindow({ ...t, leaseFrom: null }, '2022-01-01', '2026-11-08')).toBeNull();
    expect(leaseWindow({ ...t, leaseFrom: '2027-01-01', leaseTo: null }, '2022-01-01', '2026-11-08')).toBeNull();
  });
});
