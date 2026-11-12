// #311 / #302: the figures of the new Accueil (home.ts), on small cases and on the demo
// (public/demo, last day 8 November 2026: the numbers of the maquette accueil.html).
import { beforeAll, describe, expect, it } from 'vitest';
import type { DayRecord } from './aggregate';
import { applyStopped, notComparable, offlineRuns, parseStopped } from './room-offline';
import { verdict } from './analysis';
import type { Dataset } from './data';
import { demoDataset } from './__fixtures__/demo';
import {
  HOME_PERIODS,
  changeText,
  countedLine,
  countedWhat,
  countedRows,
  expectedLabel,
  homePeriod,
  homeRange,
  type MoneyVerdict,
  leftOut,
  moneyVerdict,
  monthTick,
  monthlyOutdoor,
  periodPhrase,
  restOfPeriod,
  scopeTitle,
  WOOD_WORDS,
  heatVerdict,
  verdictHeadline,
  verdictWords,
} from './home';
import { WOOD_ROOM, parseWood, woodDaily, woodIn } from './wood';

const LAST = '2026-11-08';
const rec = (day: string, kwh: number, cat: DayRecord['cat'] = 'heating', room = 'r'): DayRecord => ({ day, kwh, cat, room }) as DayRecord;

describe('period of Accueil', () => {
  it('has the four choices of the maquette, a stale value falls back to the month', () => {
    expect(HOME_PERIODS.map(([, l]) => l)).toEqual(['Mois', 'Saison', '12 mois', 'Année']);
    expect(homePeriod('season')).toBe('season');
    expect(homePeriod('2025')).toBe('month');
    expect(homePeriod(undefined)).toBe('month');
  });

  it('month: the days of the month, the 12 months around it in the chart', () => {
    const r = homeRange('month', LAST);
    expect([r.from, r.to, r.end]).toEqual(['2026-11-01', LAST, '2026-11-30']);
    expect(r.months[0]).toBe('2025-11');
    expect(r.months.at(-1)).toBe('2026-11');
    expect(scopeTitle(r)).toBe('Novembre 2026, du 1er au 8 (8 jours sur 30)');
    expect(periodPhrase(r)).toBe('en novembre (au 8)');
  });

  it('season: September → August, whatever the month', () => {
    const r = homeRange('season', LAST);
    expect([r.from, r.end]).toEqual(['2026-09-01', '2027-08-31']);
    expect(r.months).toHaveLength(12);
    expect(scopeTitle(r)).toBe('Saison de chauffe 2026–2027, du 1er sept. au 8 nov. (69 jours sur 365)');
    expect(homeRange('season', '2026-03-02').from).toBe('2025-09-01');
  });

  it('12 months and year', () => {
    const t = homeRange('12m', LAST);
    expect([t.from, t.end]).toEqual(['2025-11-09', LAST]);
    expect(scopeTitle(t)).toBe('12 derniers mois, du 9 nov. 2025 au 8 nov. 2026');
    const y = homeRange('year', LAST);
    expect([y.from, y.end, y.months.length]).toEqual(['2026-01-01', '2026-12-31', 12]);
    expect(scopeTitle(y)).toBe('Année 2026, du 1er janv. au 8 nov. (312 jours sur 365)');
  });

  it('the line « ce qui est compté »', () => {
    expect(countedLine({ cat: 'all', rooms: 7, allRooms: 7, euros: true })).toBe('chauffage et eau chaude, hors abonnement');
    expect(countedLine({ cat: 'heating', rooms: 3, allRooms: 7, euros: false })).toBe('chauffage seul · 3 pièces sur 7, en kWh (prix à renseigner)');
  });

  it('#466: what a total counts, the words of the scope line', () => {
    for (const [cat, words] of [['all', 'chauffage et eau chaude'], ['heating', 'chauffage seul'], ['water_heater', 'eau chaude seule']]) {
      expect(countedWhat(cat)).toBe(words);
      expect(countedLine({ cat, rooms: 7, allRooms: 7, euros: true }).startsWith(words)).toBe(true);
    }
  });
});

