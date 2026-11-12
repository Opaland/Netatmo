// #127: a kWh/m²/an mark, heating + hot water, against the thresholds of the DPE energy label.
// Fictitious home only.
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import { DPE_CLASSES, DPE_ENERGY_GRID, ELEC_PRIMARY, dpeClassOf, dpeMark, elecPrimaryAt } from './isolation';

/** A year of a fictitious home: 20 kWh of heating per day in each of two rooms, 5 kWh of hot water. */
function year(): DayRecord[] {
  const out: DayRecord[] = [];
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) {
    out.push({ day: d, room: 'r-sejour', cat: 'heating', kwh: 20 });
    out.push({ day: d, room: 'r-ch', cat: 'heating', kwh: 10 });
    out.push({ day: d, room: 'r-ce', cat: 'water_heater', kwh: 5 });
  }
  return out;
}
const SPAN = ['2025-01-01', '2025-12-31'] as const;

describe('repère kWh/m²/an face aux seuils du DPE (#127)', () => {
  it('seuils de l’étiquette énergie : bornes hautes incluses, G au-delà de 420', () => {
    expect(DPE_ENERGY_GRID).toEqual([70, 110, 180, 250, 330, 420]);
    expect(DPE_CLASSES.length).toBe(DPE_ENERGY_GRID.length + 1);
    expect(dpeClassOf(70)).toBe('A');
    expect(dpeClassOf(71)).toBe('B');
    expect(dpeClassOf(110)).toBe('B');
    expect(dpeClassOf(250)).toBe('D');
    expect(dpeClassOf(420)).toBe('F');
    expect(dpeClassOf(421)).toBe('G');
    expect(dpeClassOf(0)).toBe('A');
  });

  it('coefficient de l’électricité selon la date : 2,3, puis 1,9 en 2026, 1,7 en 2027', () => {
    expect(ELEC_PRIMARY.map(([d]) => d)).toEqual([...ELEC_PRIMARY.map(([d]) => d)].sort());
    expect(elecPrimaryAt('2025-12-31')).toBe(2.3);
    expect(elecPrimaryAt('2026-01-01')).toBe(1.9);
    expect(elecPrimaryAt('2026-11-12')).toBe(1.9);
    expect(elecPrimaryAt('2027-01-01')).toBe(1.7);
    expect(elecPrimaryAt('2020-01-01')).toBe(2.3);
  });

  it('chauffage + eau chaude sur la surface, en finale puis en primaire, classée', () => {
    const m = dpeMark(year(), { 'r-sejour': 60, 'r-ch': 40 }, ['r-sejour', 'r-ch'], ['r-ce'], [], null, ...SPAN, '2026-06-01')!;
    // 365 × (30 + 5) kWh = 12 775 kWh over 100 m²
    expect(m.elec).toBe(365 * 30);
    expect(m.water).toBe(365 * 5);
    expect(m.wood).toBe(0);
    expect(m.finalPerM2).toBeCloseTo(127.75, 6);
    expect(m.factor).toBe(1.9);
    expect(m.primaryPerM2).toBeCloseTo(127.75 * 1.9, 6); // 242,7: D
    expect(m.cls).toBe('D');
    // the same home before 2026 (2,3): 293,8, E
    expect(dpeMark(year(), { 'r-sejour': 60, 'r-ch': 40 }, ['r-sejour', 'r-ch'], ['r-ce'], [], null, ...SPAN, '2025-06-01')!.cls).toBe('E');
  });

  it('le bois du poêle compte avec un coefficient 1, comme le kWh/m² de l’isolation', () => {
    const daily = new Map<string, [number, number]>();
    for (let d: string = SPAN[0]; d <= SPAN[1]; d = addDays(d, 1)) daily.set(d, [10, 0.5]);
    const m = dpeMark(year(), { 'r-sejour': 60, 'r-ch': 40 }, ['r-sejour', 'r-ch'], ['r-ce'], ['r-sejour'], daily, ...SPAN, '2026-06-01')!;
    expect(m.wood).toBe(3650);
    expect(m.finalPerM2).toBeCloseTo((365 * 35 + 3650) / 100, 6);
    expect(m.primaryPerM2).toBeCloseTo((365 * 35 * 1.9 + 3650) / 100, 6);
  });

  it('sans surface, rien (section masquée) ; surfaces incomplètes, pas de classe', () => {
    expect(dpeMark(year(), {}, ['r-sejour', 'r-ch'], ['r-ce'], [], null, ...SPAN, '2026-06-01')).toBeNull();
    const part = dpeMark(year(), { 'r-sejour': 60 }, ['r-sejour', 'r-ch'], ['r-ce'], [], null, ...SPAN, '2026-06-01')!;
    expect(part.cls).toBeNull();
    expect([part.known, part.rooms]).toEqual([1, 2]);
  });
});
