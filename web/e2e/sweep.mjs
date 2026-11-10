// #353: systematic sweep. Every route of the registry (src/router.ts: the five tabs, each room,
// the sub-pages, every tool, every meter page, every settings page, the first launch) × named
// demo fixtures (python -m collector fixtures, see collector/fixtures.py) × displays (360 px,
// 1280 px, system text at 200 %, dark), with the same invariants everywhere:
//   - no console error and no uncaught exception;
//   - no horizontal scroll;
//   - no « NaN », « undefined », « Infinity », « Invalid Date », « null » visible (text or label);
//   - no card (nor chart) left empty without a message;
//   - no text painted over another, none cut by the box that holds it, no ordinary word broken
//     in the middle without a hyphen (#384, #397: what the horizontal scroll does not see);
//   - no value axis writing the same label twice (« 21, 21, 20, 20 », #398);
//   - axe: no serious or critical violation (WCAG 2.1 AA);
//   - the view becomes ready (#view[data-ready], #260).
// Then a control explorer: on each page, every checkbox, switch, segment, radio, chip and select
// is operated one by one, then every group all on / all off, and the invariants are checked
// again, plus « a table or a chart that was there did not vanish » (the bug « 5 jours cochés →
// plus de tableau » in Une journée de télétravail), « the page does not jump back to the top » and
// « the focus stays on the control » (a segment of Historique sent the page to the top).
//
// Run after `npm run build`: node e2e/sweep.mjs   (starts `vite preview` itself)
//   SWEEP_SCOPE=ci (default: every route on the plain demo in the four displays and in the
//     explorer, the other fixtures at 360 px) | full (every fixture × every display, axe and
//     explorer everywhere: manual or nightly run)
//   SWEEP_FIXTURES=demo,sans-prix…  SWEEP_DISPLAYS=360,sombre…  SWEEP_ROUTES=<regex>
//   SWEEP_EXPLORE=0 (no explorer)  SWEEP_WORKERS=4  E2E_PORT=4196
//   SWEEP_BASE=https://…/ : sweep a site already served (smoke test of the deployed demo)
//   SWEEP_SOURCE=data + DATA_PASSPHRASE : real data (dist/data). ASSERTIONS ONLY: no capture, and
//     each line says « page X : OK » or « page X : échec : <invariant> », never a value, a name
//     nor a text of the page (the repository is public); rooms are numbered, not named.
// Missing fixtures (web/dist/demo-fixtures) are generated with python3 -m collector fixtures.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { frames, goto, openData, openDemo, ready, seriousAxe, startPreview } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const env = process.env;
const SOURCE = env.SWEEP_SOURCE === 'data' ? 'data' : 'demo';
const QUIET = SOURCE === 'data'; // real data: never a value nor a text in the logs
const FULL = env.SWEEP_SCOPE === 'full';
const EXPLORE = env.SWEEP_EXPLORE !== '0';
const WORKERS = Math.max(1, Number(env.SWEEP_WORKERS ?? Math.min(4, cpus().length)));
const ROUTE_FILTER = env.SWEEP_ROUTES ? new RegExp(env.SWEEP_ROUTES) : null;
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
if (SOURCE === 'data' && !env.DATA_PASSPHRASE) {
  console.error('SWEEP_SOURCE=data : DATA_PASSPHRASE manquant.');
  process.exit(2);
}

// ------------------------------------------------------------------ routes (src/router.ts)
function routes() {
  const src = readFileSync(join(WEB, 'src/router.ts'), 'utf8');
  const keys = (name) => {
    const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
    if (!block) throw new Error(`router.ts : ${name} introuvable`);
    return [...block[1].matchAll(/^\s*'?([\w-]+)'?\s*:/gm)].map((m) => m[1]);
  };
  const tabs = [...src.matchAll(/^\s*\['(\w+)', '[^']+'\],$/gm)].map((m) => m[1]);
  const simple = /SIMPLE_PAGES = new Set\(\[([^\]]+)\]\)/.exec(src)[1].match(/[\w-]+/g);
  return [
    ...new Set(tabs),
    ...simple,
    ...keys('TOOLS').map((k) => `outils-${k}`),
    ...keys('METER_PAGES').map((k) => `compteur-${k}`),
    'parametres',
    ...keys('SETTINGS').map((k) => `parametres-${k}`),
    'bienvenue',
    'bienvenue-2',
    'bienvenue-3',
    'bienvenue-4',
  ];
}

// ------------------------------------------------------------------ fixtures and displays
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
/** Data fixture (folder of dist/demo-fixtures, null = the demo) and settings of the device. */
const MODES = {
  locataire: {
    data: null,
    storage: { tenant: JSON.stringify({ on: true, leaseFrom: daysAgo(200), leaseTo: null }) },
    applied: () => !!document.querySelector('.tabs') && !document.querySelector('.tabs [data-view="compteur"]'), // no Compteur tab
  },
  proche: { data: null, storage: { state: JSON.stringify({ simple: true }) }, applied: () => document.body.classList.contains('simple-nav') },
};
/**
 * Data fixtures swept like the demo itself in CI (every display, axe, explorer): a full history
 * with more and longer content than the demo, standing for a real account (smoke-reel.yml found
 * two failures that the demo could not show: an error message without a space in ⚙ Sources at
 * 200 %, the focus lost on a room box of ⚙ Objectifs).
 */
const RICH = new Set(['compte-charge']);
// The RICH fixtures are opened as real data (lock screen, passphrase), not as the demo: what only
// a real account shows (⚙ Sources: GitHub login, identifiers, manual collection) is swept too.
// The browser is served the fixture where the app fetches data/ (nothing is copied into dist/).
const AS_DATA = RICH;
/** What a device of a fuller account keeps (made up): Shelly clamp names of 60 characters without a space. */
const RICH_STORAGE = {
  shelly: JSON.stringify({
    names: { p4c0: 'Circuit_prises_cuisine_buanderie_et_cellier_du_sous-sol_nord', p4c1: 'Ballon_thermodynamique_garage_et_atelier_du_rez-de-chaussée' },
    roles: { p4c1: 'water' },
  }),
};
const DISPLAYS = {
  360: { viewport: { width: 360, height: 800 } },
  1280: { viewport: { width: 1280, height: 900 } },
  'texte-200': { viewport: { width: 360, height: 800 }, big: true },
  sombre: { viewport: { width: 390, height: 900 }, colorScheme: 'dark' },
};

function dataFixtures() {
  const dir = join(WEB, 'dist/demo-fixtures');
  if (!existsSync(join(dir, 'sans-prix', 'meta.enc.json'))) {
    console.log('Fixtures absentes : python3 -m collector fixtures');
    execFileSync('python3', ['-m', 'collector', 'fixtures', '-o', dir], { cwd: join(WEB, '..'), stdio: 'inherit' });
  }
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, 'meta.enc.json')));
}

