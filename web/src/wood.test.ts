// #366: the wood stove — settings read back never trusted, heat with its assumptions, the season
// a purchase is burnt in, and its spread over the days by degree days.
import { describe, expect, it } from 'vitest';
import { addDays } from './aggregate';
import type { Weather } from './analysis';
import {
  DEFAULT_EFFICIENCY,
  KWH_PER_STERE,
  NO_WOOD,
  STOVE_ROOM_WARM,
  STOVE_WARM_MIN_DAYS,
  heatOf,
  moistureFactor,
  parseWood,
  purchaseText,
  readingIgnored,
  seasonFed,
  seasonText,
  stoveWarm,
  stoveWarmText,
  woodDaily,
  woodIn,
  woodJson,
  woodSeasons,
  woodSpread,
} from './wood';
import { ADEME_PER_DEGREE } from './checks';

const fsName = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string; readdirSync: (u: URL) => string[] };

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

  it('#465: parses the readings of the wood burnt — one quantity, one per season, bounded', () => {
    const w = parseWood({
      purchases: [oak],
      burnt: [
        { season: 2026, left: 0.5 },
        { season: 2025, steres: 1.5 },
        { season: 2025, steres: 9 }, // a second reading of the same season: the first kept
        { season: 2024, steres: 1, left: 1 }, // both: which one?
        { season: 2023 }, // neither
        { season: 2022.5, steres: 1 },
        { season: 1999, steres: 1 },
        { season: 2021, steres: -1 },
        { season: 2020, left: 201 },
        { season: '2019', steres: 1 },
      ],
    });
    expect(w.burnt).toEqual([
      { season: 2025, steres: 1.5 },
      { season: 2026, left: 0.5 },
    ]);
    expect(parseWood(JSON.parse(woodJson(w)))).toEqual(w);
    expect(JSON.parse(woodJson(w)).burnt).toEqual(w.burnt);
    expect(woodJson({ ...w, burnt: [] })).not.toContain('burnt'); // none: the format of before
  });

  it('#465: without a reading, a season burns all it has, nothing is carried', () => {
    const [a, b] = woodSeasons(parseWood({ purchases: [oak, { ...oak, day: '2026-06-01', steres: 3, price: 270 }] }));
    expect([a.bought, a.steres, a.left, a.reading]).toEqual([2, 2, 0, null]);
    expect([b.carried, b.bought, b.steres, b.left]).toEqual([0, 3, 3, 0]);
  });

  it('#465: the stères burnt noted take the place of the assumption; the rest is carried to the next season', () => {
    const w = parseWood({ purchases: [oak, { ...oak, day: '2026-06-01', steres: 3, price: 360, species: 'resineux' }], burnt: [{ season: 2025, steres: 1.5 }] });
    const [a, b] = woodSeasons(w);
    expect(a.steres).toBe(1.5);
    expect(a.left).toBeCloseTo(0.5, 9);
    expect(a.eur).toBeCloseTo(150, 9); // 1.5 stère at 100 €
    expect(a.kwh).toBeCloseTo(heatOf(oak, w) * 0.75, 6);
    // the next season burns the oak carried first, then its own softwood (all of it: no reading)
    expect(b.carried).toBeCloseTo(0.5, 9);
    expect(b.steres).toBeCloseTo(3.5, 9);
    expect(b.eur).toBeCloseTo(50 + 360, 9);
    expect(b.kwh).toBeCloseTo(heatOf(oak, w) * 0.25 + heatOf({ ...oak, steres: 3, species: 'resineux' }, w), 6);
    // over both seasons, all the money and heat bought are counted once
    expect(a.eur + b.eur).toBeCloseTo(200 + 360, 9);
  });

  it('#465: the stock left in spring: the season burns all but it, and the next one starts with it', () => {
    const w = parseWood({ purchases: [oak], burnt: [{ season: 2025, left: 0.5 }, { season: 2026, steres: 0.2 }] });
    const [a, b] = woodSeasons(w);
    expect([a.steres, a.left]).toEqual([1.5, 0.5]);
    // a season without purchase but with stock and a reading is a season of its own
    expect(b.season).toBe(2026);
    expect([b.bought, b.carried, b.short]).toEqual([0, 0.5, 0]);
    expect(b.steres).toBeCloseTo(0.2, 9);
    expect(b.left).toBeCloseTo(0.3, 9);
  });

  it('#465: more burnt than the stock recorded: what is recorded is burnt, the rest said, never invented', () => {
    const [a] = woodSeasons(parseWood({ purchases: [oak], burnt: [{ season: 2025, steres: 5 }] }));
    expect([a.steres, a.left, a.short]).toEqual([2, 0, 3]);
    expect(a.eur).toBeCloseTo(200, 9);
    const [c] = woodSeasons(parseWood({ purchases: [oak], burnt: [{ season: 2025, left: 4 }] }));
    expect([c.steres, c.left]).toEqual([0, 2]);
  });

  it('#465: the days count the wood burnt, not the wood bought (woodDaily: the one split)', () => {
    const w = parseWood({ purchases: [oak], burnt: [{ season: 2025, steres: 1 }] });
    const daily = woodDaily(w, null, '2027-11-08');
    expect(woodIn(daily, '2025-09-01', '2026-08-31').eur).toBeCloseTo(100, 6);
    // the stère left burns in 2026–2027 (no reading: all it has)
    expect(woodIn(daily, '2026-09-01', '2027-08-31').eur).toBeCloseTo(100, 6);
  });

  it('#465: each season says its assumption or its reading, its stock carried and left', () => {
    const w = parseWood({ purchases: [oak, { ...oak, day: '2026-06-01', steres: 1 }], burnt: [{ season: 2025, left: 0.5 }] });
    const [a, b] = woodSeasons(w);
    expect(seasonText(a)).toBe('2 stères achetés · 1,5 stère brûlé (stock relevé au printemps) · reste 0,5 stère');
    expect(seasonText(b)).toBe('0,5 stère reporté · 1 stère acheté · tout brûlé (supposé)');
    const [c] = woodSeasons(parseWood({ purchases: [oak], burnt: [{ season: 2025, steres: 3 }] }));
    expect(seasonText(c)).toBe('2 stères achetés · 2 stères brûlés (relevé) · 1 stère de plus que les achats notés, non compté');
  });

  it('#501: a stock left above the stock recorded is said, like the stères burnt beyond it', () => {
    const [a] = woodSeasons(parseWood({ purchases: [oak], burnt: [{ season: 2025, left: 5 }] }));
    expect([a.steres, a.left, a.over, a.short]).toEqual([0, 2, 3, 0]);
    expect(seasonText(a)).toBe('2 stères achetés · 0 stère brûlé (stock relevé au printemps) · reste 2 stères · stock relevé : 3 stères de plus que les achats notés, non comptés');
    const [b] = woodSeasons(parseWood({ purchases: [oak], burnt: [{ season: 2025, left: 0.5 }] }));
    expect(b.over).toBe(0);
    expect(seasonText(b)).not.toContain('de plus que');
  });

  it('#501: a reading before the first purchase is in no season: ignored, and said', () => {
    const w = parseWood({ purchases: [oak], burnt: [{ season: 2023, steres: 1 }, { season: 2025, steres: 1 }] });
    expect(woodSeasons(w).map((s) => s.season)).not.toContain(2023);
    expect(readingIgnored(w, w.burnt.find((b) => b.season === 2023)!)).toBe(true);
    expect(readingIgnored(w, w.burnt.find((b) => b.season === 2025)!)).toBe(false);
  });

  it('#501: no screen says the degree days alone where the evenings of fire place the wood', () => {
    expect(woodSpread()).toBe('réparti sur les soirs de flambée que la collecte a trouvés, sinon selon le froid de chaque jour (degrés-jours)');
    expect(woodSpread(true)).toMatch(/^répartie sur les soirs de flambée/);
    const alone = /répartie? (jour par jour )?(selon|au prorata des?) (les degrés-jours|le froid)/;
    const dir = new URL('./views/', import.meta.url);
    const said: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      fs.readFileSync(new URL(f, dir), 'utf8')
        .split('\n')
        // fires.ts: « Sans détection, le bois du poêle est réparti selon les degrés-jours » (the fallback, said as such)
        .forEach((line, i) => alone.test(line) && !/Sans détection/.test(line) && said.push(`${f}:${i + 1}`));
    }
    expect(said).toEqual([]);
  });
});

