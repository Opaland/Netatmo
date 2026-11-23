// Revue de code v3.0: the length of a year and the daily share of a yearly subscription are one
// rule (isLeapYear, daysInYear, dayShareOfYear in aggregate.ts), not five hand-written ones of which
// four were `% 4` (wrong in 2100: 365 days, not 366) (AGENTS.md §5).
import { describe, expect, it } from 'vitest';
import { daysInYear, dayShareOfYear, isLeapYear, leapDayIndex } from './aggregate';
import { type TempoRow, type TrveRow, compareOffers, subscriptionTrve } from './analysis';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const src = new URL('./', import.meta.url);

function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const dir of ['', 'views/'])
    for (const f of readdirSync(new URL(dir, src)))
      if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.push([dir + f, readFileSync(new URL(dir + f, src), 'utf8')]);
  return out;
}

describe('année bissextile : une seule règle (revue de code v3.0)', () => {
  it('la règle grégorienne : 2100 n’est pas bissextile, 2000 l’est', () => {
    expect([1900, 2000, 2024, 2025, 2100, 2400].map(isLeapYear)).toEqual([false, true, true, false, false, true]);
    expect(daysInYear('2100-07-14')).toBe(365);
    expect(daysInYear('2024-07-14')).toBe(366);
    expect(dayShareOfYear(732, '2024-03-01')).toBe(2);
    expect(dayShareOfYear(730, '2100-03-01')).toBe(2);
    expect(leapDayIndex('2100-03-01')).toBe(60); // the leap axis: 1 March is 60 in every year
  });

  it('un abonnement annuel compté jour par jour sur toute l’année 2100 vaut l’abonnement annuel', () => {
    const rows: TrveRow[] = [{ from: '2100-01-01', to: null, kva: 6, fixedYear: 365, hc: 0.1, hp: 0.2 }];
    expect(subscriptionTrve(rows, 6, '2100-01-01', '2100-12-31')).toBeCloseTo(365, 9);
  });

  it('le comparateur d’offres compte l’abonnement d’un jour de 2100 sur 365 jours', () => {
    const row = (fixedYear: number): TrveRow => ({ from: '2100-01-01', to: null, kva: 6, fixedYear, hc: 0.1, hp: 0.2 });
    const tempo: TempoRow[] = [{ from: '2100-01-01', to: null, kva: 6, fixedYear: 1095, prices: { 1: [0.1, 0.2], 2: [0.1, 0.2], 3: [0.1, 0.2] } }];
    const out = compareOffers([{ day: '2100-06-01', hc: 1, hp: 1 }], () => 6, [row(365)], [row(730)], tempo, new Map([['2100-06-01', 1]]));
    expect([out.base.subscription, out.hphc.subscription, out.tempo.subscription]).toEqual([1, 2, 3]);
  });

  it('aucune longueur d’année écrite à la main hors d’aggregate.ts', () => {
    const handWritten = /%\s*4\s*===?\s*0|\?\s*366\s*:\s*365/;
    const found = sources()
      .filter(([f, text]) => f !== 'aggregate.ts' && handWritten.test(text))
      .map(([f]) => f);
    expect(found).toEqual([]);
  });
});
