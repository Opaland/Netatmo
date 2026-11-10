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
  countedRows,
  expectedLabel,
  homePeriod,
  homeRange,
  moneyVerdict,
  monthTick,
  monthlyOutdoor,
  periodPhrase,
  restOfPeriod,
  scopeTitle,
  verdictHeadline,
} from './home';

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
});

describe('verdict in euros (#302: one named reference)', () => {
  const v = { level: 'normal' as const, pct: -7, actual: 170, expected: 184, climate: true };
  it('prices the expected kWh at the price paid', () => {
    const m = moneyVerdict(v, 32);
    expect(m.unit).toBe('€');
    expect(m.expected).toBeCloseTo((184 * 32) / 170, 6);
    expect(verdictHeadline(m)).toBe("3 € de moins que d'habitude");
  });
  it('stays in kWh without prices, says « comme d’habitude » under one unit', () => {
    expect(verdictHeadline(moneyVerdict(v, null))).toBe("14 kWh de moins que d'habitude");
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
    expect(changeText(-50, 'vs 2025 à date')).toBe('−50 % vs 2025 à date');
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