describe('verdict in euros (#302: one named reference)', () => {
  const v = { level: 'normal' as const, pct: -7, actual: 170, expected: 184, climate: true };
  it('prices the expected kWh at the price paid', () => {
    const m = moneyVerdict(v, 32);
    expect(m.unit).toBe('€');
    expect(m.expected).toBeCloseTo((184 * 32) / 170, 6);
    expect(verdictHeadline(m)).toBe("3 € de moins que d'habitude");
  });
  it('stays in kWh without prices, says « comme d’habitude » under one unit', () => {
    expect(verdictHeadline(moneyVerdict(v, null))).toBe("14 kWh de moins que d'habitude");
    expect(verdictHeadline(moneyVerdict({ ...v, actual: 184.3 }, null))).toBe("Comme d'habitude");
    expect(verdictHeadline(moneyVerdict({ ...v, actual: 200 }, 40))).toMatch(/de plus que d'habitude$/);
  });
  it('names its reference', () => {
    expect(expectedLabel(true)).toBe('vs attendu à météo comparable');
    expect(expectedLabel(false)).toMatch(/^vs attendu/);
  });
});

describe('projection and what counted', () => {
  const records = [rec('2025-11-20', 10), rec('2025-11-25', 10), rec('2024-11-20', 30), rec('2026-11-02', 5)];
  it('the rest of the period as in the previous years, times the ratio (½ to 2)', () => {
    expect(restOfPeriod(records, '2026-11-08', '2026-11-30', '2024-01-01')).toBe(25);
    expect(restOfPeriod(records, '2026-11-08', '2026-11-30', '2024-01-01', 0.8)).toBe(20);
    expect(restOfPeriod(records, '2026-11-08', '2026-11-30', '2024-01-01', 10)).toBe(50);
    expect(restOfPeriod(records, '2026-11-08', '2026-11-30', '2026-01-01')).toBeNull();
    expect(restOfPeriod(records, '2026-11-30', '2026-11-30', '2024-01-01')).toBe(0);
  });
  it('rows sorted, with their share and change', () => {
    const val: Record<string, [number, number]> = { a: [10, 20], b: [30, 0], c: [0, 5] };
    const rows = countedRows(['a', 'b', 'c'], (id, from) => val[id][from.startsWith('2026') ? 0 : 1], '2026-01-01', LAST);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0].share).toBe(75);
    expect(rows[0].change).toBeNull();
    expect(rows[1].change).toBe(-50);
    expect(changeText(-50, 'vs 2025 à date')).toBe('−50 % vs 2025 à date');
    expect(changeText(null, 'vs 2025')).toMatch(/pas de comparaison/);
  });
  it('monthly outdoor mean, the axis ticks', () => {
    const w = new Map<string, [number, number, number]>([
      ['2026-10-01', [0, 10, 4]],
      ['2026-10-02', [0, 10, 6]],
      ['2026-11-09', [0, 10, 99]],
    ]);
    expect(monthlyOutdoor(w, ['2026-10', '2026-11'], LAST)).toEqual([5, null]);
    expect(monthlyOutdoor(null, ['2026-10'], LAST)).toEqual([null]);
    expect(['2025-11', '2025-12', '2026-01'].map(monthTick)).toEqual(['nov. 2025', 'déc.', 'janv. 2026']);
  });
});

describe('on the demo (maquette accueil.html)', () => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = await demoDataset();
  });
  it('the month: the kids’ bedroom offline is left out, the kitchen stove stays (#346)', () => {
    const records = ds.records.filter((r) => r.cat !== 'ignore');
    const r = homeRange('month', ds.meta.last_day!);
    // all rooms: the kitchen (stove) and, these last days, the kids' bedroom (out of reach) send nothing
    const raw = verdict(records, r.from, r.to, ds.weather)!;
    expect(Math.round(raw.actual)).toBe(138);
    expect(Math.round(raw.pct)).toBe(-22);
    // the kitchen is switched off on purpose (meta.stopped_rooms): a real fall, still compared;
    // the bedroom is out of reach: left out of the comparison (what the Accueil verdict shows)
    const runs = applyStopped(offlineRuns(ds.records, ds.meta.rooms, ds.meta.last_day!), parseStopped((ds.meta as { stopped_rooms?: unknown }).stopped_rooms));
    const left = notComparable(runs, r.from, r.to);
    expect([...left]).toEqual(['r-ch2']);
    const v = verdict(records.filter((x) => !left.has(x.room)), r.from, r.to, ds.weather)!;
    expect(Math.round(v.actual)).toBe(130);
    expect(Math.abs(v.pct)).toBeLessThan(Math.abs(raw.pct));
    expect(v.climate).toBe(true);
  });
});

