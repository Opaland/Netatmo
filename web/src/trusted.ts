// S-8.9: Trusted Types. The CSP (index.html) sets `require-trusted-types-for 'script'`:
// the browser refuses any plain string assigned to innerHTML / insertAdjacentHTML.
// Every HTML sink of the app goes through `html`, the single named policy `energie`.
//
// Contract: what reaches the policy is an app template; any external or user value
// interpolated in it has been escaped beforehand with `esc` / `escapeHtml` (charts.ts),
// and the AI Markdown is rendered by markdown.ts (escape first, then a few tags).
// The policy is a last barrier: it refuses markup that could run script (script, iframe,
// object, embed, inline event handler, javascript: URL) even if a value was not escaped.
//
// A second policy, `default`, covers third-party code only, as narrowly as possible:
// - HTML: the empty string (ECharts empties its tooltip with `innerHTML = ''`, harmless)
//   and nothing else, so a forgotten `innerHTML = '<…>'` is still refused and reported;
// - script URL: the service worker of this site (workbox-window registers `sw.js`).
// No script policy at all: eval and `new Function` stay blocked.

type Policy = { createHTML(s: string): unknown };
type Rules = { createHTML: (s: string) => string | null; createScriptURL?: (s: string) => string | null };
type TT = { createPolicy(name: string, rules: Rules): Policy };

const DANGEROUS = /<\s*\/?\s*(script|iframe|object|embed|frame|base|meta|link)\b|<[^>]*\son[a-z]+\s*=|javascript\s*:/i;

/** Exported for the unit tests. */
export function guard(s: string): string {
  if (DANGEROUS.test(s)) throw new TypeError('Trusted Types : balisage exécutable refusé');
  return s;
}

const tt = (globalThis as { trustedTypes?: TT }).trustedTypes;
const policy: Policy | null = tt ? tt.createPolicy('energie', { createHTML: guard }) : null;
/** Exported for the unit tests: only this site's service worker script. */
export function serviceWorkerUrl(s: string, base = globalThis.location?.href): string | null {
  try {
    const u = new URL(s, base);
    return u.origin === new URL(base).origin && /\/sw\.js$/.test(u.pathname) && !u.search ? s : null;
  } catch {
    return null;
  }
}

if (tt) tt.createPolicy('default', { createHTML: (s) => (s === '' ? '' : null), createScriptURL: (s) => serviceWorkerUrl(s) });

/**
 * Trusted HTML for innerHTML / insertAdjacentHTML. Usable as a template tag
 * (`el.innerHTML = html\`<p>${esc(x)}</p>\``) or as a function (`html(table(...))`).
 * The value is a TrustedHTML object where the browser supports it (typed `string`
 * because lib.dom types innerHTML as string): do not concatenate it, wrap the whole
 * expression instead.
 */
export function html(strings: TemplateStringsArray | string, ...values: unknown[]): string {
  const s = typeof strings === 'string' ? strings : strings.reduce((acc, part, i) => acc + String(values[i - 1]) + part);
  return (policy ? policy.createHTML(s) : guard(s)) as string;
}

/** A detached element built from trusted HTML (ECharts tooltips: no innerHTML on ECharts' side). */
export function node(s: string): HTMLElement | string {
  if (!s) return '';
  const t = document.createElement('template');
  t.innerHTML = html(s);
  const div = document.createElement('div');
  div.append(t.content);
  return div;
}