/**
 * Known failures, reported as such (they do not fail the run) until fixed; a known failure
 * that no longer happens is reported so that it is removed from here.
 * { route: regex on the route, kind: invariant, why }.
 */
const EXPECTED = [
  { route: /^(pieces|confort)$/, kind: 'defilement-saute', fixture: 'compte-charge', why: '#370 : la page saute après une case ou une liste, avec 10 pièces' },
];
const expected = (f) => EXPECTED.find((e) => e.route.test(f.route) && e.kind === f.kind && (!e.fixture || e.fixture === f.fixture));

// ------------------------------------------------------------------ invariants (in the page)
/** Checks done in the page: forbidden words, horizontal scroll, empty cards and charts. */
function pageChecks() {
  const out = [];
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const bad = /\b(NaN|undefined|Infinity|null)\b|Invalid Date/;
  const text = document.body.innerText;
  const m = bad.exec(text);
  if (m) out.push({ kind: 'texte-interdit', detail: text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ') });
  for (const el of document.querySelectorAll('#app [aria-label], #app [title], #app img[alt]')) {
    for (const a of ['aria-label', 'title', 'alt']) {
      const v = el.getAttribute(a);
      if (v && bad.test(v)) out.push({ kind: 'texte-interdit', detail: `${a}="${v.slice(0, 80)}"` });
    }
  }
  // #353 (smoke test on real data): a diagnosis WITHOUT content, printed in the quiet mode — the
  // overflow in px and the path of what sticks out as tag.classe, with only the classes the app's
  // own style sheets define (a class made of data is dropped), never a text, an id nor an
  // attribute value. Shared by the overflow and the overlapping texts (#384).
  let known = null;
  const seg = (el) => {
    if (!known) {
      known = new Set();
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (list) => {
          for (const r of list) {
            if (r.selectorText) for (const m of r.selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) known.add(m[1]);
            if (r.cssRules) walk(r.cssRules);
          }
        };
        walk(rules);
      }
    }
    const cls = [...el.classList].find((c) => known.has(c));
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const path = (el) => {
    const parts = [];
    for (let a = el; a && a.id !== 'view' && a.id !== 'app' && a !== document.body; a = a.parentElement) parts.unshift(seg(a));
    return parts.length > 6 ? `… > ${parts.slice(-6).join(' > ')}` : parts.join(' > ');
  };
  const scrolls = (el) => /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowX);
  const wide = document.documentElement.scrollWidth - window.innerWidth;
  if (wide > 1) {
    // the outermost boxes that stick out (not their children, nor what scrolls inside a box)
    const out_ = (el) => visible(el) && el.getBoundingClientRect().right > window.innerWidth + 1;
    const culprits = [...document.querySelectorAll('#app *')]
      .filter((el) => out_(el) && !(el.parentElement && el.parentElement !== document.getElementById('app') && out_(el.parentElement) && !scrolls(el.parentElement)))
      .filter((el) => { for (let a = el.parentElement; a; a = a.parentElement) if (scrolls(a) && a.getBoundingClientRect().right <= window.innerWidth + 1) return false; return true; })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`);
    const outer = [...document.querySelectorAll('#app *')]
      .filter((el) => out_(el) && !(el.parentElement && el.parentElement !== document.getElementById('app') && out_(el.parentElement) && !scrolls(el.parentElement)))
      .filter((el) => { for (let a = el.parentElement; a; a = a.parentElement) if (scrolls(a) && a.getBoundingClientRect().right <= window.innerWidth + 1) return false; return true; })
      .slice(0, 3);
    // under the first outer box, the deepest element that still sticks out: what is too wide
    const deepest = (el) => {
      for (;;) {
        const next = [...el.children].find((c) => out_(c));
        if (!next) return el;
        el = next;
      }
    };
    // a word too long for its line sticks out of a box that fits: only its text node shows it
    const inScroll = (el) => { for (let a = el; a; a = a.parentElement) if (scrolls(a) && a.getBoundingClientRect().right <= window.innerWidth + 1) return true; return false; };
    const words = [];
    const walker = document.createTreeWalker(document.getElementById('app') ?? document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n && words.length < 3; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || words.includes(el) || inScroll(el) || !visible(el)) continue;
      range.selectNodeContents(n);
      if (range.getBoundingClientRect().right > window.innerWidth + 1) words.push(el);
    }
    const parts = [
      ...outer.map(path),
      ...(outer[0] && deepest(outer[0]) !== outer[0] ? [`au plus profond : ${path(deepest(outer[0]))}`] : []),
      ...words.map((el) => `texte trop long dans : ${path(el)}`),
    ];
    const quiet = `${wide} px : ${parts.join(' ; ') || 'élément non trouvé'}`;
    out.push({ kind: 'defilement-horizontal', detail: `${wide} px (${[...culprits, ...words.map((el) => `texte de ${seg(el)}`)].join(', ')})`, quiet });
  }
  // #384: a text painted over another, or cut by the edge of the box that holds it (a card, a
  // list: overflow hidden), the two defects the horizontal scroll cannot see (a pill over the
  // amount of its row at 360 px, out of its card at 200 %). Every visible text node of the view,
  // line by line (the rectangles of a range). Left aside, on purpose: the charts (their own
  // labels), what is visually hidden (.sr-only, clip), what sticks or floats over the page (a
  // sticky bar, an open panel) and a text cut with an ellipsis; [data-overlap-ok] marks a wanted
  // overlap.
  {
    const range = document.createRange();
    const memo = new Map();
    const style = (el) => memo.get(el) ?? (memo.set(el, getComputedStyle(el)), memo.get(el));
    // what sticks (a bar over the page scrolled) or floats over it on purpose (a panel opened
    // over the card: positioned, with its own background) is above the page, not over a text
    const opaque = (s) => s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
    const sticks = (el) => {
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const s = style(a);
        if (/sticky|fixed/.test(s.position) || (s.position === 'absolute' && opaque(s))) return true;
      }
      return false;
    };
    const clipper = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = style(a);
        if (/auto|scroll/.test(s.overflowX + s.overflowY)) return null; // reachable by scrolling
        if (/hidden|clip/.test(s.overflowX + s.overflowY)) return a;
      }
      return null;
    };
    // the part of a line actually painted: cut by every box that clips (overflow other than
    // visible: a card, a list, a table scrolled inside its frame, a visually hidden legend)
    const painted = (el, r) => {
      let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const s = style(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const k = a.getBoundingClientRect();
        [l, t, rt, b] = [Math.max(l, k.left), Math.max(t, k.top), Math.min(rt, k.right), Math.min(b, k.bottom)];
      }
      return rt - l > 2 && b - t > 2 ? { left: l, top: t, right: rt, bottom: b, height: b - t } : null;
    };
    const hidden = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) if (style(a).clip !== 'auto' || style(a).clipPath !== 'none') return true; return false; };
    const ellipsis = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) if (style(a).textOverflow === 'ellipsis') return true; return false; };
    const boxes = [];
    // the view and the header (#397: « Maiso / n » in the name of the home); the tab bar and what
    // sticks are measured for broken words, not for overlaps (they ride over the page scrolled)
    const view = document.getElementById('app') ?? document.body;
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || el.closest('.sr-only, .chart, svg, [data-overlap-ok]') || !visible(el) || hidden(el)) continue;
      const stuck = sticks(el);
      // the content of a closed <details> keeps its boxes in Chromium: not painted all the same
      if (el.checkVisibility ? !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : Number(style(el).opacity) === 0) continue;
      if (el.closest('details:not([open])') && !el.closest('summary')) continue;
      range.selectNodeContents(n);
      for (const raw of range.getClientRects()) {
        const r = raw.width > 2 && raw.height > 2 ? painted(el, raw) : null;
        if (r) boxes.push({ el, n, r, raw, stuck });
      }
    }
    const say = (b) => b.n.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    // two texts over each other: more than 2 px across and a quarter of the shorter line high
    boxes.sort((a, b) => a.r.top - b.r.top);
    let overlaps = 0;
    for (let i = 0; i < boxes.length && overlaps < 3; i++) {
      const a = boxes[i];
      if (a.stuck) continue;
      for (let j = i + 1; j < boxes.length && boxes[j].r.top < a.r.bottom && overlaps < 3; j++) {
        const b = boxes[j];
        if (b.n === a.n || b.stuck) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) / 4) {
          overlaps++;
          out.push({ kind: 'textes-recouverts', detail: `« ${say(a)} » / « ${say(b)} »`, quiet: `${path(a.el)} / ${path(b.el)}` });
        }
      }
    }
    // #384, #397: an ordinary word broken in the middle without a hyphen (« Salo / n », « Maiso /
    // n »): a column squeezed until overflow-wrap breaks it anywhere. Left aside: a hyphenation
    // (hyphens: auto, lang="fr": the browser draws its hyphen), code and identifiers (« onError »)
    // and a word wider than its whole card (a name made of data, #372: it must break somewhere).
    let broken = 0;
    for (const n of new Set(boxes.map((b) => b.n))) {
      if (broken >= 3) break;
      if (n.parentElement.closest('code, pre, kbd, samp') || style(n.parentElement).hyphens === 'auto') continue;
      for (const m of n.textContent.matchAll(/(?<![\p{L}\d_])\p{L}{2,12}(?![\p{L}\d_])/gu)) {
        if (/\p{Ll}\p{Lu}/u.test(m[0])) continue;
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const parts = [...range.getClientRects()].filter((r) => r.width > 0);
        const lines = new Set(parts.map((r) => Math.round(r.top)));
        const box = n.parentElement.closest('.card, .list, .verdict, .kpi, .alert, .top, #view') ?? view;
        const bs = style(box);
        const room = box.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
        if (lines.size > 1 && parts.reduce((w, r) => w + r.width, 0) <= room) {
          broken++;
          out.push({ kind: 'mot-coupe', detail: `« ${m[0]} »`, quiet: path(n.parentElement) });
          break;
        }
      }
    }
    // a text cut by the edge of the box that clips it
    let cut = 0;
    for (const b of boxes) {
      if (cut >= 3) break;
      const c = clipper(b.el);
      if (!c || ellipsis(b.el)) continue;
      const k = c.getBoundingClientRect();
      if (b.raw.right > k.right + 1 || b.raw.left < k.left - 1 || b.raw.bottom > k.bottom + 1) {
        cut++;
        out.push({ kind: 'texte-coupe', detail: `« ${say(b)} »`, quiet: `${path(b.el)} dans ${path(c)}` });
      }
    }
  }
  for (const card of document.querySelectorAll('#view .card')) {
    if (!visible(card)) continue;
    const clone = card.cloneNode(true);
    clone.querySelectorAll('h1, h2, h3, h4, .card-head, .sr-only').forEach((e) => e.remove());
    const media = card.querySelector('canvas, svg, img, table, input, select, textarea, button, a, [role=img], progress, meter');
    if (!clone.textContent.trim() && !media) out.push({ kind: 'carte-vide', detail: card.id || card.querySelector('h2, h3')?.textContent.trim().slice(0, 50) || '(sans titre)' });
  }
  for (const chart of document.querySelectorAll('#view .chart')) {
    if (!visible(chart)) continue;
    if (!chart.querySelector('canvas, svg') && !chart.textContent.trim()) out.push({ kind: 'graphique-vide', detail: chart.id || '(sans id)' });
    // #398: an axis that writes the same label for two values (« 21, 21, 20, 20 »), noted by
    // charts.ts (axisFmt) on the chart element: the canvas has no text to read
    for (const a of chart.getAttributeNames().filter((n) => n.startsWith('data-axis-dup-')))
      out.push({ kind: 'etiquettes-axe-en-double', detail: `${chart.id || '(sans id)'} : « ${chart.getAttribute(a)} »`, quiet: `${chart.id || '(sans id)'}, axe ${a.slice(14)}` });
  }
  return out;
}

/** Tables and charts of each card, by card (explorer: what a control must not make vanish). */
function dataDisplays() {
  const out = {};
  document.querySelectorAll('#view .card').forEach((card, i) => {
    const key = card.id || card.querySelector('h2, h3')?.textContent.trim() || `#${i}`;
    out[key] = { tables: card.querySelectorAll('table tbody tr, table tr').length > 1 ? 1 : 0, charts: card.querySelectorAll('canvas, .chart svg').length };
  });
  return out;
}

