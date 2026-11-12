import { describe, expect, it } from 'vitest';
import { type DayRecord, addDays, bucketKeys, cumulativeByYear, dayOfYear, leapDayIndex } from './aggregate';
import { projectYear, verdict } from './analysis';
import { coldWinterDays } from './comfort';
import { budgetStatus } from './money';
import { bucketMarks, daysBetween, monthKeys, monthsCovered, windowSuffix, yoyCaveat, yoyWindow } from './periods';
import { summarize } from './summary';

// Intl fr-FR groups thousands with a narrow no-break space: compare on plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const rec = (day: string, kwh: number, room = 'r1'): DayRecord => ({ day, room, cat: 'heating', kwh });
const days = (from: string, to: string, f: (d: string) => number, room = 'r1') => {
  const out: DayRecord[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(rec(d, f(d), room));
  return out;
};
// Realistic monthly profile (kWh per day): 40 in January, 1 in summer.
const PROFILE = [40, 35, 25, 12, 4, 1, 1, 1, 3, 10, 25, 35];
const perDay = (d: string) => PROFILE[Number(d.slice(5, 7)) - 1];

describe('#245 cumulative on a leap-year axis', () => {
  it('puts 1 March at index 60 in every year, 29 Feb repeating 28 Feb in a non-leap year', () => {
    expect(leapDayIndex('2025-03-01')).toBe(60);
    expect(leapDayIndex('2024-03-01')).toBe(60);
    expect(leapDayIndex('2024-02-29')).toBe(59);
    expect(leapDayIndex('2025-12-31')).toBe(365);
    const c = cumulativeByYear(days('2025-01-01', '2025-12-31', () => 1), '2026-11-08');
    expect(c.get(2025)![58]).toBe(59); // 28 Feb
    expect(c.get(2025)![59]).toBe(59); // « 29 Feb »: no day, same total
    expect(c.get(2025)![60]).toBe(60); // 1 Mar
    expect(c.get(2025)![365]).toBe(365); // the year's total on 31 Dec (audit: was on « 30 déc. »)
  });
  it('stops the running year on its last day, on the right label (audit: 5 273 kWh at « 7 nov. »)', () => {
    const c = cumulativeByYear(days('2026-01-01', '2026-11-08', () => 1), '2026-11-08');
    const label = (i: number) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    };
    const lastIdx = c.get(2026)!.findLastIndex((v) => v !== null);
    expect(label(lastIdx)).toBe('8/11');
    expect(c.get(2026)![lastIdx]).toBe(dayOfYear('2026-11-08') + 1);
  });
  it('breaks the line on lost days and starts the first year with the data (#297)', () => {
    const recs = days('2024-06-01', '2024-12-31', () => 2).filter((r) => r.day !== '2024-06-10');
    const c = cumulativeByYear(recs, '2025-01-01', new Set(['2024-06-10']));
    expect(c.get(2024)![leapDayIndex('2024-05-31')]).toBeNull();
    expect(c.get(2024)![leapDayIndex('2024-06-10')]).toBeNull();
    expect(c.get(2024)![leapDayIndex('2024-06-11')]).toBe(20);
  });
});

describe('#240 projection and verdict with a partial first year', () => {
  // Data from 1 June 2024 to 9 November 2025 (issue: projection 13 789 kWh for ≈ 6 600).
  const recs = days('2024-06-01', '2025-11-09', perDay);
  it('ignores a previous year that does not start on 1 January', () => {
    expect(projectYear(recs, '2025-11-09')).toBeNull();
    // the old behaviour used 2024 anyway: more than twice the real year
    const old = projectYear(recs, '2025-11-09', '0000-01-01')!;
    const real = days('2025-01-01', '2025-12-31', perDay).reduce((s, r) => s + r.kwh, 0);
    expect(Math.round(real)).toBe(5806);
    expect(Math.round(old.projected)).toBe(13618); // before the fix: 2.3 times the real year
  });
  it('keeps the full previous years', () => {
    const full = days('2023-01-01', '2025-11-09', perDay);
    const p = projectYear(full, '2025-11-09')!;
    const real = days('2025-01-01', '2025-12-31', perDay).reduce((s, r) => s + r.kwh, 0);
    expect(p.basis).toBe(2);
    expect(Math.abs(p.projected - real) / real).toBeLessThan(0.01); // 2024 has a 29 February
  });
  it('drops a reference month covered only in part (first anniversary)', () => {
    const r = days('2024-11-15', '2025-11-09', perDay);
    expect(verdict(r, '2025-11-01', '2025-11-09', null)).toBeNull();
    const r2 = days('2024-10-15', '2025-11-09', perDay);
    expect(verdict(r2, '2025-11-01', '2025-11-09', null)!.level).toBe('normal');
  });
});

