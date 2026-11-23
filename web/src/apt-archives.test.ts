// #671: the WebKit jobs keep the .deb archives of WebKit's dependencies in the Actions cache
// (scripts/apt-archives.mjs). Tested without network: the key, and the order of the steps in each
// WebKit job of ci.yml (restored before the installation, saved after it, the same folder and key
// on both sides). Seen red: with the restore moved after the installation; with the save of one job
// on another folder; with the image version missing from the key.
import { describe, expect, it } from 'vitest';

const { cacheKey, DIR } = (await import(/* @vite-ignore */ new URL('../../scripts/apt-archives.mjs', import.meta.url).href)) as {
  cacheKey: (o: { imageOS?: string; imageVersion?: string; playwright?: string }) => { key: string; prefix: string };
  DIR: string;
};
const fsName = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (u: URL, enc: 'utf8') => string };
const CI = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** The body of each job of ci.yml whose name starts with `e2e-webkit`. */
const webkitJobs = [...CI.matchAll(/^ {2}(e2e-webkit[\w-]*):\s*\n((?: {4}.*\n|\s*\n)*)/gm)].map(([, name, body]) => ({ name, body }));

describe('cache des archives apt de WebKit (#671)', () => {
  it("la clé tient l'image du runner et la version de Playwright ; le préfixe, sans la version de l'image", () => {
    const { key, prefix } = cacheKey({ imageOS: 'ubuntu26', imageVersion: '20261116.88.1', playwright: '1.63.0' });
    expect(key).toBe('apt-webkit-ubuntu26-playwright-1.63.0-20261116.88.1');
    expect(prefix).toBe('apt-webkit-ubuntu26-playwright-1.63.0-');
    expect(key.startsWith(prefix)).toBe(true);
    expect(cacheKey({ imageOS: 'ubuntu26', imageVersion: '20261123.1', playwright: '1.63.0' }).key).not.toBe(key);
    expect(cacheKey({ imageOS: 'ubuntu26', imageVersion: '20261116.88.1', playwright: '1.64.0' }).key).not.toBe(key);
  });

  it('une clé ne se forme pas sans image ni version (hors des runners de GitHub)', () => {
    expect(() => cacheKey({ imageOS: undefined, imageVersion: '1', playwright: '1.63.0' })).toThrow(/imageOS/);
    expect(() => cacheKey({ imageOS: 'ubuntu26', imageVersion: '', playwright: '1.63.0' })).toThrow(/imageVersion/);
    expect(() => cacheKey({ imageOS: 'ubuntu26', imageVersion: '1', playwright: '1.63.0\nkey=x' })).toThrow(/playwright/);
  });

  it('chaque job WebKit : clé, reprise, installation, puis sauvegarde, sur le même dossier et la même clé', () => {
    expect(webkitJobs.map((j) => j.name)).toEqual(['e2e-webkit', 'e2e-webkit-parcours']);
    const order = [
      'apt-archives.mjs cle',
      'actions/cache/restore@',
      'apt-archives.mjs avant',
      'npx playwright install --with-deps webkit',
      'apt-archives.mjs apres',
      'actions/cache/save@',
    ];
    for (const { name, body } of webkitJobs) {
      const at = order.map((s) => body.indexOf(s));
      expect(at.every((i) => i >= 0), `${name} : ${order.filter((_, k) => at[k] < 0)}`).toBe(true);
      expect([...at].sort((a, b) => a - b), name).toEqual(at);
      const caches = [...body.matchAll(/^ {6}- uses: actions\/cache\/\w+@\S+\n((?: {8,}.*\n)*)/gm)].map((m) => m[1]);
      const folders = caches.map((c) => /^ {10}path: (\S+)\s*$/m.exec(c)?.[1]);
      expect(folders, name).toEqual(['~/apt-archives', '~/apt-archives']);
      expect(DIR.endsWith('/apt-archives'), DIR).toBe(true);
      const keys = caches.map((c) => /^ {10}key: (.+?)\s*$/m.exec(c)?.[1]);
      expect(keys, name).toEqual(['${{ steps.apt-cle.outputs.key }}', '${{ steps.apt-cle.outputs.key }}']);
      // Saved only when the exact key was missing (a cache entry cannot be overwritten).
      const guarded = body.match(/^ {8}if: steps\.apt-cache\.outputs\.cache-hit != 'true'\s*$/gm) ?? [];
      expect(guarded.length, name).toBe(2);
    }
  });

  it("le job e2e (celui de la porte) n'y touche pas : la porte ne lance rien qui demande sudo", () => {
    const e2e = /^ {2}e2e:\s*\n((?: {4}.*\n|\s*\n)*)/m.exec(CI)?.[1] ?? '';
    expect(e2e).toContain('npx playwright install --with-deps chromium');
    expect(e2e).not.toContain('apt-archives');
  });
});