// ------------------------------------------------------------------ one browser context
class Session {
  constructor(browser, run, display, report) {
    Object.assign(this, { browser, run, display, report });
    this.errors = [];
  }
  async open(hash = '') {
    const d = DISPLAYS[this.display];
    this.ctx = await this.browser.newContext({ viewport: d.viewport, colorScheme: d.colorScheme ?? 'light', serviceWorkers: 'block' });
    const storage = { ...(this.run.storage ?? {}) };
    if (SOURCE === 'data' || this.run.asData) storage.state ??= '{}'; // a device already used: no first launch
    if (this.run.asData) {
      const dir = join(WEB, 'dist/demo-fixtures', this.run.data);
      const prefix = `${new URL(base).pathname}data/`;
      await this.ctx.route(
        (url) => url.pathname.startsWith(prefix),
        (route) => {
          const file = join(dir, new URL(route.request().url()).pathname.slice(prefix.length));
          return file.startsWith(`${dir}/`) && existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
        },
      );
    }
    await this.ctx.addInitScript(
      (entries) => {
        try {
          // the app's namespace (src/scope.ts): « intuis-history@<dépôt> » under a path, else « intuis-history »
          const dir = location.pathname.replace(/[^/]*$/, '').replace(/^\/+|\/+$/g, '');
          const prefix = dir ? `intuis-history@${dir}` : 'intuis-history';
          localStorage.clear();
          for (const [k, v] of entries) localStorage.setItem(`${prefix}:${k}`, v);
        } catch {
          /* storage blocked: defaults */
        }
      },
      Object.entries(storage),
    );
    this.page = await this.ctx.newPage();
    this.page.on('pageerror', () => this.errors.push('erreur-js'));
    this.page.on('pageerror', (e) => QUIET || this.errorDetails.push(e.message));
    this.page.on('console', (m) => {
      if (m.type() !== 'error') return;
      this.errors.push('console');
      if (!QUIET) this.errorDetails.push(m.text().slice(0, 200));
    });
    this.errorDetails = [];
    await this.load(hash);
  }
  async load(hash = '') {
    if (SOURCE === 'data') await openData(this.page, base, env.DATA_PASSPHRASE, hash);
    else if (this.run.asData) await openData(this.page, base, 'demo', hash); // fixtures: made-up data, passphrase « demo »
    else await openDemo(this.page, base, this.run.data, hash);
    // text at 200 %, in a wide system font (DejaVu Sans, Linux's and the CI's): the worst case
    // everywhere, so that a page that fits here fits on the CI runner too
    if (DISPLAYS[this.display].big)
      await this.page.addStyleTag({ content: 'html { font-size: 200% !important; } html, body, button, input, select, textarea { font-family: "DejaVu Sans", system-ui, sans-serif !important; }' });
    await frames(this.page);
  }
  async close() {
    await this.ctx?.close();
  }
  /** Rooms of the list (« piece-<id> »), in their order. */
  async rooms() {
    await goto(this.page, 'pieces');
    const hrefs = await this.page.$$eval('#view a[href^="#piece-"]', (as) => as.map((a) => a.getAttribute('href').slice(1)));
    return [...new Set(hrefs)];
  }
  /** Invariants on the page shown; failures go to the report under `where`. */
  async check(where, { axe = false } = {}) {
    const found = [];
    for (const e of new Set(this.errors)) found.push({ kind: e, detail: this.errorDetails.join(' | ').slice(0, 300) });
    this.errors = [];
    this.errorDetails = [];
    found.push(...(await this.page.evaluate(pageChecks)));
    if (axe) for (const v of await seriousAxe(this.page)) found.push({ kind: `axe:${v.id}`, detail: v.targets.join(' | ') });
    this.report(where, found);
    return found;
  }
}

