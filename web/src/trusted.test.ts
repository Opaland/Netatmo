import { describe, expect, it } from 'vitest';
import { guard, html, serviceWorkerUrl } from './trusted';

describe('Trusted Types (S-8.9)', () => {
  it('le gabarit assemble les morceaux et les valeurs', () => {
    expect(html`<p>${1} et ${'deux'}</p>`).toBe('<p>1 et deux</p>');
    expect(html('<b>x</b>')).toBe('<b>x</b>');
  });

  it('refuse le balisage exécutable', () => {
    for (const bad of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="//x"></iframe>',
      '<svg onload = "x">',
    ])
      expect(() => guard(bad), bad).toThrow(TypeError);
  });

  it('laisse passer le texte ordinaire et les attributs de l’application', () => {
    const ok = '<button type="button" data-view="overview" aria-current="page">Synthèse</button><p>onglet = 3 ; script</p>';
    expect(guard(ok)).toBe(ok);
  });

  it('n’autorise que le service worker du site comme script', () => {
    const base = 'https://opaland.github.io/Netatmo/';
    expect(serviceWorkerUrl('./sw.js', base)).toBe('./sw.js');
    expect(serviceWorkerUrl('https://opaland.github.io/Netatmo/sw.js', base)).not.toBeNull();
    expect(serviceWorkerUrl('https://evil.example/sw.js', base)).toBeNull();
    expect(serviceWorkerUrl('./assets/index.js', base)).toBeNull();
    expect(serviceWorkerUrl('./sw.js?x=1', base)).toBeNull();
    expect(serviceWorkerUrl('data:text/javascript,alert(1)', base)).toBeNull();
  });

  it('aucun innerHTML ni insertAdjacentHTML sans passer par la politique', () => {
    const sources = import.meta.glob<string>(['./*.ts', './views/*.ts', '!./*.test.ts', '!./trusted.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/\.(?:innerHTML|outerHTML)\s*=\s*(\S{0,5})|insertAdjacentHTML\([^,]+,\s*(\S{0,5})/g))
        if (!/^html[`(]/.test(m[1] ?? m[2])) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
