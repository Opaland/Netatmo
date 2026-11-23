// #638: « à climat égal » — the change of heating per degree day between two periods — is one
// rule (perDjuChange, ratioChange in aggregate.ts, beside pctChange), not six hand-written ratios with five guards
// (AGENTS.md §5). And the window around a marker is one rule too (markerWindow, works.ts).
import { MIN_DJU_SPAN, perDjuChange, ratioChange } from './aggregate';
import { describe, expect, it } from 'vitest';
import { markerWindow } from './works';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const src = new URL('./', import.meta.url);

/** The source files of the app (tests left out), with their text. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const dir of ['', 'views/'])
    for (const f of readdirSync(new URL(dir, src)))
      if (f.endsWith('.ts') && !f.endsWith('.test.ts')) out.push([dir + f, readFileSync(new URL(dir + f, src), 'utf8')]);
  return out;
}

describe('à climat égal et écart en % : une seule règle (#638, #677)', () => {
  it('aucun rapport « a / b − 1 » écrit à la main (ratioChange, perDjuChange)', () => {
    // `(x / y - 1) * 100`, whatever x and y are (a ratio of ratios included)
    const handWritten = /\/[^;\n]*-\s*1\)\s*\*\s*100/;
    const found = sources()
      .filter(([, text]) => handWritten.test(text))
      .map(([f]) => f);
    expect(found).toEqual([]);
  });

  // #677: the other way to write a change in %, `((a - b) / b) * 100`, is pctChange's own rule:
  // nowhere else. Whatever a and b are, as long as the denominator is the number subtracted.
  const handWrittenChange = /\(\(\s*[^()]+?\s-\s*([\w.]+)\s*\)\s*\/\s*\1\s*\)\s*\*\s*100/g;
  it('la garde voit « ((a − b) / b) * 100 », et pas une largeur ni une part', () => {
    const seen = (code: string) => (code.match(handWrittenChange) ?? []).length;
    expect(seen('pct: ((now - ref) / ref) * 100,')).toBe(1);
    expect(seen('signedPct(((w.now - w.ref) / w.ref) * 100)')).toBe(1);
    expect(seen('signedPct(((end - opts.start) / opts.start) * 100)')).toBe(1);
    expect(seen('const p = ((actual - expected)/expected)*100;')).toBe(1);
    expect(seen('width:${pctW(((b - a) / 24) * 100)}')).toBe(0); // a width in % of a day
    expect(seen('nf0.format((sum(yr, "heating") / Math.max(tot, 1)) * 100)')).toBe(0); // a share
    expect(seen('((Number(d.slice(8, 10)) - 1) / n) * 100')).toBe(0); // a position
    expect(seen('((a - b) / c) * 100')).toBe(0); // not a change: the denominator is not b
  });

  it('aucun « ((a − b) / b) * 100 » écrit à la main hors de pctChange', () => {
    const found = sources().flatMap(([f, text]) => (text.match(handWrittenChange) ?? []).map((m) => `${f}: ${m}`));
    expect(found).toEqual(['aggregate.ts: ((now - before) / before) * 100']);
    const rule = /export function pctChange\(now: number, before: number\): number \| null \{\n\s*return before > 0 \? \(\(now - before\) \/ before\) \* 100 : null;/;
    expect(sources().find(([f]) => f === 'aggregate.ts')?.[1]).toMatch(rule);
  });

  it('aucune fenêtre « marker ± windowDays » recopiée hors de markerWindow', () => {
    const copied = /addDays\(marker,\s*-\w+\)\s*</;
    expect(sources().filter(([, text]) => copied.test(text)).map(([f]) => f)).toEqual([]);
  });

  it('plus aucune fonction exportée ne s’appelle windowDays (deux règles sans rapport)', () => {
    expect(sources().filter(([, text]) => /export function windowDays\b/.test(text)).map(([f]) => f)).toEqual([]);
  });
});

describe('perDjuChange', () => {
  it('le chauffage par degré-jour, après sur avant, en %', () => {
    // 1 000 kWh for 100 DJU against 1 000 kWh for 125 DJU: 10 against 8 kWh per DJU, +25 %
    expect(perDjuChange(1000, 100, 1000, 125)).toBeCloseTo(25, 10);
    expect(perDjuChange(800, 100, 1000, 100)).toBeCloseTo(-20, 10);
  });

  it('rien quand l’avant n’a aucun kWh de chauffage : jamais « +∞ % » ni « NaN % »', () => {
    expect(perDjuChange(500, 900, 0, 900)).toBeNull();
    expect(perDjuChange(0, 900, 0, 900)).toBeNull();
  });

  it('rien sous le seuil de degrés-jours, de chaque côté, borne comprise', () => {
    expect(perDjuChange(500, MIN_DJU_SPAN, 500, 900)).toBeNull();
    expect(perDjuChange(500, 900, 500, MIN_DJU_SPAN)).toBeNull();
    expect(perDjuChange(500, MIN_DJU_SPAN + 1, 500, MIN_DJU_SPAN + 1)).toBeCloseTo(0, 10);
    // a month (Questions types) passes its own threshold
    expect(perDjuChange(50, 6, 50, 6, 5)).toBeCloseTo(0, 10);
    expect(perDjuChange(50, 5, 50, 6, 5)).toBeNull();
  });

  it('ratioChange : null d’un côté ou dénominateur nul, rien', () => {
    expect(ratioChange(12, 10)).toBeCloseTo(20, 10);
    expect(ratioChange(null, 10)).toBeNull();
    expect(ratioChange(12, null)).toBeNull();
    expect(ratioChange(12, 0)).toBeNull();
    expect(ratioChange(0, 10)).toBeCloseTo(-100, 10);
  });
});

describe('markerWindow', () => {
  it('n jours de chaque côté, le jour du repère compte après, bornés aux données', () => {
    expect(markerWindow('2025-06-01', '2020-01-01', '2030-12-31', 10)).toEqual({
      before: ['2025-05-22', '2025-05-31'],
      after: ['2025-06-01', '2025-06-10'],
    });
    expect(markerWindow('2025-06-01', '2025-05-28', '2025-06-03', 10)).toEqual({
      before: ['2025-05-28', '2025-05-31'],
      after: ['2025-06-01', '2025-06-03'],
    });
  });
});
