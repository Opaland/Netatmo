import { describe, expect, it } from 'vitest';
import { breakdown, kwhPerYear, parseDeclared, plugsFrom, windowDays } from './breakdown';

const days = Array.from({ length: 10 }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
const constant = (v: number) => new Map(days.map((d) => [d, v]));

describe('plugsFrom', () => {
  it('keeps usable plugs, complete days, in kWh, and lists the unusable ones', () => {
    const { plugs, unusable } = plugsFrom({
      plugs: { p0: { name: 'Frigo', usable: true }, p1: { name: 'Box', usable: false }, p2: { name: 'Vide' } },
      daily: { p0: { '2025-01-01': 1000, '2025-01-02': 900, '2025-01-03': 300 } },
      until: { p0: '2025-01-03' },
    });
    expect(plugs).toHaveLength(1);
    expect([...plugs[0].daily]).toEqual([
      ['2025-01-01', 1],
      ['2025-01-02', 0.9],
    ]);
    expect(unusable).toEqual(['Box']);
  });
  it('accepts no document', () => {
    expect(plugsFrom(null)).toEqual({ plugs: [], unusable: [] });
  });
});

describe('windowDays', () => {
  it('takes the last n Linky days up to the last radiator day', () => {
    const linky = new Map([...days.map((d) => [d, 10] as [string, number]), ['2025-02-01', 3]]);
    expect(windowDays(linky, '2025-01-10', 3)).toEqual(['2025-01-08', '2025-01-09', '2025-01-10']);
  });
});

describe('breakdown', () => {
  it('splits the rest into plugs, declared, net talon and unexplained', () => {
    const b = breakdown({
      days,
      linky: constant(20),
      heating: constant(8),
      water: constant(4),
      plugs: [
        { key: 'p0', name: 'Frigo', daily: constant(0.96) }, // 40 W, steady: always on
        { key: 'p1', name: 'Lave-linge', daily: new Map(days.slice(0, 5).map((d, i) => [d, i % 2 ? 1 : 0.01])) },
      ],
      declared: [
        { name: 'Box', watts: 10, hours: 24 },
        { name: 'Four', watts: 2000, hours: 0.5 },
      ],
      talonWatts: 200,
    });
    expect(b.rest).toBeCloseTo(80);
    const by = Object.fromEntries(b.parts.map((p) => [p.name, p]));
    expect(by.Frigo.permanent).toBe(true);
    expect(by.Frigo.kwh).toBeCloseTo(9.6);
    expect(by['Lave-linge'].permanent).toBe(false);
    expect(by['Lave-linge'].measuredDays).toBe(5);
    expect(by['Lave-linge'].kwh).toBeCloseTo(((0.01 * 3 + 1 * 2) / 5) * 10);
    expect(by.Four.kwh).toBeCloseTo(10);
    // talon 200 W minus fridge 40 W and box 10 W
    expect(by['Veille'].watts).toBeCloseTo(150);
    expect(by['Veille'].kwh).toBeCloseTo(36);
    expect(b.talonWatts).toBe(200);
    expect(b.talonInParts).toBeCloseTo(50);
    const sumParts = b.parts.reduce((s, p) => s + p.kwh, 0);
    expect(sumParts).toBeCloseTo(80);
    expect(b.over).toBe(0);
  });
  it('#348: permanent parts above the standby leave a zero « Veille » row, and say how much they hold', () => {
    const b = breakdown({
      days,
      linky: constant(20),
      heating: constant(8),
      water: constant(4),
      // a circuit of the board measured round the clock, steadier than the night base load
      plugs: [{ key: 'p4c0', name: 'Tableau · canal 1', daily: constant(4.8) }], // 200 W
      declared: [],
      talonWatts: 150,
    });
    const veille = b.parts.find((p) => p.kind === 'talon')!;
    expect(veille.watts).toBe(0);
    expect(b.talonWatts).toBe(150); // the figure of the Veille page, unchanged
    expect(b.talonInParts).toBe(150); // never more than the standby itself
    expect(b.talonWatts! - b.talonInParts).toBe(veille.watts);
  });
  it('flags parts exceeding the rest and never shows a negative remainder', () => {
    const b = breakdown({
      days,
      linky: constant(10),
      heating: constant(9),
      water: constant(0),
      plugs: [],
      declared: [{ name: 'Radiateur d’appoint', watts: 1000, hours: 4 }],
      talonWatts: null,
    });
    expect(b.over).toBeCloseTo(30);
    expect(b.parts.find((p) => p.kind === 'unexplained')!.kwh).toBe(0);
    expect(b.parts.some((p) => p.kind === 'talon')).toBe(false);
  });
});

describe('helpers', () => {
  it('kWh per year and declared validation', () => {
    expect(kwhPerYear(100)).toBeCloseTo(876);
    expect(parseDeclared(' Box ', '12,5', '24')).toEqual({ name: 'Box', watts: 12.5, hours: 24 });
    expect(parseDeclared('', '10', '1')).toMatch(/Nom/);
    expect(parseDeclared('x', '-1', '1')).toMatch(/Puissance/);
    expect(parseDeclared('x', '10', '25')).toMatch(/Durée/);
  });
});
