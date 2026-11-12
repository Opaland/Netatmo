// #460: the insulation judged with the stove's wood. A fictitious home where the stove does most of
// the heating: its signature (slope, W/°C) and its kWh/m² with the wood are several times those of
// the electricity alone, through the one split of the wood (wood.ts woodDaily).
import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays } from './aggregate';
import type { Weather } from './analysis';
import { seasonSignatures, signatureDays } from './indoorsig';
import { KWH_M2_GRID, W_PER_K_GRID, gradeOf, gridText, homePerM2, roomPerM2Text, wattsPerDegree, withWood, woodYear } from './isolation';
import { NO_WOOD, type WoodSettings, woodDaily } from './wood';

/** A year of weather (Sept 2025 → Aug 2026): cold in January, warm in July, no noise. */
function weatherOf(): Weather {
  const w: Weather = new Map();
  for (let d = '2025-09-01', i = 0; d <= '2026-08-31'; d = addDays(d, 1), i++) {
    const mean = 11 - 10 * Math.cos(((i - 30) / 365) * 2 * Math.PI); // ≈ 1 °C mid-January … 21 °C mid-July
    w.set(d, [mean - 4, mean + 4, mean]);
  }
  return w;
}
const WEATHER = weatherOf();
/** The radiators of the bedrooms only: 0.5 kWh per day and per degree day. */
function electricity(): DayRecord[] {
  const out: DayRecord[] = [];
  for (const [day, [, , t]] of WEATHER) if (t < 18) out.push({ day, room: 'r-ch', cat: 'heating', kwh: 0.5 * (18 - t) });
  return out;
}
/** Six stères of oak: ≈ 8 800 kWh of heat, most of the heating. */
const WOOD: WoodSettings = { ...NO_WOOD, purchases: [{ day: '2025-09-20', steres: 6, species: 'chene', moisture: 20, price: 540 }] };

const slopeOf = (records: DayRecord[]) => {
  const sig = seasonSignatures(signatureDays(records, WEATHER, null, null, new Set()))[0];
  return -sig.outdoor!.slope;
};

describe('the signature with the wood (#460)', () => {
  const elec = electricity();
  const daily = woodDaily(WOOD, WEATHER, '2026-08-31');
  it('the slope electricity + wood is several times the electricity alone when the stove heats most', () => {
    const alone = slopeOf(elec);
    const both = slopeOf(withWood(elec, daily));
    expect(alone).toBeCloseTo(0.5, 1);
    expect(both / alone).toBeGreaterThan(5);
    // in W/°C: a home that looked « très bien isolé » is not
    expect(gradeOf(wattsPerDegree(alone), W_PER_K_GRID)).toBe('très bien isolé');
    expect(gradeOf(wattsPerDegree(both), W_PER_K_GRID)).not.toBe('très bien isolé');
  });
  it('without wood the records are the electricity alone', () => {
    expect(withWood(elec, null)).toBe(elec);
    expect(slopeOf(withWood(elec, new Map()))).toBeCloseTo(slopeOf(elec), 6);
  });
  it('no wood before the first electricity day', () => {
    const late = elec.filter((r) => r.day >= '2026-01-01');
    expect(withWood(late, daily).every((r) => r.day >= '2026-01-01')).toBe(true);
  });
});

