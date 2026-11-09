// #310: every text / surface pair of the design tokens passes WCAG AA (4.5:1) in light and
// dark, AAA (7:1) in high contrast; graphical colours (usages, rooms, years, accent, focus,
// field outlines) reach 3:1 on the cards (WCAG 1.4.11). Reads the real CSS files.
import { afterAll, describe, expect, it } from 'vitest';

// Read from disk: vitest stubs CSS imports (even ?raw). No @types/node in this project.
const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const read = (f: string) => readFileSync(new URL(`./styles/${f}`, import.meta.url), 'utf8');
const primitives = read('tokens.primitives.css');
const semantic = read('tokens.css');

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
const css = strip(primitives) + strip(semantic);

interface Rule {
  media: string[];
  selector: string;
  decls: Map<string, string>;
  order: number;
}

/** Flat list of the rules (selector, enclosing @media conditions, declarations). */
function parse(src: string): Rule[] {
  const rules: Rule[] = [];
  const stack: string[] = [];
  const kinds: ('media' | 'rule')[] = [];
  let buf = '';
  let current: Rule | null = null;
  for (const ch of src) {
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@media')) {
        stack.push(head.slice(6).trim());
        kinds.push('media');
      } else {
        current = { media: [...stack], selector: head, decls: new Map(), order: rules.length };
        kinds.push('rule');
      }
    } else if (ch === '}') {
      const kind = kinds.pop();
      if (kind === 'rule' && current) {
        for (const d of buf.split(';')) {
          const i = d.indexOf(':');
          if (i > 0 && d.trim().startsWith('--')) current.decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
        }
        rules.push(current);
        current = null;
      } else stack.pop();
      buf = '';
    } else buf += ch;
  }
  return rules;
}

interface Env {
  dark: boolean;
  contrast: boolean;
  theme?: 'light' | 'dark';
}
const mediaOk = (m: string, e: Env) =>
  m.split(/\)\s*and\s*\(/).every((c) => {
    const q = c.replace(/[()]/g, '').trim();
    if (q === 'prefers-color-scheme: dark') return e.dark;
    if (q === 'prefers-contrast: more') return e.contrast;
    throw new Error(`media non gérée : ${q}`);
  });
function selectorOk(s: string, e: Env): number | null {
  if (s === ':root') return 1;
  if (s === ":root:where(:not([data-theme='light']))") return e.theme === 'light' ? null : 1;
  if (s === ":root[data-theme='dark']") return e.theme === 'dark' ? 2 : null;
  throw new Error(`sélecteur non géré : ${s}`);
}

const RULES = parse(css);
function tokens(e: Env): Map<string, string> {
  const out = new Map<string, string>();
  RULES.map((r) => ({ r, spec: r.media.every((m) => mediaOk(m, e)) ? selectorOk(r.selector, e) : null }))
    .filter((x) => x.spec !== null)
    .sort((a, b) => a.spec! - b.spec! || a.r.order - b.r.order)
    .forEach(({ r }) => r.decls.forEach((v, k) => out.set(k, v)));
  return out;
}
function resolve(t: Map<string, string>, name: string, depth = 0): string {
  const v = t.get(name);
  if (v === undefined || depth > 10) throw new Error(`jeton inconnu ${name}`);
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(t, m[1], depth + 1) : v;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const THEMES: [string, Env][] = [
  ['clair', { dark: false, contrast: false }],
  ['sombre (système)', { dark: true, contrast: false }],
  ['sombre (data-theme)', { dark: false, contrast: false, theme: 'dark' }],
  ['clair forcé sur système sombre', { dark: true, contrast: false, theme: 'light' }],
  ['contraste élevé clair', { dark: false, contrast: true }],
  ['contraste élevé sombre (système)', { dark: true, contrast: true }],
  ['contraste élevé sombre (data-theme)', { dark: false, contrast: true, theme: 'dark' }],
];

const SURFACES = ['--surface-page', '--surface-card', '--surface-sunken', '--surface-raised'];
const TEXT_PAIRS: [string, string][] = [
  ...SURFACES.flatMap((s) => [['--text', s], ['--text-muted', s]] as [string, string][]),
  ['--accent-text', '--surface-card'],
  ['--accent-text', '--surface-page'],
  ['--accent-text', '--accent-soft'],
  ['--accent-ink', '--accent'],
  ['--accent-ink', '--accent-hover'],
  ['--usage-heating-text', '--surface-card'],
  ['--usage-water-text', '--surface-card'],
  ['--text', '--usage-heating-soft'],
  ['--text', '--usage-water-soft'],
  ['--text', '--state-warn-soft'],
  ...['good', 'warn', 'bad', 'info'].flatMap((s) => [
    [`--state-${s}`, '--surface-card'],
    [`--state-${s}`, '--surface-page'],
    [`--state-${s}`, `--state-${s}-soft`],
  ] as [string, string][]),
];
const GRAPHIC = [
  '--usage-heating',
  '--usage-water',
  '--accent',
  '--focus',
  '--border-strong',
  '--series-measure',
  '--year-0',
  ...Array.from({ length: 8 }, (_, i) => `--room-${i + 1}`),
];

/** Lowest ratio of each theme, printed at the end (npx vitest run src/tokens.test.ts). */
const report: string[] = [];
afterAll(() => console.log(`Contraste des jetons (#310)\n${report.join('\n')}`));

describe('jetons du design system (#310)', () => {
  for (const [name, env] of THEMES) {
    const t = tokens(env);
    const min = env.contrast ? 7 : 4.5;
    it(`${name} : textes ≥ ${min}:1`, () => {
      const fails: string[] = [];
      let lowest = Infinity;
      for (const [fg, bg] of TEXT_PAIRS) {
        const r = contrast(resolve(t, fg), resolve(t, bg));
        lowest = Math.min(lowest, r);
        if (r < min) fails.push(`${fg} sur ${bg} : ${r.toFixed(2)}`);
      }
      report.push(`${name} : texte ≥ ${lowest.toFixed(2)}:1`);
      expect(fails).toEqual([]);
    });
    it(`${name} : éléments graphiques ≥ 3:1 sur les cartes`, () => {
      const ratios = GRAPHIC.map((g) => [g, contrast(resolve(t, g), resolve(t, '--surface-card'))] as const);
      report.push(`${name} : graphiques ≥ ${Math.min(...ratios.map(([, r]) => r)).toFixed(2)}:1`);
      const fails = ratios
        .filter(([, r]) => r < 3)
        .map(([g, r]) => `${g} : ${r.toFixed(2)}`);
      expect(fails).toEqual([]);
    });
  }
  it('les couleurs de pièces sont distinctes entre elles et des usages', () => {
    const t = tokens(THEMES[0][1]);
    const all = [...GRAPHIC.slice(-8), '--usage-heating', '--usage-water', '--year-0'].map((g) => resolve(t, g).toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});