// ------------------------------------------------------------------ the sweep of one (fixture, display)
async function sweepJob(browser, job) {
  const s = new Session(browser, job.run, job.display, record);
  const where = (route) => ({ fixture: job.run.name, display: job.display, route });
  try {
    await s.open();
    // the settings of the mode were really read by the app (a sweep of the plain demo proves nothing)
    if (job.run.applied && !(await s.page.evaluate(job.run.applied))) throw new Error(`mode « ${job.run.name} » non appliqué`);
    const rooms = await s.rooms();
    roomNames[job.run.name] ??= rooms;
    const all = [...ROUTES.slice(0, 5), ...rooms, ...ROUTES.slice(5)].filter((r) => !ROUTE_FILTER || ROUTE_FILTER.test(r));
    for (const route of all) {
      try {
        await goto(s.page, route);
      } catch {
        s.report(where(route), [{ kind: 'jamais-prete', detail: '' }]);
        await s.close();
        await s.open(); // a page that never settles: start again from a fresh context
        continue;
      }
      await s.check(where(route), { axe: job.axe });
    }
  } catch (err) {
    record(where('(ouverture)'), [{ kind: 'exception', detail: String(err).slice(0, 300) }]);
  } finally {
    await s.close();
  }
}

// ------------------------------------------------------------------ the control explorer of one (fixture, route)
const CONTROLS = '#view input[type=checkbox], #view input[type=radio], #view [role=radio], #view [role=switch], #view select, #view button[aria-pressed]';

