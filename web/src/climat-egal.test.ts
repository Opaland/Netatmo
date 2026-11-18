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

describe('à climat égal : une seule règle (#638)', () => {
  it('aucun rapport « a / b − 1 » écrit à la main (ratioChange, perDjuChange)', () => {
    // `(x / y - 1) * 100`, whatever x and y are (a ratio of ratios included)
    const handWritten = /\/[^;\n]*-\s*1\)\s*\*\s*100/;
    const found = sources()
      .filter(([, text]) => handWritten.test(text))
      .map(([f]) => f);
    expect(found).toEqual([]);
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