describe('the kWh/m² of the home (#460)', () => {
  const elec = electricity();
  const daily = woodDaily(WOOD, WEATHER, '2026-08-31');
  const year = ['2025-09-01', '2026-08-31'] as const;
  it('the wood counts when the stove room has a surface', () => {
    const both = homePerM2(elec, { 'r-ch': 40, 'r-sejour': 60 }, ['r-ch', 'r-sejour'], ['r-sejour'], daily, ...year)!;
    const alone = homePerM2(elec, { 'r-ch': 40, 'r-sejour': 60 }, ['r-ch', 'r-sejour'], ['r-sejour'], null, ...year)!;
    expect(both.wood).toBeGreaterThan(8000);
    expect(both.perM2).toBeCloseTo((alone.kwh + both.wood) / 100, 6);
    expect(both.perM2 / alone.perM2).toBeGreaterThan(5);
    expect(both.known).toBe(2);
  });
  it('the wood does not count over surfaces that are not the stove’s', () => {
    const r = homePerM2(elec, { 'r-ch': 40 }, ['r-ch', 'r-sejour'], ['r-sejour'], daily, ...year)!;
    expect(r.wood).toBe(0);
    expect(r.known).toBe(1);
    expect(r.rooms).toBe(2);
  });
  it('no surface, no kWh/m²', () => {
    expect(homePerM2(elec, {}, ['r-ch'], [], daily, ...year)).toBeNull();
  });
  it('a stove room without electricity says « chauffée au bois », never 0', () => {
    const f = (v: number) => v.toFixed(0);
    expect(roomPerM2Text(0, 20, true, f)).toBe('chauffée au bois');
    expect(roomPerM2Text(200, 20, true, f)).toBe('10 kWh/m² + bois');
    expect(roomPerM2Text(0, 20, false, f)).toBe('0 kWh/m²');
  });
});

describe('the indicative grids (#460)', () => {
  it('bands W/°C: < 100, 100–170, 170–280, > 280', () => {
    expect([99, 100, 169, 170, 279, 280, 281].map((v) => gradeOf(v, W_PER_K_GRID))).toEqual([
      'très bien isolé',
      'bien isolé',
      'bien isolé',
      'moyennement isolé',
      'moyennement isolé',
      'mal isolé',
      'mal isolé',
    ]);
    expect(gridText(W_PER_K_GRID)).toBe('< 100 très bien · 100–170 bien · 170–280 moyen · > 280 mal isolé');
  });
  it('bands kWh/m²: < 50, 50–90, 90–150, > 150', () => {
    expect([49, 50, 90, 149, 150].map((v) => gradeOf(v, KWH_M2_GRID))).toEqual(['très bien isolé', 'bien isolé', 'moyennement isolé', 'moyennement isolé', 'mal isolé']);
  });
  it('W/°C from the slope: 2.4 kWh per day per °C is 100 W/°C', () => {
    expect(wattsPerDegree(-2.4)).toBeCloseTo(100, 6);
  });
});

describe('« Chauffage électricité + bois », year by year (revue de code v1.8)', () => {
  // A fictitious year whose data start on 1 March: 10 kWh of electricity and 5 kWh of wood a day,
  // the wood also on days before the first electricity day, and no outdoor temperature on the
  // second half of the year (a station out of reach), every day measured at 8 °C (10 degree days).
  const heat: DayRecord[] = [];
  const daily = new Map<string, [number, number]>();
  const weather: Weather = new Map();
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) {
    daily.set(d, [5, 0.5]);
    if (d >= '2025-03-01') heat.push({ day: d, room: 'r-ch', cat: 'heating', kwh: 10 });
    if (d < '2025-07-01') weather.set(d, [4, 12, 8]);
  }
  const y = woodYear(heat, daily, weather, 2025, '2025-03-01', '2025-12-31');

  it('counts the wood from the first electricity day on, as withWood (#433)', () => {
    expect(y.wood).toBe(5 * 306); // 1 March → 31 December
    expect(y.kwh).toBe(15 * 306);
    expect(y.woodEur).toBeCloseTo(0.5 * 306);
  });

  it('divides by the degree days of the days measured only, and says « au moins » (#464)', () => {
    // 1 March → 30 June: 122 days with a temperature, 10 degree days each
    expect(y.cold!.perDju).toBe('1,50'); // 15 kWh / 10 DJ: not the whole span's heating over the cold of the days measured
    expect(y.cold!.cell).toMatch(/^1\s220 \*$/);
    expect(y.cold!.caveat).toContain('184 jours sans température extérieure');
  });

  it('no weather: no cold, the heating still counted', () => {
    const z = woodYear(heat, daily, null, 2025, '2025-03-01', '2025-12-31');
    expect(z.cold).toBeNull();
    expect(z.kwh).toBe(15 * 306);
  });
});