/** Stable selectors of the controls shown (id, name / value, data-* attributes), and their group. */
function describeControls(sel) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const esc = (v) => CSS.escape(v);
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el) || el.disabled || el.closest('[hidden], [inert]') || (!visible(el) && !visible(el.closest('label') ?? el))) continue;
    seen.add(el);
    let css = el.tagName.toLowerCase();
    if (el.id) css += `#${esc(el.id)}`;
    else {
      for (const a of el.attributes) if (a.name.startsWith('data-') || ['name', 'value', 'role'].includes(a.name)) css += `[${a.name}="${esc(a.value)}"]`;
    }
    const n = document.querySelectorAll(css).length;
    const kind = el.tagName === 'SELECT' ? 'select' : el.type === 'checkbox' ? 'case' : el.getAttribute('role') === 'radio' || el.type === 'radio' ? 'radio' : 'bascule';
    const container = el.closest('fieldset, [role=radiogroup], [role=group], .chips, .seg') ?? el.parentElement?.parentElement;
    if (!container.dataset.sweepGroup) container.dataset.sweepGroup = String(out.length);
    out.push({
      css: n === 1 ? css : null,
      kind,
      group: `${kind}:${container.dataset.sweepGroup}`,
      on: el.tagName === 'SELECT' ? el.value : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true',
      options: el.tagName === 'SELECT' ? [...el.options].filter((o) => !o.disabled).map((o) => o.value) : null,
    });
  }
  return out.filter((c) => c.css);
}

/**
 * Operate a control as a person would (real click or choice, so the focus moves to it); returns
 * false when the control is gone or already in the wanted state. Remembers, in the session, where
 * the control was on screen just before the action (scroll / focus invariants).
 */