describe('#244 budget prorata counts the last day', () => {
  it('2 January: two days paid out of 365', () => {
    const b = budgetStatus(1000, 10, 0, null, dayOfYear('2026-01-02') + 1, 365);
    expect(b.projected).toBeCloseTo((10 * 365) / 2);
  });
  it('31 December: the projection is the spending', () => {
    const b = budgetStatus(1000, 900, 0, null, dayOfYear('2026-12-31') + 1, 365);
    expect(b.projected).toBeCloseTo(900);
  });
});

describe('#246 months covered', () => {
  it('report of the running year: 1 221 € over 312 days is ≈ 119 € a month, not 102', () => {
    expect(daysBetween('2026-01-01', '2026-11-08')).toBe(312);
    const m = monthsCovered('2026-01-01', '2026-11-08');
    expect(m).toBeCloseTo(10.25, 2);
    expect(Math.round(1221 / m)).toBe(119);
    expect(Math.round(1221 / 12)).toBe(102); // the old figure
  });
  it('first year started in June: 7 months, not 12', () => {
    expect(monthsCovered('2024-06-01', '2024-12-31')).toBeCloseTo(7, 0);
  });
});

describe('#297 partial buckets and lost days', () => {
  it('12 months by year: « 2025 » is 53 days out of 365', () => {
    const m = bucketMarks(['2025', '2026'], 'year', '2025-11-09', '2026-11-08');
    expect(m[0]).toMatchObject({ covered: 53, length: 365, partial: true });
    expect(m[0].note).toBe('53 jours sur 365 (du 9 nov. au 31 déc.)');
    expect(m[1]).toMatchObject({ covered: 312, partial: true });
  });
  it('30 days by week: « sem. du 5 oct. » is 2 days out of 7', () => {
    const keys = bucketKeys('2026-10-10', '2026-11-08', 'week');
    const m = bucketMarks(keys, 'week', '2026-10-10', '2026-11-08');
    expect(keys[0]).toBe('2026-10-05');
    expect(m[0].note).toBe('2 jours sur 7 (du 10 oct. au 11 oct.)');
    expect(m[1].partial).toBe(false);
  });
  it('the current month: « nov. 2026 » is 8 days out of 30', () => {
    const m = bucketMarks(monthKeys(2026), 'month', '2022-01-01', '2026-11-08');
    expect(m[10].note).toBe('8 jours sur 30 (du 1er nov. au 8 nov.)');
    expect(m[11]).toMatchObject({ covered: 0, partial: false, note: null });
    expect(m[9].note).toBeNull();
  });
  it('lost days are flagged at the month and year level (févr. 2024: 18 days)', () => {
    const lost = new Set(Array.from({ length: 18 }, (_, i) => `2024-02-${String(i + 12).padStart(2, '0')}`));
    const m = bucketMarks(monthKeys(2024), 'month', '2022-01-01', '2026-11-08', lost);
    expect(m[1]).toMatchObject({ uncertain: 18, partial: false });
    expect(m[1].note).toBe('18 jours estimés ou manquants');
    expect(bucketMarks(['2024'], 'year', '2022-01-01', '2026-11-08', lost)[0].uncertain).toBe(18);
  });
  it('months across a DST change are whole calendar days (TZ independent)', () => {
    const m = bucketMarks(['2026-03', '2026-10'], 'month', '2026-01-01', '2026-12-31');
    expect(m.map((x) => [x.length, x.partial])).toEqual([
      [31, false],
      [31, false],
    ]);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(3);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(3);
  });
  it('year over year on the same window when the previous year started late', () => {
    const w = yoyWindow(2025, '2024-06-01', '2026-11-08')!;
    expect(w).toMatchObject({ from: '2025-06-01', to: '2025-12-31', prevFrom: '2024-06-01', prevTo: '2024-12-31', cut: true });
    expect(windowSuffix(w)).toBe(' (depuis le 1er juin)');
    expect(yoyWindow(2024, '2024-06-01', '2026-11-08')).toBeNull();
    const cur = yoyWindow(2026, '2022-01-01', '2026-11-08')!;
    expect(cur).toMatchObject({ from: '2026-01-01', to: '2026-11-08', prevTo: '2025-11-08', cut: false });
    expect(windowSuffix(cur)).toBe(' (au 8 nov.)');
    expect(windowSuffix(yoyWindow(2025, '2022-01-01', '2026-11-08'))).toBe('');
  });
  it('a percentage on a period with lost days says so (« 2025 +12 % » vs 2024)', () => {
    const lost = new Set(['2024-02-12', '2024-02-13', '2024-11-03']);
    const w = yoyWindow(2025, '2022-01-01', '2026-11-08');
    expect(yoyCaveat(w, lost)).toBe('2024 : 3 jours estimés ou manquants');
    expect(yoyCaveat(w, new Set())).toBe('');
    expect(yoyCaveat(yoyWindow(2025, '2024-06-01', '2026-11-08'), new Set())).toBe('même période (du 1er juin au 31 déc.)');
  });
});

