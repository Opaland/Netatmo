// #366: the wood stove — settings read back never trusted, heat with its assumptions, the season
// a purchase is burnt in, and its spread over the days by degree days.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Weather } from './analysis';
import { DEFAULT_EFFICIENCY, KWH_PER_STERE, NO_WOOD, heatOf, moistureFactor, parseWood, purchaseText, seasonFed, woodDaily, woodIn, woodJson, woodSeasons } from './wood';

const oak = { day: '2025-09-20', steres: 2, species: 'chene' as const, moisture: 20, price: 200 };

describe('#366 wood stove', () => {
  it('keeps only valid purchases, sorted, and bounded assumptions', () => {
    const w = parseWood({
      purchases: [
        { ...oak, day: '2026-01-10' },
        oak,
        { ...oak, day: '2026-02-30' }, // no such day
        { ...oak, species: 'constructor' },
        { ...oak, steres: 0 },
        { ...oak, moisture: 90 },
        { ...oak, price: -1 },
        { ...oak, steres: '2' },
      ],
      efficiency: 150,
      kwhPerStere: { chene: 1800, hetre: 99999, __proto__: 1 },
    });
    expect(w.purchases.map((p) => p.day)).toEqual(['2025-09-20', '2026-01-10']);
    expect(w.efficiency).toBe(DEFAULT_EFFICIENCY);
    expect(w.kwhPerStere.chene).toBe(1800);
    expect(w.kwhPerStere.hetre).toBe(KWH_PER_STERE.hetre);
    expect(parseWood(null)).toEqual(NO_WOOD);
    expect(parseWood(JSON.parse(woodJson(w)))).toEqual(w);
    expect(JSON.parse(woodJson(w))).toEqual({ purchases: w.purchases, kwhPerStere: { chene: 1800 } }); // defaults left out
    expect(woodJson(NO_WOOD)).toBe('{"purchases":[]}');
  });

  it('turns stères into heat with the assumptions: species, moisture, efficiency', () => {
    expect(moistureFactor(20)).toBe(1);
    expect(moistureFactor(30)).toBeLessThan(1);
    expect(moistureFactor(15)).toBeGreaterThan(1);
    const s = { ...NO_WOOD, efficiency: 50 };
    expect(heatOf(oak, s)).toBeCloseTo(2 * KWH_PER_STERE.chene * 0.5, 6);
    expect(heatOf({ ...oak, species: 'resineux' }, s)).toBeLessThan(heatOf(oak, s));
    expect(heatOf({ ...oak, moisture: 35 }, s)).toBeLessThan(heatOf(oak, s));
    expect(purchaseText(oak)).toBe('2 stères de chêne à 20 %');
    expect(purchaseText({ ...oak, steres: 1.5, species: 'melange' })).toBe('1,5 stère de feuillus mélangés à 20 %');
  });

  it('a purchase feeds the season after it, or the one running from January to March', () => {
    expect(seasonFed('2025-06-15')).toBe(2025);
    expect(seasonFed('2025-10-01')).toBe(2025);
    expect(seasonFed('2026-02-01')).toBe(2025);
    expect(seasonFed('2026-04-01')).toBe(2026);
    const seasons = woodSeasons(parseWood({ purchases: [oak, { ...oak, day: '2026-02-01', price: 100, steres: 1 }, { ...oak, day: '2026-05-01' }] }));
    expect(seasons.map((s) => [s.season, s.steres, s.eur])).toEqual([
      [2025, 3, 300],
      [2026, 2, 200],
    ]);
  });

  it('spreads a season by degree days: none on a warm day, all of it over a whole season', () => {
    const weather: Weather = new Map();
    for (let d = '2025-09-01'; d <= '2026-11-08'; d = addDays(d, 1)) {
      const m = Number(d.slice(5, 7));
      const t = m >= 6 && m <= 9 ? 22 : m === 1 ? 2 : 10; // summer: no degree day
      weather.set(d, [t - 2, t + 2, t]);
    }
    const w = parseWood({ purchases: [oak, { ...oak, day: '2026-06-01', price: 180 }] });
    const daily = woodDaily(w, weather, '2026-11-08');
    const whole = woodIn(daily, '2025-09-01', '2026-08-31');
    expect(whole.eur).toBeCloseTo(200, 6);
    expect(whole.kwh).toBeCloseTo(heatOf(oak, w), 6);
    expect(woodIn(daily, '2026-07-01', '2026-07-31').kwh).toBe(0);
    expect(woodIn(daily, '2026-01-01', '2026-01-31').kwh / 31).toBeGreaterThan(woodIn(daily, '2025-11-01', '2025-11-30').kwh / 30); // colder, more wood
    // the season running (2026–2027, to 8 Nov.): only the share of an average season's degree days
    const running = woodIn(daily, '2026-09-01', '2026-11-08');
    expect(running.eur).toBeGreaterThan(0);
    expect(running.eur).toBeLessThan(180 * 0.5);
  });

  it('without weather, evenly from October to April', () => {
    const daily = woodDaily(parseWood({ purchases: [oak] }), null, '2026-11-08');
    expect(woodIn(daily, '2025-09-01', '2026-08-31').eur).toBeCloseTo(200, 6);
    expect(woodIn(daily, '2025-09-01', '2025-09-30').eur).toBe(0);
    expect(woodIn(daily, '2025-10-01', '2025-10-31').eur).toBeCloseTo((200 * 31) / 212, 6);
  });
});