async function act(s, css, how) {
  const el = s.page.locator(css);
  if (!(await el.count())) return false;
  if (how.set !== undefined) {
    const on = await el.evaluate((e) => (e.type === 'checkbox' ? e.checked : e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true'));
    if (on === how.set) return false;
  }
  // a control in a closed fold: opened first, as a person would (« Choisir les saisons »…)
  await el.evaluate((e) => {
    const fold = e.closest('details');
    if (fold && !fold.open) fold.open = true;
  });
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch {
    /* hidden input of a styled switch: its label is on screen */
  }
  s.lastAct = { css, ...(await el.evaluate((e) => ({ y: window.scrollY, top: (e.closest('label') ?? e).getBoundingClientRect().top }))) };
  s.covered = how.value === undefined ? await el.evaluate(coveredBy) : null; // a list is chosen from, not clicked
  try {
    // a list is chosen from while it has the focus (Playwright's selectOption does not give it)
    if (how.value !== undefined) await el.focus();
    if (how.value !== undefined) await el.selectOption(how.value, { timeout: 5000 });
    else await el.click({ force: true, timeout: 5000 });
  } catch {
    // out of the viewport (inside a scrolled box): the click of a keyboard or a screen reader
    await el.focus();
    await (how.value !== undefined ? el.evaluate((e, v) => ((e.value = v), e.dispatchEvent(new Event('change', { bubbles: true }))), how.value) : el.evaluate((e) => e.click()));
  }
  return true;
}

/**
 * #353 (smoke test on real data): what is painted where the control is about to be clicked, when
 * it is neither the control nor its label (null otherwise). On a phone, a box brought just above
 * the bottom of the screen sat under the fixed tab bar: the click went to the bar (a tab, or
 * nothing) and the sweep saw « focus perdu », or nothing at all when the tab changed the page.
 */
function coveredBy(e) {
  const r = (e.closest('label') ?? e).getBoundingClientRect();
  const box = e.getBoundingClientRect();
  const at = box.width && box.height ? box : r; // the hidden input of a styled switch: its label
  const x = at.left + at.width / 2;
  const y = at.top + at.height / 2;
  if (!at.width || !at.height || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null; // clicked another way (act)
  const hit = document.elementFromPoint(x, y);
  if (!hit || hit === e || e.contains(hit) || [...(e.labels ?? [])].some((l) => l.contains(hit)) || hit.closest('label')?.contains(e)) return null;
  const cls = typeof hit.className === 'string' && hit.className ? `.${hit.className.split(' ')[0]}` : '';
  const zone = hit.closest('nav, header, [role=dialog], .tabs');
  return `${hit.tagName.toLowerCase()}${cls}${zone && zone !== hit ? ` dans ${zone.tagName.toLowerCase()}${zone.className ? `.${String(zone.className).split(' ')[0]}` : ''}` : ''}`;
}

/** Between two clicks of a group: the re-render of the first one is done. */
async function settle(page) {
  await frames(page);
  await ready(page, 20000).catch(() => {});
}

/**
 * #353: after an action on a control, the page does not jump back to the top (the control stays
 * where it was on screen: scroll anchoring keeps it there when content above changes) and the
 * focus stays on the control.
 */
async function scrollAndFocus(s) {
  if (!s.lastAct) return [];
  const { css, y, top } = s.lastAct;
  s.lastAct = null;
  const look = (css) => {
    const el = document.querySelector(css);
    const a = document.activeElement;
    return {
      y: window.scrollY,
      top: el ? (el.closest('label') ?? el).getBoundingClientRect().top : null,
      focused: !!a && a !== document.body && (a.matches(css) || !!a.closest('label')?.querySelector(css)),
    };
  };
  let now = await s.page.evaluate(look, css);
  // a card drawn late gives the focus back late: a second look within a second
  for (let i = 0; i < 4 && !now.focused; i++) {
    await s.page.waitForTimeout(250);
    now = await s.page.evaluate(look, css);
  }
  const out = [];
  if (y > 100 && now.y < y - 50 && (now.top === null || now.top - top > 150)) out.push({ kind: 'defilement-saute', detail: `${Math.round(y)} → ${Math.round(now.y)} px` });
  if (!now.focused) out.push({ kind: 'focus-perdu', detail: css });
  return out;
}

async function exploreJob(browser, job) {
  const s = new Session(browser, job.run, job.display, record);
  const richData = !job.run.data || RICH.has(job.run.data); // the demo itself, its modes, real data, or a fuller account
  try {
    await s.open();
    const rooms = await s.rooms();
    const all = [...ROUTES.slice(0, 5), ...rooms, ...ROUTES.slice(5)].filter((r) => !ROUTE_FILTER || ROUTE_FILTER.test(r));
    for (const route of all.filter((_, i) => i % job.of === job.part)) {
      const where = (what) => ({ fixture: job.run.name, display: job.display, route, control: what });
      try {
        let shown = await goto(s.page, route);
        await s.check(where('état initial'));
        const baseline = await s.page.evaluate(dataDisplays);
        const controls = await s.page.evaluate(describeControls, CONTROLS);
        /** After an action: ready again, invariants, nothing vanished; back on the route if it left. */
        const after = async (what, watchLoss = false) => {
          await frames(s.page);
          try {
            await ready(s.page, 20000);
          } catch {
            s.report(where(what), [{ kind: 'jamais-prete', detail: '' }]);
            await s.close();
            await s.open(route);
            return false;
          }
          const page = await s.page.evaluate(() => document.getElementById('view')?.dataset.page ?? '');
          // a control covered by another element (the tab bar…): the click went there, whatever the page shows next
          const hidden = s.covered ? [{ kind: 'cible-masquee', detail: s.covered }] : [];
          s.covered = null;
          const moved = page === shown ? await scrollAndFocus(s) : [];
          s.lastAct = null;
          const found = await s.check(where(what));
          let now = await s.page.evaluate(dataDisplays);
          const vanished = () => Object.entries(baseline).some(([card, was]) => now[card] && ((was.tables && !now[card].tables) || (was.charts && !now[card].charts)));
          if (watchLoss && richData && vanished()) {
            // a second look, a moment later (a chart drawn late is not a lost chart)
            await s.page.waitForTimeout(1500);
            await ready(s.page, 20000).catch(() => {});
            now = await s.page.evaluate(dataDisplays);
            if (vanished() && SOURCE === 'demo' && env.SWEEP_DEBUG) console.log(JSON.stringify({ what, baseline, now }));
          }
          const lost = [...hidden, ...moved];
          // (only on full data: on a trimmed fixture, « not enough days » instead of a table is right)
          // a segment, a radio or a select switches between views by design: only an on/off
          // control (checkbox, switch, chip) must not make a table or a chart vanish
          if (watchLoss && richData) for (const [card, was] of Object.entries(baseline)) {
            const is = now[card];
            if (!is) continue;
            if (was.tables && !is.tables) lost.push({ kind: 'tableau-perdu', detail: card });
            if (was.charts && !is.charts) lost.push({ kind: 'graphique-perdu', detail: card });
          }
          if (lost.length) s.report(where(what), lost);
          if (page !== shown) {
            await s.close();
            await s.open(route);
            shown = await s.page.evaluate(() => document.getElementById('view')?.dataset.page ?? '');
            return false;
          }
          return !found.length;
        };
        const label = (c, v) => (QUIET ? `${c.kind} ${controls.indexOf(c) + 1}${v === undefined ? '' : ` option ${c.options.indexOf(v) + 1}`}` : `${c.css}${v === undefined ? '' : ` = ${v}`}`);
        // one by one
        for (const c of controls) {
          if (c.kind === 'select') {
            for (const v of c.options.filter((v) => v !== c.on).slice(0, 12)) {
              if (await act(s, c.css, { value: v })) await after(label(c, v));
            }
            if (await act(s, c.css, { value: c.on })) await after(`${label(c)} rétabli`);
          } else if (c.kind === 'radio') {
            const was = controls.find((o) => o.group === c.group && o.on);
            if (!c.on && (await act(s, c.css, {}))) {
              await after(label(c));
              if (was && (await act(s, was.css, {}))) await after(`${label(was)} rétabli`);
            }
          } else {
            if (await act(s, c.css, { set: !c.on })) await after(label(c), true);
            if (await act(s, c.css, { set: c.on })) await after(`${label(c)} rétabli`, true);
          }
        }
        // every group of checkboxes / chips all on, all off
        const groups = Map.groupBy(
          controls.filter((c) => c.kind === 'case' || c.kind === 'bascule'),
          (c) => c.group,
        );
        for (const [g, cs] of groups) {
          if (cs.length < 2) continue;
          for (const set of [true, false]) {
            for (const c of cs) if (await act(s, c.css, { set })) await settle(s.page);
            await after(`${QUIET ? `groupe ${g}` : cs.map((c) => c.css).join(' + ')} : ${set ? 'tout coché' : 'tout décoché'}`, true);
          }
          for (const c of cs) if (await act(s, c.css, { set: c.on })) await settle(s.page);
          await after(`groupe ${g} rétabli`, true);
        }
      } catch (err) {
        s.report(where('(exploration)'), [{ kind: 'exception', detail: String(err).slice(0, 300) }]);
        await s.close();
        await s.open();
      }
    }
  } catch (err) {
    record({ fixture: job.run.name, display: job.display, route: '(ouverture)' }, [{ kind: 'exception', detail: String(err).slice(0, 300) }]);
  } finally {
    await s.close();
  }
}

// ------------------------------------------------------------------ self-test
/**
 * A sweep that cannot fail proves nothing: on one page, a card « NaN », an empty card and a
 * too wide block are slipped in (and a chart whose axis repeats a label, #398), and the invariants
 * must see all four before anything else runs.
 * The too wide block carries a text, an id, a class and attribute values: the quiet diagnosis of
 * the overflow (printed on real data) must name its path and none of them.
 */
async function selfTest(browser, run, display) {
  const s = new Session(browser, run, display, () => {});
  try {
    await s.open();
    await s.page.evaluate(() => {
      const view = document.getElementById('view');
      const card = (text) => {
        const c = document.createElement('section');
        c.className = 'card';
        const h = document.createElement('h2');
        h.textContent = 'Auto-contrôle';
        c.append(h);
        if (text) c.append(Object.assign(document.createElement('p'), { textContent: text }));
        view.append(c);
      };
      card('Total : NaN kWh');
      card('');
      // a too wide block made of « data »: a text, an id, a class and attribute values that the
      // quiet diagnosis must never print (real data: the logs are public)
      const wide = document.createElement('div');
      wide.className = 'card secret-classe-42';
      wide.id = 'secret-id-42';
      wide.title = 'secret-titre-42';
      wide.dataset.room = 'secret-attribut-42';
      const inner = document.createElement('span');
      inner.className = 'secret-classe-42';
      inner.textContent = 'secret-texte-42';
      inner.style.display = 'inline-block';
      inner.style.width = '3000px';
      wide.append(inner);
      view.append(wide);
      // and a word too long for its line, in a box that fits (only its text sticks out)
      const word = document.createElement('p');
      word.className = 'hint';
      word.textContent = 'secretmot42'.repeat(40);
      word.style.overflowWrap = 'normal'; // the page breaks long words (#view): this one must stick out
      view.append(word);
      // #384: a text painted over another, and a text cut by the box that clips it
      const over = document.createElement('p');
      over.style.position = 'relative';
      over.append(Object.assign(document.createElement('span'), { textContent: 'secret-dessous-42' }));
      const top = Object.assign(document.createElement('span'), { textContent: 'secret-dessus-42' });
      Object.assign(top.style, { position: 'absolute', left: '4px', top: '0' });
      over.append(top);
      view.append(over);
      const clip = document.createElement('div');
      Object.assign(clip.style, { overflow: 'hidden', width: '60px' });
      clip.append(Object.assign(document.createElement('span'), { textContent: 'secret-coupé-42 secret-coupé-42' }));
      clip.firstChild.style.whiteSpace = 'nowrap';
      view.append(clip);
      // and a short word squeezed in a column until it breaks in the middle (« Salo / n »)
      const narrow = Object.assign(document.createElement('p'), { textContent: 'Salon' });
      Object.assign(narrow.style, { width: '2ch', overflowWrap: 'anywhere' });
      view.append(narrow);
      // #398: a chart whose axis wrote « 20 » for two values (as charts.ts notes it)
      const chart = document.createElement('div');
      chart.className = 'chart';
      chart.id = 'auto-controle-axe';
      chart.append(document.createElement('canvas'));
      chart.setAttribute('data-axis-dup-y', '20');
      view.append(chart);
    });
    const found = await s.page.evaluate(pageChecks);
    const kinds = found.map((f) => f.kind);
    const missing = ['texte-interdit', 'carte-vide', 'defilement-horizontal', 'textes-recouverts', 'texte-coupe', 'mot-coupe', 'etiquettes-axe-en-double'].filter((k) => !kinds.includes(k));
    if (found.some((f) => /recouverts|coupe/.test(f.kind) && /secret|Salon/i.test(f.quiet ?? ''))) throw new Error('auto-contrôle : le diagnostic discret d’un texte recouvert ou coupé cite un contenu');
    if (missing.length) throw new Error(`auto-contrôle : invariants muets (${missing.join(', ')})`);
    const quiet = found.find((f) => f.kind === 'defilement-horizontal').quiet ?? '';
    if (!/^\d+ px : div\.card > span/.test(quiet) || !quiet.includes('texte trop long dans : p.hint') || /secret/i.test(quiet))
      throw new Error(`auto-contrôle : diagnostic discret inattendu ou porteur de contenu (${QUIET ? 'masqué' : quiet})`);
  } finally {
    await s.close();
  }
}

// ------------------------------------------------------------------ report
const failures = [];
const roomNames = {};
let pages = 0;
/** Route as printed: rooms are numbered on real data (never their id). */
function shownRoute(w) {
  if (!QUIET || !w.route.startsWith('piece-')) return w.route;
  const i = (roomNames[w.fixture] ?? []).indexOf(w.route);
  return `piece-${i + 1}`;
}
function record(w, found) {
  pages++;
  const name = `${w.fixture} · ${w.display} · ${shownRoute(w)}${w.control ? ` · ${w.control}` : ''}`;
  if (!found.length) {
    if (QUIET) console.log(`page ${name} : OK`);
    return;
  }
  for (const f of found) {
    const item = { ...w, kind: f.kind, detail: f.detail };
    const known = expected(item);
    if (known) item.expected = known;
    failures.push(item);
    const tag = known ? 'échec attendu' : 'échec';
    console.log(QUIET ? `page ${name} : ${tag} : ${f.kind}${f.quiet ? ` → ${f.quiet}` : ''}` : `page ${name} : ${tag} : ${f.kind}${f.detail ? ` → ${f.detail}` : ''}${f.quiet ? ` [discret : ${f.quiet}]` : ''}${known ? ` (${known.why})` : ''}`);
  }
}

// ------------------------------------------------------------------ main
const ROUTES = routes();
let base;
let stop = () => {};
const t0 = Date.now();
try {
  if (env.SWEEP_BASE) base = env.SWEEP_BASE.endsWith('/') ? env.SWEEP_BASE : `${env.SWEEP_BASE}/`;
  else ({ base, stop } = await startPreview(Number(env.E2E_PORT ?? 4196)));

  const remote = !!env.SWEEP_BASE;
  const fixtures = SOURCE === 'data' ? [] : remote ? [] : dataFixtures();
  const runsAll =
    SOURCE === 'data'
      ? [{ name: 'donnees-reelles', data: null }]
      : [{ name: 'demo', data: null }, ...fixtures.map((f) => ({ name: f, data: f, asData: AS_DATA.has(f), ...(RICH.has(f) ? { storage: RICH_STORAGE } : {}) })), ...Object.entries(MODES).map(([name, m]) => ({ name, ...m }))];
  const wanted = list(env.SWEEP_FIXTURES);
  const runs = wanted ? runsAll.filter((r) => wanted.includes(r.name)) : runsAll;
  const displays = list(env.SWEEP_DISPLAYS) ?? Object.keys(DISPLAYS);
  const main = (r) => r.name === 'demo' || r.name === 'donnees-reelles' || RICH.has(r.name);

  const jobs = [];
  for (const run of runs) {
    for (const display of displays) {
      // CI: the plain demo (or real data) and the fuller account (RICH) in every display, axe
      // included; the other fixtures at 360 px.
      if (!FULL && !main(run) && display !== displays[0]) continue;
      jobs.push({ type: 'sweep', run, display, axe: FULL || main(run) });
    }
  }
  if (EXPLORE) {
    const exploreRuns = FULL ? runs : runs.filter((r) => main(r) || r.name in MODES);
    for (const run of exploreRuns) {
      const of = Math.max(1, Math.min(WORKERS, 4));
      for (let part = 0; part < of; part++) jobs.push({ type: 'explore', run, display: displays[0], part, of });
    }
  }
  console.log(
    `Balayage ${SOURCE === 'data' ? 'des vraies données' : remote ? `de ${base}` : 'de la démo'} : ${runs.length} jeu(x), ${displays.join(', ')}, ${ROUTES.length} routes + pièces, ${jobs.length} tâches sur ${WORKERS} navigateur(s)${FULL ? ' (complet)' : ''}.`,
  );
  {
    const browser = await chromium.launch();
    try {
      await selfTest(browser, runs[0], displays[0]);
      console.log('Auto-contrôle : les invariants voient un « NaN », une carte vide, un débordement, deux textes l’un sur l’autre, un texte coupé par sa carte, un mot coupé en son milieu et un axe aux étiquettes en double ; le diagnostic discret ne cite aucun contenu.');
    } finally {
      await browser.close();
    }
  }
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      const browser = await chromium.launch();
      try {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const t = Date.now();
          await (job.type === 'sweep' ? sweepJob : exploreJob)(browser, job);
          console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${job.type === 'sweep' ? 'balayage' : `explorateur ${job.part + 1}/${job.of}`} ${job.run.name} · ${job.display} : ${Math.round((Date.now() - t) / 1000)} s`);
        }
      } finally {
        await browser.close();
      }
    }),
  );
} catch (err) {
  failures.push({ fixture: '-', display: '-', route: '(lancement)', kind: 'exception', detail: String(err) });
  console.error(QUIET ? 'Balayage interrompu : exception' : `Balayage interrompu : ${err}`);
} finally {
  stop();
}

const real = failures.filter((f) => !f.expected);
const known = failures.filter((f) => f.expected);
const stale = EXPECTED.filter((e) => !known.some((f) => f.expected === e));
console.log(`\n${pages} vérifications en ${Math.round((Date.now() - t0) / 1000)} s : ${real.length} échec(s), ${known.length} échec(s) attendu(s).`);
if (!QUIET && real.length) {
  const byKind = Map.groupBy(real, (f) => f.kind);
  for (const [kind, fs] of byKind) console.log(`  ${kind} : ${fs.length} (${[...new Set(fs.map((f) => f.route))].slice(0, 8).join(', ')})`);
}
for (const e of stale) if (!env.SWEEP_FIXTURES && !env.SWEEP_ROUTES) console.log(`Échec attendu qui n'arrive plus (à retirer de EXPECTED) : ${e.route} ${e.kind}`);
process.exit(real.length ? 1 : 0);
