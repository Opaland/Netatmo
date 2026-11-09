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
// - script URL: the service worker of this app, at its exact path (workbox-window registers `sw.js`).
// No script policy at all: eval and `new Function` stay blocked.

type Policy = { createHTML(s: string): unknown };
type Rules = { createHTML: (s: string) => string | null; createScriptURL?: (s: string) => string | null };
type TT = { createPolicy(name: string, rules: Rules): Policy };

// The guard is a small HTML tokeniser (issues #230, #231) following the WHATWG
// tokenisation rules, rather than a regular expression over the whole string:
// - only markup is judged: escaped text (« javascript: », « onglet = 3 ») never matters,
//   so a room name or a sentence of the AI cannot blank a card;
// - attributes are separated by blanks AND by « / » (`<img/onerror=…>`), as in browsers;
// - URL attributes are judged after decoding character references and removing the
//   blanks and control characters the URL parser ignores (`java&#115;cript&colon;…`);
// - wherever the tokeniser could disagree with the browser, it refuses: comments, doctype,
//   processing instructions, NUL, unterminated tag or quote, `</ …`, raw-text elements
//   (title, textarea, style…) whose content holds a « < », SVG animation elements.
const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'meta', 'link', 'applet', 'portal', 'fencedframe',
  'plaintext', 'animate', 'animatemotion', 'animatetransform', 'set', 'handler', 'listener',
]);
// Contents read as text by the browser in HTML content: accepted only without any « < ».
const RAW_TEXT = new Set(['title', 'textarea', 'style', 'xmp', 'noembed', 'noframes', 'noscript']);
const URL_ATTRS = new Set([
  'href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'codebase', 'cite', 'longdesc', 'lowsrc', 'dynsrc', 'ping',
]);
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'blob']);
const WS = /[\t\n\f\r ]/;
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ', sol: '/', bsol: '\\',
  lpar: '(', rpar: ')', period: '.', comma: ',', semi: ';', excl: '!', num: '#', percnt: '%', quest: '?', equals: '=', plus: '+',
  lowbar: '_', hyphen: '-', dash: '-', commat: '@', ast: '*', midast: '*', dollar: '$', grave: '`', hat: '^', verbar: '|', vert: '|',
  lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']', lcub: '{', rcub: '}', lbrace: '{', rbrace: '}',
};

const refuse = (why: string): never => {
  throw new TypeError(`Trusted Types : balisage exécutable refusé (${why})`);
};

/** Character references decoded as the browser does in an attribute value; an unknown named one refuses. */
function decodeAttr(v: string): string {
  return v.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const code = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
    }
    if (!m.endsWith(';')) return m; // `?a=1&b=2`: not a reference in an attribute value
    return NAMED[ref.toLowerCase()] ?? refuse(`référence &${ref}; dans un attribut`);
  });
}

/** Exported for the unit tests: true when the value of an URL attribute cannot run script. */
export function safeUrl(raw: string): boolean {
  // The URL parser trims C0 controls and spaces at both ends and drops tab / newline anywhere.
  const v = decodeAttr(raw)
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
    .replace(/[\t\n\r]/g, '');
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(v);
  if (!m) return true; // relative path, #fragment, //host
  const scheme = m[1].toLowerCase();
  if (scheme === 'data') return /^data:image\/(png|jpeg|gif|webp|avif)[;,]/i.test(v);
  return SAFE_SCHEMES.has(scheme);
}

/** Exported for the unit tests: the check of the `energie` policy, throws a TypeError on executable markup. */
export function guard(s: string): string {
  if (s.includes('\0')) refuse('caractère NUL');
  const n = s.length;
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const c = s[lt + 1] ?? '';
    if (c === '!' || c === '?') refuse('commentaire ou déclaration');
    const end = c === '/';
    const start = lt + (end ? 2 : 1);
    if (!/[A-Za-z]/.test(s[start] ?? '')) {
      if (end) refuse('balise fermante malformée'); // `</ …>` is a bogus comment for the browser
      i = lt + 1; // a lone « < » is text
      continue;
    }
    let j = start;
    while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>') j++;
    const tag = s.slice(start, j).toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) refuse(`<${tag}>`);
    let closed = false;
    while (j < n) {
      while (j < n && (WS.test(s[j]) || s[j] === '/')) j++; // « / » separates attributes too
      if (j >= n) break;
      if (s[j] === '>') {
        closed = true;
        j++;
        break;
      }
      const from = j++; // the first character belongs to the name, even « = »
      while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') j++;
      const name = s.slice(from, j).toLowerCase();
      let k = j;
      while (k < n && WS.test(s[k])) k++;
      let value: string | null = null;
      if (s[k] === '=') {
        k++;
        while (k < n && WS.test(s[k])) k++;
        const q = s[k];
        if (q === '"' || q === "'") {
          const close = s.indexOf(q, k + 1);
          if (close < 0) refuse('valeur d’attribut non fermée');
          value = s.slice(k + 1, close);
          j = close + 1;
        } else {
          let e = k;
          while (e < n && !WS.test(s[e]) && s[e] !== '>') e++;
          value = s.slice(k, e);
          j = e;
        }
      }
      if (end) continue; // the browser ignores the attributes of an end tag
      if (name.startsWith('on') || name === 'srcdoc') refuse(`attribut ${name}`);
      if (value === null) continue;
      if (URL_ATTRS.has(name) && !safeUrl(value)) refuse(`URL dans ${name}`);
      if (name === 'style' && /javascript:|expression\(|url\(|@import|behavior:/i.test(decodeAttr(value).replace(/[\s\\]/g, '')))
        refuse('style');
    }
    if (!closed) refuse('balise non fermée');
    i = j;
    if (!end && RAW_TEXT.has(tag)) {
      // Only `</tag` followed by a blank, « / » or « > » ends it (`</titlex>` does not).
      const re = new RegExp(`</${tag}[\\t\\n\\f\\r />]`, 'gi');
      re.lastIndex = i;
      const close = re.exec(s)?.index ?? -1;
      if (close < 0) refuse(`<${tag}> non fermé`);
      if (s.slice(i, close).includes('<')) refuse(`« < » dans <${tag}>`);
      i = close;
    }
  }
  return s;
}

const tt = (globalThis as { trustedTypes?: TT }).trustedTypes;
const policy: Policy | null = tt ? tt.createPolicy('energie', { createHTML: guard }) : null;
/**
 * Exported for the unit tests: only this app's service worker script, at its exact path
 * (#229: on <compte>.github.io every Pages site of the account shares the origin, so
 * « same origin + /sw.js » would also accept another site's worker).
 */
export function serviceWorkerUrl(s: string, base = globalThis.document?.baseURI ?? globalThis.location?.href): string | null {
  try {
    const u = new URL(s, base);
    return u.href === new URL('sw.js', base).href && !u.search && !u.hash ? s : null;
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