// #383: the figures written in the verdict add up, whatever the rooms left out. The amounts are
// read back from the words, as a reader would redo the sum by hand.
describe('verdict words: one scope, figures that add up (#383)', () => {
  const num = (s: string) => Number(s.replace(/[\s  ]/g, '').replace('−', '-').replace(',', '.'));
  const figure = (s: string) => num(s.replace(/€|kWh/g, ''));
  /** Checks headline, spent, expected and % written against each other; returns the figures. */
  function written(m: MoneyVerdict, left: string[]) {
    const w = verdictWords(m, left, 'en novembre (au 8)', 'à météo comparable');
    const spent = figure(w.spent);
    const expected = figure(w.expectedAmount);
    expect(w.expected.startsWith(`${w.expectedAmount} attendus`)).toBe(true);
    const pct = num(/\(([−+]?[\d\s  ]+)\s%\)$/.exec(w.expected)![1]);
    const h = /^([\d\s  ]+)\s(?:€|kWh) de (moins|plus) que d'habitude$/.exec(w.headline);
    if (!h) expect(w.headline).toBe("Comme d'habitude");
    const gap = h ? num(h[1]) * (h[2] === 'moins' ? -1 : 1) : 0;
    // the gap written is the difference of the two amounts written
    expect(gap).toBe(spent - expected);
    // the % written is the one of the two amounts written (within their rounding to the unit)
    const lo = ((spent - 0.5) / (expected + 0.5) - 1) * 100;
    const hi = ((spent + 0.5) / Math.max(0.5, expected - 0.5) - 1) * 100;
    expect(pct).toBeGreaterThanOrEqual(Math.floor(lo));
    expect(pct).toBeLessThanOrEqual(Math.ceil(hi));
    // the rooms left out are named in the sentence of the amount spent
    for (const name of left) expect(w.spentRest).toContain(name);
    expect(w.spentRest.includes('hors ligne')).toBe(left.length > 0);
    return { w, spent, expected, pct, gap };
  }
  const PRICE = 0.1952;
  let ds: Dataset;
  let runs: ReturnType<typeof applyStopped>;
  beforeAll(async () => {
    ds = await demoDataset();
    runs = applyStopped(offlineRuns(ds.records, ds.meta.rooms, ds.meta.last_day!), parseStopped((ds.meta as { stopped_rooms?: unknown }).stopped_rooms));
  });
  /** The verdict of the Accueil over the month to `to`: the rooms not comparable left out of every figure. */
  function onDemo(to: string) {
    const r = homeRange('month', to);
    const left = notComparable(runs, r.from, r.to);
    const records = ds.records.filter((x) => x.cat !== 'ignore' && !left.has(x.room));
    const v = verdict(records, r.from, r.to, ds.weather)!;
    const kwh = records.reduce((s, x) => s + (x.day >= r.from && x.day <= r.to ? x.kwh : 0), 0);
    const names = [...left].map((id) => ds.meta.rooms.find((x) => x.id === id)!.name);
    return { m: moneyVerdict(v, kwh * PRICE), names, v };
  }

  it('a room offline (the demo month): left out of every figure, and named', () => {
    const { m, names, v } = onDemo(LAST);
    expect(names).toEqual(['Chambre enfant']);
    const f = written(m, names);
    expect(f.w.spentRest).toBe('(130 kWh) dépensés hors Chambre enfant, hors ligne, en novembre (au 8)');
    expect(Math.round(v.actual)).toBe(130);
    expect(f.gap).toBeLessThan(0);
  });
  it('a room switched off on purpose (the kitchen, October): compared, nothing left out', () => {
    const { m, names } = onDemo('2026-10-31');
    expect(names).toEqual([]);
    expect(written(m, names).w.spentRest).not.toMatch(/hors/);
  });
  it('no room left out, in euros and in kWh, above and under the reference', () => {
    for (const v of [
      { level: 'normal' as const, pct: -7.6, actual: 170, expected: 184, climate: true },
      { level: 'high' as const, pct: 21.5, actual: 243, expected: 200, climate: false },
      { level: 'normal' as const, pct: 0.2, actual: 184.3, expected: 184, climate: true },
      { level: 'low' as const, pct: -16.6, actual: 24.6, expected: 29.5, climate: true },
      { level: 'low' as const, pct: -17.6, actual: 24.4, expected: 29.6, climate: true }, // 24 and 30 written: 6, not 5.2 rounded
    ]) {
      for (const cost of [null, v.actual * PRICE, v.actual * 0.31]) written(moneyVerdict(v, cost), []);
    }
  });
  it('several rooms left out are listed « A, B et C »', () => {
    expect(leftOut(['A', 'B', 'C'])).toBe('hors A, B et C, hors ligne');
    expect(leftOut([])).toBe('');
  });
});