// #495: the survivors of the mutation run on periods.ts that change a result (the others are
// written « équivalent » in docs/bmad/06-qa-strategy.md).
describe('#495 periods.ts, survivors of the mutation', () => {
  it('data that started more than a year before: the window starts on 1 January, whatever its day', () => {
    // a first day in mid-June several years back is not a late start of the previous year
    expect(yoyWindow(2026, '2020-06-15', '2026-11-08')).toMatchObject({ from: '2026-01-01', cut: false });
  });

  it('the cut days (#394) on each side of the window, its first and last day included, named by cause', () => {
    const w = yoyWindow(2026, '2020-06-15', '2026-11-08')!;
    const cuts = new Map<string, 'power' | 'internet'>([
      ['2026-01-01', 'power'], // first day of the window
      ['2026-11-08', 'power'], // last day
      ['2026-11-09', 'internet'], // after: not counted
      ['2025-01-01', 'internet'], // first day of the year before
      ['2025-11-08', 'internet'], // its last day
      ['2025-11-09', 'power'], // after it: not counted
      ['2024-12-31', 'power'], // before it: not counted
    ]);
    expect(yoyCaveat(w, new Set(), { cuts })).toBe('à date · 2026 : 2 jours de coupure de courant · 2025 : 2 jours de coupure Internet');
    // both causes in one year
    expect(yoyCaveat(w, new Set(), { cuts: new Map([['2026-03-01', 'power'], ['2026-03-02', 'internet']]) })).toBe('à date · 2026 : 2 jours de coupure (courant, Internet)');
    expect(yoyCaveat(w, new Set())).toBe('à date');
  });
});

describe('#295 screen-reader summaries by kind of measure', () => {
  const labels = ['1 janv.', '2 janv.', '3 janv.'];
  it('a cumulative series gives the value reached, not the sum of the running total', () => {
    const [s] = summarize(labels, [{ name: '2024', data: [100, 250, null], measure: 'last' }]);
    expect(plain(s)).toBe('2024 : 250 kWh au 2 janv.');
  });
  it('a season cumulated by month ends « à fin août », the running one at its last day', () => {
    const [a, b] = summarize(['sept.', 'oct.'], [
      { name: '2024–2025', data: [10, 30], measure: 'last' },
      { name: '2026–2027', data: [12, null], measure: 'last', lastLabel: '8 nov.' },
    ]);
    expect(a).toBe('2024–2025 : 30 kWh à fin oct.');
    expect(b).toBe('2026–2027 : 12 kWh au 8 nov.');
  });
  it('a power gives its peak (no « total 195 kVA »)', () => {
    const [s] = summarize(labels, [{ name: 'Puissance max atteinte', data: [6.2, 9.8, 7] }], 'kVA');
    expect(plain(s)).toBe('Puissance max atteinte : maximum 9,8 kVA (2 janv.)');
  });
  it('energy is summed on the raw values (8 129, not 8 130 from rounded months)', () => {
    const raw = [2709.4, 2709.4, 2710.4];
    const [s] = summarize(labels, [{ name: '2025', data: raw.map(Math.round), raw }]);
    expect(plain(s)).toMatch(/^2025 : total 8 129 kWh/);
  });
  it('temperatures keep their mean', () => {
    const [s] = summarize(labels, [{ name: 'Salon', data: [19, 20, 21] }], '°C');
    expect(plain(s)).toBe('Salon : moyenne 20 °C, maximum 21 °C (3 janv.)');
  });
});

describe('#294 one definition of a cold day', () => {
  // Winter 2025-2026: means of the day; January–March 2026 and November 2026 belong to two winters
  const means: [string, number][] = [
    ['2025-11-10', 18.5],
    ['2026-01-05', 18.9],
    ['2026-01-06', 19.4],
    ['2026-03-31', 18],
    ['2026-04-01', 17], // spring: outside
    ['2026-11-02', 18], // next winter
  ];
  it('counts days whose mean is under the threshold, from 1 November to 31 March', () => {
    expect(coldWinterDays(means, 2025, 19)).toEqual({ under: 3, n: 4 });
    expect(coldWinterDays(means, 2026, 19)).toEqual({ under: 1, n: 1 });
    expect(coldWinterDays([], 2025, 19)).toBeNull();
  });
});