// #468: a stove room kept too warm, and the wood it costs (fictitious purchase and readings)
describe('#468 stove room above 22 °C', () => {
  const settings = parseWood({ purchases: [{ ...oak, steres: 4, price: 400 }] });
  const last = '2025-11-30';
  const daily = woodDaily(settings, null, last); // no weather: evenly from October to April
  const seasons = woodSeasons(settings);
  const temps = (t: number, days = 30) => {
    const m = new Map<string, number | null>();
    for (let i = 0; i < days; i++) m.set(addDays(last, -i), t);
    return m;
  };

  it('says the wood saved at 22 °C, about 7 % per degree above, in stères and euros', () => {
    const w = stoveWarm(temps(25), daily, seasons, last)!;
    expect(w.days).toBe(30);
    expect(w.mean).toBeCloseTo(25);
    expect(w.season).toBe(2025);
    expect(w.pct).toBeCloseTo((25 - STOVE_ROOM_WARM) * ADEME_PER_DEGREE);
    expect(w.steres).toBeCloseTo(4 * 0.21);
    expect(w.eur).toBeCloseTo(400 * 0.21);
    const t = stoveWarmText(w);
    expect(t.title).toBe('Pièce chauffée au bois au-dessus de 22 °C');
    expect(t.text).toContain('la pièce était à 25,0 °C en moyenne');
    expect(t.text).toContain('environ 21 % du bois de la saison 2025-2026, soit ≈ 0,8 stère et 84 €');
    // the assumptions are said on screen
    expect(t.text).toContain('Hypothèses : le seuil de 22 °C, environ 7 % de bois par degré au-dessus');
  });

  it('nothing at or under 22 °C, under 7 days, or on days the stove does not heat', () => {
    expect(stoveWarm(temps(STOVE_ROOM_WARM), daily, seasons, last)).toBeNull();
    expect(stoveWarm(temps(26, STOVE_WARM_MIN_DAYS - 1), daily, seasons, last)).toBeNull();
    expect(stoveWarm(temps(26, STOVE_WARM_MIN_DAYS), daily, seasons, last)?.days).toBe(STOVE_WARM_MIN_DAYS);
    // in summer the wood is not spread (October to April): a warm room is not the stove
    const july = '2026-07-31';
    const hot = new Map<string, number>();
    for (let i = 0; i < 30; i++) hot.set(addDays(july, -i), 27);
    expect(stoveWarm(hot, woodDaily(settings, null, july), seasons, july)).toBeNull();
    // no wood bought: nothing to save
    expect(stoveWarm(temps(26), new Map(), [], last)).toBeNull();
  });

  it('caps the share at the whole wood of the season', () => {
    expect(stoveWarm(temps(40), daily, seasons, last)!.pct).toBe(1);
  });
});
