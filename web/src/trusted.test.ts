import { describe, expect, it } from 'vitest';
import { guard, html, safeUrl, serviceWorkerUrl } from './trusted';

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
      // #230: attribute after a slash, URL written with character references, case, blanks.
      '<img/onerror=alert(1) src=x>',
      '<svg/onload=alert(1)>',
      '<img src=x/onerror=alert(1)>'.replace('x/', 'x /'),
      '<a href="java&#115;cript&colon;alert(1)">x</a>',
      '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>',
      '<a href="&#x6A;avascript:alert(1)">x</a>',
      '<a href="&#106avascript:alert(1)">x</a>',
      '<a href="  jav\tascript:alert(1)">x</a>',
      '<a href=" \u0001javascript:alert(1)">x</a>',
      '<A HREF=JaVaScRiPt:alert(1)>x</A>',
      '<a href="vbscript:x">x</a>',
      '<a href="data:text/html,<script>x</script>">x</a>',
      '<form action="javascript:x"><button>x</button></form>',
      '<button formaction=javascript:x>x</button>',
      '<svg><a xlink:href="javascript:x">x</a></svg>',
      '<svg><animate attributeName="href" values="javascript:x"/></svg>',
      '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
      '<SCRIPT>x</SCRIPT>',
      '<script/src=//x>',
      '<object data="x">',
      '<iframe srcdoc="x">',
      '<div srcdoc="x">',
      '<a href="&unknown;javascript:x">x</a>',
      // Tokeniser disagreements with the browser are refused, not guessed.
      '<!--><img src=x onerror=alert(1)>-->',
      '<!DOCTYPE html>',
      '<?xml x?>',
      '</ x><b>',
      '<title><a title="</title><img src=x onerror=alert(1)>"></title>',
      '<title>x</titlex><a title="</title><img src=x onerror=alert(1)>">',
      '<style>a{}</style',
      '<svg><style><img src=x onerror=alert(1)></style></svg>',
      '<textarea>',
      '<b title="x>',
      '<b',
      '<b>\0</b>',
      '<p style="background:url(javascript:x)">',
      '<p style="width:expression(alert(1))">',
    ])
      expect(() => guard(bad), bad).toThrow(TypeError);
  });

  it('laisse passer le texte ordinaire et les attributs de l’application', () => {
    const ok = '<button type="button" data-view="overview" aria-current="page">Synthèse</button><p>onglet = 3 ; script</p>';
    expect(guard(ok)).toBe(ok);
    for (const good of [
      '<a href="https://github.com/Opaland/Netatmo/actions/runs/1?a=1&b=2&amp;c=3" target="_blank" rel="noopener">x</a>',
      '<a href="#quality">x</a>',
      '<a href="SHA256SUMS">x</a>',
      '<a href="mailto:x@example.org">x</a>',
      '<img src="icons/icon.svg" alt="">',
      '<img src="data:image/png;base64,AAAA" alt="">',
      '<div style="flex: 3;background: var(--accent)"></div>',
      '<style>@media print { @page { margin: 0; } }</style><p>x</p>',
      '<textarea id="n">texte &lt;b&gt;</textarea>',
      '<p>1 &lt; 2 et 3 > 2</p>',
      '<input type="date" min="2024-01-01" max="2025-01-01">',
      '<br/><hr />',
      '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0L10 10"/></svg>',
    ])
      expect(guard(good), good).toBe(good);
  });

  it('#231 : un texte échappé contenant « javascript: » ou « on…= » ne bloque pas la carte', () => {
    for (const good of [
      '<p>javascript: texte</p>',
      '<li>Travaux : remplacer javascript:alert(1) par rien</li>',
      '<p>onerror=alert(1) est un texte</p>',
      '<button aria-label="Pièce onclick=x javascript:x" title="javascript:y">x</button>',
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    ])
      expect(guard(good), good).toBe(good);
    expect(() => guard('<a href="javascript:x">x</a>')).toThrow(TypeError);
  });

  it('URL : schémas sûrs seulement', () => {
    expect(safeUrl('https://x.example/')).toBe(true);
    expect(safeUrl('./a/b.json')).toBe(true);
    expect(safeUrl('blob:https://x/1')).toBe(true);
    expect(safeUrl('javascript:x')).toBe(false);
    expect(safeUrl('java&Tab;script:x')).toBe(false);
    expect(safeUrl('&#0000106;avascript:x')).toBe(false);
    expect(safeUrl('data:image/svg+xml,<svg onload=x>')).toBe(false);
    expect(safeUrl('file:///etc/passwd')).toBe(false);
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
