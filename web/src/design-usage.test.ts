// #317 (S-7.25, étape 5): the views and style sheets only use the design system. Two guards on
// the real files (read from disk, like tokens.test.ts):
// 1. no colour and no font size outside the tokens (styles/tokens*.css) in the style sheets and
//    the views — the few exceptions are listed in ALLOWED below, each with its reason;
// 2. none of the old message and on/off classes comes back (`.notice`, `.stale`, `.error`,
//    `.ok`, `.ko`, `.toggle`, `.check`, `.settings-msg`): alert() / alertHtml(), switchField(),
//    radioField() and formMsg() of components.ts replace them.
import { describe, expect, it } from 'vitest';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const src = new URL('./', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, src), 'utf8');
const list = (dir: string, ext: string) =>
  readdirSync(new URL(dir, src))
    .filter((f) => f.endsWith(ext) && !f.endsWith('.test.ts'))
    .map((f) => `${dir}${f}`);

/** Every style sheet of the app except the token files themselves. */
const CSS = list('', '.css');
/** Every module that writes markup or styles: the views and the shell. */
const TS = [...list('', '.ts'), ...list('views/', '.ts')];

const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Declarations `property: value` of a style sheet (selectors and @media conditions left out). */
function declarations(css: string): { prop: string; value: string }[] {
  const out: { prop: string; value: string }[] = [];
  for (const m of stripCss(css).matchAll(/([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) out.push({ prop: m[1], value: m[2].trim() });
  return out;
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const NAMED = /\b(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|silver|navy)\b/;
/** A colour literal in a declaration value (a token, transparent, currentColor or a system colour pass). */
const colourLiteral = (value: string) => HEX.test(value) || FUNC.test(value) || NAMED.test(value.replace(/var\([^)]*\)/g, ''));
/** A font size built from tokens only: var(--font-…), possibly bounded by viewport units. */
const tokenFontSize = (value: string) =>
  value === 'inherit' || /^[\s,()]*$/.test(value.replace(/var\(--font-[a-z0-9-]+\)/g, '').replace(/\b(?:min|max|clamp)\(/g, '(').replace(/\d+(?:\.\d+)?vw/g, ''));

/**
 * The exceptions, kept short. `file` + exact literal; the test fails if one is no longer used,
 * so the list cannot grow stale.
 */
const ALLOWED: { file: string; literal: string; why: string }[] = [
  { file: 'style.css', literal: 'font: 100%/1.5 system-ui', why: 'base size of the page: 100 % of the system text size, the root of every --font-* (rem)' },
  { file: 'style.css', literal: 'font: -apple-system-body', why: 'iPhone: the Dynamic Type size of the system' },
  { file: 'manifest.ts', literal: "'#f9f9f8'", why: 'theme colour of the web app manifest: a literal (= --sand-2, checked by manifest.test.ts)' },
  { file: 'qr.ts', literal: 'fill="#fff"', why: 'a QR code stays black on white to be read, whatever the theme' },
  { file: 'qr.ts', literal: 'fill="#000"', why: 'a QR code stays black on white to be read, whatever the theme' },
  { file: 'charts.ts', literal: "'rgba(255,255,255,0.55)'", why: 'ECharts takes resolved colours: pattern ink of high contrast (dark)' },
  { file: 'charts.ts', literal: "'rgba(0,0,0,0.5)'", why: 'ECharts takes resolved colours: pattern ink of high contrast (light)' },
  { file: 'charts.ts', literal: "'rgba(255,255,255,0.7)'", why: 'ECharts: fallback of the hatch colour when --surface-card cannot be read' },
  { file: 'chart-theme.ts', literal: "'rgba(128,128,128,0.12)'", why: 'ECharts: shadow of the axis pointer, the same grey in every theme' },
];
const allowed = (file: string, text: string) => ALLOWED.some((a) => a.file === file && text.includes(a.literal));

/** Colour or font-size literals of the app outside the tokens: `file: text`. */
export function offTokenUses(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.css')) {
      for (const { prop, value } of declarations(text)) {
        const line = `${prop}: ${value}`;
        if (allowed(file.split('/').pop()!, line)) continue;
        if (colourLiteral(value)) found.push(`${file}: ${line}`);
        else if (prop === 'font-size' && !tokenFontSize(value)) found.push(`${file}: ${line}`);
        else if (prop === 'font' && value !== 'inherit') found.push(`${file}: ${line}`);
      }
    } else {
      const code = stripTs(text);
      // colour literals in strings (a CSS colour, an SVG fill, an inline style)
      const lits = [...code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[0]);
      for (const lit of lits) {
        for (const m of lit.matchAll(/(?<=[:=('"`,]\s?)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=['"`;\s])|\b(?:rgba?|hsla?)\([^)]*\)/g)) {
          const at = lit.indexOf(m[0]);
          const ctx = lit.slice(Math.max(0, at - 6), at + m[0].length + 1);
          if (!allowed(file.split('/').pop()!, ctx) && !allowed(file.split('/').pop()!, lit)) found.push(`${file}: ${ctx}`);
        }
      }
      // a font size written in a view (inline style) is a token too
      for (const m of code.matchAll(/font-size\s*:\s*([^;"'`]+)/g)) if (!tokenFontSize(m[1].replace(/\$\{[^}]*\}/g, 'var(--font-x)').trim())) found.push(`${file}: font-size:${m[1]}`);
    }
  }
  return found;
}

/** The old classes: none may be set by a view, nor styled by a sheet. */
export const OLD_CLASSES = ['notice', 'stale', 'error', 'ok', 'ko', 'toggle', 'check', 'settings-msg'];

/** Old classes set by a view (`class="…"`, className, classList) or styled by a sheet: `file: class`. */
export function oldClassUses(files: Record<string, string>): string[] {
  const found: string[] = [];
  const old = new Set(OLD_CLASSES);
  /** `ok` is still the « good » state of a pill (`.pill.ok`, comfort pill of piece.ts). */
  const bad = (tokens: string[]) => tokens.filter((t) => old.has(t) && !(t === 'ok' && tokens.includes('pill')));
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.css')) {
      const names = OLD_CLASSES.join('|');
      for (const m of stripCss(text).matchAll(new RegExp(`(\\.pill)?\\.(${names})(?![\\w-])`, 'g'))) if (!(m[1] && m[2] === 'ok')) found.push(`${file}: .${m[2]}`);
      continue;
    }
    const code = stripTs(text);
    for (const m of code.matchAll(/class="([^"]*)"/g)) {
      // static words, plus the words its ${…} parts may give (`${ok ? 'ok' : 'ko'}`, not a compared value)
      const chunks = [m[1].replace(/\$\{[^}]*\}/g, ' '), ...[...m[1].matchAll(/(?:[?:]|\|\||&&)\s*'([^']*)'/g)].map((q) => q[1])];
      for (const c of chunks) for (const t of bad(c.split(/\s+/).filter(Boolean))) found.push(`${file}: class="${t}"`);
    }
    for (const m of code.matchAll(/classList\.(?:add|toggle|replace)\(\s*'([^']+)'|className\s*=\s*['`]([^'`]*)['`]/g)) {
      for (const t of bad((m[1] ?? m[2]).split(/\s+/))) found.push(`${file}: ${t} (classList / className)`);
    }
  }
  return found;
}

const files = Object.fromEntries([...CSS, ...TS].map((f) => [f, read(f)]));

describe('design system usage (#317)', () => {
  it('no colour and no font size outside the tokens in the style sheets and the views', () => {
    expect(offTokenUses(files)).toEqual([]);
  });

  it('every exception of the list is still used (the list does not grow stale)', () => {
    for (const a of ALLOWED) {
      const text = Object.entries(files).find(([f]) => f.split('/').pop() === a.file)?.[1] ?? '';
      expect(text.includes(a.literal), `${a.file}: ${a.literal}`).toBe(true);
    }
  });

  it('no old message or on / off class comes back', () => {
    expect(oldClassUses(files)).toEqual([]);
  });

  it('the guards see what they guard (a literal, an old class)', () => {
    expect(offTokenUses({ 'x.css': '.a { color: #fff; }' })).toEqual(['x.css: color: #fff']);
    expect(offTokenUses({ 'x.css': '.a { background: rgb(0 0 0 / 0.4); }' })).toHaveLength(1);
    expect(offTokenUses({ 'x.css': '.a { font-size: 1.5rem; }' })).toHaveLength(1);
    expect(offTokenUses({ 'x.css': '.a { font-size: min(var(--font-md), 7vw); color: var(--text); white-space: nowrap; }' })).toEqual([]);
    expect(offTokenUses({ 'views/x.ts': 'const a = `<h3 style="font-size:0.95rem">`;' })).toHaveLength(1);
    expect(offTokenUses({ 'views/x.ts': "const a = '<i style=\"color:#c00;\">'; // #214" })).toHaveLength(1);
    expect(offTokenUses({ 'views/x.ts': "const a = 'issue #214'; // #c00" })).toEqual([]);
    expect(oldClassUses({ 'views/x.ts': 'const a = `<p class="notice">`;' })).toEqual(['views/x.ts: class="notice"']);
    expect(oldClassUses({ 'views/x.ts': "const a = `<p class=\"msg ${ok ? 'ok' : 'ko'}\">`;" })).toHaveLength(2);
    expect(oldClassUses({ 'views/x.ts': 'const a = `<label class="toggle"><input type="checkbox">`;' })).toHaveLength(1);
    expect(oldClassUses({ 'views/x.ts': "el.classList.add('stale');" })).toHaveLength(1);
    expect(oldClassUses({ 'views/x.ts': 'const a = `<span class="pill ok">`;' })).toEqual([]);
    expect(oldClassUses({ 'x.css': '.check input { width: 1px; }\n.pill.ok { color: var(--x); }\n.lazy-error {}' })).toEqual(['x.css: .check']);
  });
});