// #433 (decision of the owner, option A): with the stove of the demo (Cuisine switched off for it
// on 14 Oct. 2025, three fictitious purchases), the verdict compares the heating electricity +
// wood to the one expected: the heat moved to the stove no longer reads as a saving.
describe('verdict over electricity + wood (#433)', () => {
  const PRICE = 0.1952;
  let ds: Dataset;
  let daily: Map<string, [number, number]>;
  let records: DayRecord[];
  const r = homeRange('month', LAST);
  beforeAll(async () => {
    ds = await demoDataset();
    daily = woodDaily(parseWood((ds.meta as { wood?: unknown }).wood), ds.weather, LAST);
    const runs = applyStopped(offlineRuns(ds.records, ds.meta.rooms, LAST), parseStopped((ds.meta as { stopped_rooms?: unknown }).stopped_rooms));
    const left = notComparable(runs, r.from, r.to);
    records = ds.records.filter((x) => x.cat !== 'ignore' && !left.has(x.room));
  });
  const cost = () => records.reduce((s, x) => s + (x.day >= r.from && x.day <= r.to ? x.kwh : 0), 0) * PRICE;

  it('without wood: the verdict of the electricity alone, unchanged', () => {
    const h = heatVerdict(records, r.from, r.to, ds.weather, cost(), null);
    expect(h.v).toEqual(verdict(records, r.from, r.to, ds.weather));
    expect(h.m).toEqual(moneyVerdict(h.v!, cost()));
    expect(h.wood).toBeNull();
    expect(h.records).toBe(records);
  });
  it('the demo month: spent = electricity + wood, the wood of the reference years in the expected', () => {
    const elec = heatVerdict(records, r.from, r.to, ds.weather, cost(), null);
    const h = heatVerdict(records, r.from, r.to, ds.weather, cost(), daily);
    const wood = woodIn(daily, r.from, r.to);
    expect(wood.kwh).toBeGreaterThan(1);
    expect(h.wood).toEqual(wood);
    expect(h.v!.actual).toBeCloseTo(elec.v!.actual + wood.kwh, 6);
    expect(h.m!.actual).toBeCloseTo(cost() + wood.eur, 6);
    // November 2025 was already heated by the stove: its wood is in the expected too
    expect(h.v!.expected).toBeGreaterThan(elec.v!.expected);
    // the electricity alone reads as « 5 € de moins »; with the wood, as usual (the stove moved the heat)
    expect(elec.m!.level).toBe('low');
    expect(h.m!.level).toBe('normal');
    expect(Math.abs(h.v!.pct)).toBeLessThan(Math.abs(elec.v!.pct));
    // the wood as day records of heating, never before the first day of the electricity
    const first = records.reduce((a, x) => (!a || x.day < a ? x.day : a), '');
    const w = h.records.filter((x) => x.room === WOOD_ROOM);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.cat === 'heating' && x.day >= first)).toBe(true);
  });
  it('the sentence says « électricité + bois », the electricity alone keeps its words', () => {
    const h = heatVerdict(records, r.from, r.to, ds.weather, cost(), daily);
    const w = verdictWords(h.m!, [], 'en novembre (au 8)', 'à météo comparable', true);
    expect(WOOD_WORDS).toBe('d’électricité + bois');
    expect(w.spentRest).toMatch(/^d’électricité \+ bois \(\d+\skWh\) en novembre \(au 8\)$/);
    expect(verdictWords(h.m!, [], 'en novembre (au 8)', 'à météo comparable').spentRest).toMatch(/^\(\d+\skWh\) dépensés en novembre/);
    const kwhOnly = verdictWords(moneyVerdict(h.v!, null), [], 'en novembre (au 8)', 'à météo comparable', true);
    expect(kwhOnly.spentVerb).toBe(WOOD_WORDS);
  });
});
