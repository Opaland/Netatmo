// #556: the height limits of the pages are written once, in e2e/hauteurs-limites.mjs, and read by
// the guard (e2e/features.mjs) and by the measuring script (e2e/hauteurs.mjs). A limit written
// again inline in an end-to-end script would drift from the one the table of the reviews reads.
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const e2e = new URL('../e2e/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, e2e), 'utf8');
type Limit = { issue: string; route: string; display: string; screens: number; of: string };
const { HEIGHT_LIMITS } = (await import(/* @vite-ignore */ new URL('hauteurs-limites.mjs', e2e).href)) as { HEIGHT_LIMITS: Limit[] };

describe('limites de hauteur des pages (#556)', () => {
  it('aucun script e2e ne réécrit une limite en ligne (« h <= 4 * écran »)', () => {
    const inline = readdirSync(e2e)
      .filter((f) => f.endsWith('.mjs') && f !== 'hauteurs-limites.mjs')
      .flatMap((f) => [...read(f).matchAll(/[<>]=?\s*\d+(?:\.\d+)?\s*\*\s*[A-Za-z_$]/g)].map((m) => `${f} : « ${m[0]} »`));
    expect(inline).toEqual([]);
  });

  it('features.mjs mesure les hauteurs par measureHeight, et chaque limite y est gardée', () => {
    const features = read('features.mjs');
    expect(features, 'features.mjs lit encore scrollHeight lui-même').not.toMatch(/scrollHeight/);
    const missing = HEIGHT_LIMITS.filter((l) => !features.includes(`measureHeight(`) || !new RegExp(`checkHeight\\(\\w+, '${l.route}', '${l.display}'\\)`).test(features));
    expect(
      missing.map((l) => `${l.issue} ${l.route} (${l.display})`),
      'limites sans garde dans features.mjs',
    ).toEqual([]);
  });

  it('les limites sont bien formées : une par page et par affichage, un nombre entier d’écrans', () => {
    const keys = HEIGHT_LIMITS.map((l) => `${l.route}/${l.display}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of HEIGHT_LIMITS) {
      expect(Number.isInteger(l.screens) && l.screens > 0, `${l.issue} : ${l.screens} écrans`).toBe(true);
      expect(['screen', 'viewport']).toContain(l.of);
      expect(['iphone', '360']).toContain(l.display);
    }
  });
});
