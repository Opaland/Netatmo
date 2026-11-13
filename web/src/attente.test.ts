// #579: a wait is announced to a screen reader. One wording (`loadingText`, components.ts), said
// through `waiting()` / `statusLine()` (role="status"), or inside a zone that is already announced
// (`aria-live`): guarded on the real files, like design-usage.test.ts (AGENTS.md § 5).
import { describe, expect, it } from 'vitest';
import { loadingText, statusLine, waiting } from './components';

const fsName = 'node:fs';
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ fsName)) as {
  readFileSync: (u: URL, enc: 'utf8') => string;
  readdirSync: (u: URL) => string[];
};
const src = new URL('./', import.meta.url);
const list = (dir: string) =>
  readdirSync(new URL(dir, src))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `${dir}${f}`);
const TS = [...list(''), ...list('views/')];
const code = (f: string) =>
  readFileSync(new URL(f, src), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/**
 * The modules that may call `loadingText` without `waiting()`, each because its text lands in a
 * zone that is announced already.
 */
const ANNOUNCED_ZONE: Record<string, string> = {
  'views/questions.ts': 'the answer zone is aria-live="polite" (« Questions types »)',
  'views/lock.ts': 'the unlock skeleton is aria-live="polite" and aria-busy',
  'views/linky.ts': 'the text of `loaded()` is drawn by statusLine() (Veille, Journée type)',
  'demo-composants.ts': 'passed to stateBlock(), role="status" and aria-busy',
};

describe('#579 : toute attente est annoncée', () => {
  it('« Chargement » n’est écrit que dans components.ts', () => {
    const elsewhere = TS.filter((f) => f !== 'components.ts' && /Chargement/.test(code(f)));
    expect(elsewhere).toEqual([]);
  });

  it('loadingText() ne sert hors de waiting() que dans une zone déjà annoncée', () => {
    const bare = TS.filter((f) => f !== 'components.ts' && /\bloadingText\(/.test(code(f)) && !(f in ANNOUNCED_ZONE));
    expect(bare).toEqual([]);
    for (const f of Object.keys(ANNOUNCED_ZONE)) expect(TS, f).toContain(f);
  });

  it('waiting() est lu par un lecteur d’écran et garde l’apparence d’avant', () => {
    expect(loadingText()).toBe('Chargement…');
    expect(loadingText('de la courbe de charge')).toBe('Chargement de la courbe de charge…');
    expect(waiting()).toBe('<p class="hint muted" role="status">Chargement…</p>');
    expect(waiting('', 'empty')).toBe('<p class="empty" role="status">Chargement…</p>');
    expect(waiting('de l’état des radiateurs', 's', 'span')).toBe('<span class="s" role="status">Chargement de l’état des radiateurs…</span>');
    expect(statusLine('Import <b>indisponible</b>.')).toBe('<p class="hint muted" role="status">Import &lt;b&gt;indisponible&lt;/b&gt;.</p>');
  });
});
