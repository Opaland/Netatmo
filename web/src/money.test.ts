import { describe, expect, it } from 'vitest';
import type { TrveRow } from './analysis';
import { budgetStatus, co2Of, fmtCo2, gridImpact, newGrid } from './money';

describe('S-2.12 budget', () => {
  it('projects the spending from the year-end consumption projection', () => {
    // 1 000 kWh for 250 € so far (0.25 €/kWh), 3 000 kWh expected over the year
    const b = budgetStatus(600, 250, 1000, 3000, 120, 365);
    expect(b.projected).toBeCloseTo(750);
    expect(b.gap).toBeCloseTo(150);
    expect(b.over).toBe(true);
    expect(b.toDate).toBeCloseTo(200); // a third of the year's kWh are usually done by now
    expect(b.method).toBe('profile');
  });

  it('says "within budget" when the projection stays below', () => {
    const b = budgetStatus(1000, 250, 1000, 3000, 120, 365);
    expect(b.over).toBe(false);
    expect(b.gap).toBeCloseTo(-250);
  });

  it('falls back on the prorata of days without previous years', () => {
    const b = budgetStatus(1000, 300, 1000, null, 73, 365);
    expect(b.method).toBe('prorata');
    expect(b.projected).toBeCloseTo(1500);
    expect(b.toDate).toBeCloseTo(200);
  });
});

describe('S-2.13 CO₂', () => {
  it('multiplies the kWh by the factor and formats', () => {
    expect(co2Of(1000, 0.052)).toBeCloseTo(52);
    expect(fmtCo2(52)).toBe('52 kg CO₂e');
    expect(fmtCo2(2.345)).toBe('2,3 kg CO₂e');
    expect(fmtCo2(1520)).toBe('1,5 t CO₂e');
  });
});

describe('S-2.11 new regulated tariff', () => {
  const row = (from: string, to: string | null, hc: number, hp: number, fixedYear: number, kva = 9): TrveRow => ({ from, to, kva, hc, hp, fixedYear });
  const rows = [
    row('2025-08-01', '2026-01-31', 0.15, 0.2, 230),
    row('2026-02-01', '2026-07-31', 0.1578, 0.2065, 235.92),
    row('2026-02-01', '2026-07-31', 0.1578, 0.2065, 188.24, 6),
    row('2026-08-01', null, 0.1589, 0.2142, 239.84),
  ];

  it('finds the latest grid when it starts recently or in the future', () => {
    const g = newGrid(rows, 9, '2026-11-08');
    expect(g?.prev.from).toBe('2026-02-01');
    expect(g?.next.from).toBe('2026-08-01');
    expect(newGrid(rows, 9, '2026-07-15')?.next.from).toBe('2026-08-01'); // announced in advance
  });

  it('shows nothing when the latest grid is old, unknown for that power, or unchanged', () => {
    expect(newGrid(rows, 9, '2027-03-01')).toBeNull();
    expect(newGrid(rows, 6, '2026-11-08')).toBeNull();
    expect(newGrid([row('2026-02-01', '2026-07-31', 0.1, 0.2, 200), row('2026-08-01', null, 0.1, 0.2, 200)], 9, '2026-08-10')).toBeNull();
  });

  it('adds the energy and subscription differences', () => {
    const i = gridImpact(1000, 1050, rows[1], rows[3]);
    expect(i.energy).toBeCloseTo(50);
    expect(i.subscription).toBeCloseTo(3.92);
    expect(i.total).toBeCloseTo(53.92);
    expect(i.pct).toBeCloseTo((53.92 / 1235.92) * 100);
  });
});
