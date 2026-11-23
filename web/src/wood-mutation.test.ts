// #678: the survivors of the first mutation run on wood.ts (83,8 %), each test seen red on its
// mutant. Fictitious purchases and weather only. What is left, and why: docs/bmad/06-qa-strategy.md § 7.
import { describe, expect, it, vi } from 'vitest';
import { addDays } from './aggregate';
import { type Weather, dju } from './analysis';
import { ADEME_PER_DEGREE } from './checks';
import {
  MAX_PURCHASES,
  type WoodPurchase,
  type WoodSeason,
  type WoodSettings,
  moistureFactor,
  parseWood,
  purchaseText,
  readingIgnored,
  seasonText,
  stoveWarm,
  stoveWarmText,
  woodDaily,
  woodIn,
  woodJson,
  woodRecords,
  woodSeasons,
} from './wood';

/** The texts put no-break spaces before « % » and « € »: read as plain spaces here. */
const sp = (t: string) => t.replace(/[  ]/g, ' ');
const oak = (day: string, over: Partial<WoodPurchase> = {}): WoodPurchase => ({ day, steres: 2, species: 'chene', moisture: 20, price: 200, ...over });
const settings = (purchases: WoodPurchase[], over: Partial<WoodSettings> = {}): WoodSettings => ({ ...parseWood({}), purchases, ...over });
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** A weather whose mean is `t(d)` every day (min t − 2, max t + 2). */
const weatherOf = (days: string[], t: (d: string) => number): Weather => new Map(days.map((d) => [d, [t(d) - 2, t(d) + 2, t(d)]]));
const djuOf = (w: Weather, from: string, to: string) => span(from, to).reduce((s, d) => s + (w.has(d) ? dju(w.get(d)!) : 0), 0);
const HEAT = 2 * 2100 * 0.7; // 2 stères of oak at 20 %, stove at 70 %

describe('#678 : ce que le module définit au chargement (module rechargé)', () => {
  // Without a test that loads wood.ts itself, these mutants were « ignored » (static): covered by none.
  const fresh = async () => {
    vi.resetModules();
    return import('./wood');
  };
  it('les essences, leurs kWh par stère, les réglages par défaut', async () => {
    const m = await fresh();
    expect(m.SPECIES).toEqual({ chene: 'Chêne', hetre: 'Hêtre', charme: 'Charme', frene: 'Frêne', melange: 'Mélange de feuillus', resineux: 'Résineux' });
    expect(m.KWH_PER_STERE).toEqual({ chene: 2100, hetre: 2000, charme: 2100, frene: 2000, melange: 1900, resineux: 1500 });
    expect(m.NO_WOOD).toEqual({ purchases: [], burnt: [], efficiency: 70, kwhPerStere: m.KWH_PER_STERE });
    expect(m.NO_WOOD.kwhPerStere).not.toBe(m.KWH_PER_STERE);
    expect(m.BURNT_SEASONS).toEqual([2000, 2100]);
    expect(m.WOOD_ROOM).toBe('\u0000bois');
  });
  it('un vrai jour, des nombres bornés, une saison de relevé connue', async () => {
    const m = await fresh();
    const days = ['2025-01-01', '2025-12-31', '2024-02-29', '2025-13-01', '2025-00-10', '2025-01-32', '2025-01-00', 'x2025-01-01', '2025-01-01x', '2025-02-30', '2025-1-01', '202-01-01', '2025-01-1', '2025-001-01', 'abcd-01-01'];
    const w = m.parseWood({ purchases: days.map((day) => oak(day)) });
    expect(w.purchases.map((p) => p.day)).toEqual(['2024-02-29', '2025-01-01', '2025-12-31']);
    expect(m.parseWood({ purchases: [oak('2025-01-01', { steres: '2' as unknown as number })] }).purchases).toEqual([]);
    expect(m.parseWood({ burnt: [{ season: 2000, steres: 1 }, { season: 2100, left: 1 }, { season: 1999, steres: 1 }, { season: 2101, steres: 1 }] }).burnt.map((b) => b.season)).toEqual([2000, 2100]);
  });
  it('les jours de la saison, la saison du chauffage, les nombres écrits, le bois en relevés', async () => {
    const m = await fresh();
    const d = m.woodDaily(settings([oak('2024-09-20')]), null, '2024-10-02');
    expect([...d.keys()]).toEqual(['2024-10-01', '2024-10-02']);
    const temps = new Map<string, number>();
    const daily = new Map<string, [number, number]>();
    for (let k = 0; k < 10; k++) temps.set(addDays('2025-03-10', -k), 24), daily.set(addDays('2025-03-10', -k), [5, 1]);
    const seasons = m.woodSeasons(settings([oak('2024-09-20')]));
    const sw = m.stoveWarm(temps, daily, seasons, '2025-03-10')!;
    expect(sw.season).toBe(2024);
    expect(sp(m.stoveWarmText(sw).text)).toContain('la pièce était à 24,0 °C en moyenne');
    expect(m.woodRecords(daily)[0].room).toBe('\u0000bois');
    expect(m.seasonText(seasons[0])).toBe('2 stères achetés · tout brûlé (supposé)');
  });
});

describe('#678 : les réglages relus', () => {
  it('bornes des stères comprises, soixante achats et relevés au plus, un achat nul ou à l’essence non textuelle écarté', () => {
    const w = parseWood({
      purchases: [oak('2025-01-02', { steres: 0.1 }), oak('2025-01-01', { steres: 100 }), null, oak('2025-01-03', { species: ['chene'] as unknown as 'chene' }), oak('2025-01-04', { steres: 0.09 })],
    });
    expect(w.purchases.map((p) => [p.day, p.steres])).toEqual([
      ['2025-01-01', 100],
      ['2025-01-02', 0.1],
    ]);
    const many = parseWood({
      purchases: Array.from({ length: 61 }, (_, k) => oak(addDays('2020-01-01', k))),
      burnt: Array.from({ length: 61 }, (_, k) => ({ season: 2000 + k, steres: 1 })),
    });
    expect(many.purchases).toHaveLength(MAX_PURCHASES);
    expect(many.purchases.at(-1)!.day).toBe(addDays('2020-01-01', 59));
    expect(many.burnt).toHaveLength(MAX_PURCHASES);
    expect(many.burnt.at(-1)!.season).toBe(2059);
  });
  it('deux achats du même jour gardent leur ordre', () => {
    const w = parseWood({ purchases: [oak('2025-01-02', { price: 1 }), oak('2025-01-01'), oak('2025-01-02', { price: 2 })] });
    expect(w.purchases.map((p) => p.price)).toEqual([200, 1, 2]);
  });
  it('woodJson : le rendement seulement quand il n’est pas celui par défaut', () => {
    expect(JSON.parse(woodJson(settings([oak('2025-01-01')], { efficiency: 80 }))).efficiency).toBe(80);
    expect(JSON.parse(woodJson(settings([oak('2025-01-01')]))).efficiency).toBeUndefined();
  });
  it('le facteur d’humidité calculé à la main : 30 % → 0,9749', () => {
    const water = (h: number) => (0.68 * h) / (100 - h);
    expect(moistureFactor(30)).toBeCloseTo((5 - water(30)) / (5 - water(20)), 9);
    expect(moistureFactor(30)).toBeCloseTo(0.97486, 5);
  });
});

describe('#678 : le stock, saison après saison', () => {
  it('une saison sans bois ni relevé entre deux achats n’est pas une saison', () => {
    expect(woodSeasons(settings([oak('2020-09-20'), oak('2023-09-20')])).map((s) => s.season)).toEqual([2020, 2023]);
  });
  it('un relevé ignoré seulement avant le premier achat', () => {
    const s = settings([oak('2020-09-20'), oak('2023-09-20')]);
    expect(readingIgnored(s, { season: 2021, steres: 1 })).toBe(false);
    expect(readingIgnored(s, { season: 2019, steres: 1 })).toBe(true);
  });
});

describe('#678 : le bois réparti sur les jours', () => {
  it('sans météo, une saison en cours : octobre à avril, 212 jours, le dernier jour compris', () => {
    const d = woodDaily(settings([oak('2024-09-20')]), null, '2024-12-31');
    expect(d.size).toBe(92); // October to December only: September has no weight
    expect(d.get('2024-12-31')![0]).toBeCloseTo(HEAT / 212, 9);
    expect(d.has('2024-09-30')).toBe(false);
    expect(woodIn(d, '2024-09-01', '2024-12-31').kwh).toBeCloseTo((HEAT * 92) / 212, 6);
  });
  it('une saison qui commence le dernier jour connu', () => {
    const w = weatherOf(['2024-09-01'], () => 8);
    const d = woodDaily(settings([oak('2024-09-20')]), w, '2024-09-01');
    expect([...d.keys()]).toEqual(['2024-09-01']);
  });
  it('du bois gratuit est réparti ; une saison qui ne brûle rien ne met rien sur les jours', () => {
    expect(woodDaily(settings([oak('2024-09-20', { price: 0 })]), null, '2024-12-31').size).toBe(92);
    const none = settings([oak('2024-09-20')], { burnt: [{ season: 2024, steres: 0 }] });
    expect(woodDaily(none, null, '2025-08-31').size).toBe(0);
  });
  it('avec la météo : une saison complète en entier, une saison en cours au prorata d’une saison moyenne', () => {
    // 2022-2023 colder (10 DJ a day) than 2023-2024 (8); 2024-2025 runs until 30 June
    const days = span('2022-09-01', '2025-06-30').reverse(); // read unsorted: the first day is still found
    const w = weatherOf(days, (d) => (d < '2023-09-01' ? 8 : 10));
    const s = settings([oak('2022-09-20'), oak('2023-09-20'), oak('2024-09-20')]);
    const d = woodDaily(s, w, '2025-06-30');
    expect(woodIn(d, '2022-09-01', '2023-08-31').kwh).toBeCloseTo(HEAT, 6);
    expect(woodIn(d, '2023-09-01', '2024-08-31').kwh).toBeCloseTo(HEAT, 6);
    const usual = (djuOf(w, '2022-09-01', '2023-08-31') + djuOf(w, '2023-09-01', '2024-08-31')) / 2;
    const so = djuOf(w, '2024-09-01', '2025-06-30');
    expect(woodIn(d, '2024-09-01', '2025-06-30').kwh).toBeCloseTo((HEAT * so) / usual, 6);
    // the weather starts mid-season: that season is not a whole one
    const late = weatherOf(span('2022-10-15', '2025-06-30'), (d2) => (d2 < '2023-09-01' ? 8 : 10));
    const d2 = woodDaily(s, late, '2025-06-30');
    expect(woodIn(d2, '2024-09-01', '2025-06-30').kwh).toBeCloseTo((HEAT * so) / djuOf(late, '2023-09-01', '2024-08-31'), 6);
  });
});

describe('#678 : la pièce chauffée au bois trop chaude', () => {
  const season = (y: number, steres: number, eur: number): WoodSeason => ({ season: y, bought: steres, carried: 0, steres, kwh: steres * 1000, eur, left: 0, reading: null, short: 0, over: 0 });
  const window = (last: string, n = 10) => {
    const temps = new Map<string, number>();
    const daily = new Map<string, [number, number]>();
    for (let k = 0; k < n; k++) temps.set(addDays(last, -k), 24), daily.set(addDays(last, -k), [5, 1]);
    return { temps, daily };
  };
  it('la saison du dernier jour : de mars, celle qui a commencé l’automne d’avant ; de septembre, la nouvelle', () => {
    const seasons = [season(2023, 9, 900), season(2024, 4, 400), season(2025, 2, 200)];
    const pct = 2 * ADEME_PER_DEGREE;
    const mar = window('2025-03-10');
    expect(stoveWarm(mar.temps, mar.daily, seasons, '2025-03-10')).toMatchObject({ season: 2024, steres: 4 * pct });
    const sep = window('2025-09-15');
    expect(stoveWarm(sep.temps, sep.daily, seasons, '2025-09-15')).toMatchObject({ season: 2025, steres: 2 * pct });
  });
  it('une saison sans stère brûlé : rien', () => {
    const w = window('2025-03-10');
    expect(stoveWarm(w.temps, w.daily, [season(2024, 0, 0)], '2025-03-10')).toBeNull();
  });
  it('le texte : stère au singulier sous 2, pas d’euros quand ils s’arrondissent à zéro', () => {
    const t1 = stoveWarmText({ mean: 24, days: 10, season: 2024, pct: 0.14, steres: 1.5, eur: 0.4 }).text;
    expect(sp(t1)).toContain('soit ≈ 1,5 stère. ');
    const t2 = stoveWarmText({ mean: 24, days: 10, season: 2024, pct: 0.14, steres: 2, eur: 30 }).text;
    expect(sp(t2)).toContain('soit ≈ 2,0 stères et 30 €. ');
  });
});

describe('#678 : le bois en relevés de jours et en mots', () => {
  it('woodRecords : chaque jour par défaut, sauf un jour sans chaleur', () => {
    const daily = new Map<string, [number, number]>([
      ['2025-01-01', [3, 1]],
      ['2025-01-02', [0, 0]],
    ]);
    expect(woodRecords(daily).map((r) => r.day)).toEqual(['2025-01-01']);
  });
  it('purchaseText : le résineux', () => {
    expect(sp(purchaseText(oak('2025-01-01', { species: 'resineux' })))).toBe('2 stères de résineux à 20 %');
  });
  const ws = (over: Partial<WoodSeason>): WoodSeason => ({ season: 2024, bought: 0, carried: 0, steres: 0, kwh: 0, eur: 0, left: 0, reading: null, short: 0, over: 0, ...over });
  it('seasonText : rien acheté ni reporté, deux décimales au plus, pluriels', () => {
    expect(seasonText(ws({}))).toBe('0 stère acheté · tout brûlé (supposé)');
    expect(seasonText(ws({ carried: 1.234 }))).toBe('1,23 stère reporté · tout brûlé (supposé)');
    expect(seasonText(ws({ carried: 2, steres: 1.5, left: 0.5, reading: { season: 2024, steres: 1.5 } }))).toBe('2 stères reportés · 1,5 stère brûlé (relevé) · reste 0,5 stère');
    expect(seasonText(ws({ bought: 1, short: 2, reading: { season: 2024, steres: 3 }, steres: 1 }))).toBe('1 stère acheté · 1 stère brûlé (relevé) · 2 stères de plus que les achats notés, non comptés');
    expect(seasonText(ws({ bought: 1, over: 1, reading: { season: 2024, left: 2 } }))).toBe(
      '1 stère acheté · 0 stère brûlé (stock relevé au printemps) · stock relevé : 1 stère de plus que les achats notés, non compté',
    );
    expect(seasonText(ws({ bought: 1, over: 2, reading: { season: 2024, left: 3 } }))).toBe(
      '1 stère acheté · 0 stère brûlé (stock relevé au printemps) · stock relevé : 2 stères de plus que les achats notés, non comptés',
    );
  });
});
