// #353: systematic sweep. Every route of the registry (src/router.ts: the five tabs, each room,
// the sub-pages, every tool, every meter page, every settings page, the first launch) × named
// demo fixtures (python -m collector fixtures, see collector/fixtures.py) × displays (360 px,
// 1280 px, system text at 200 %, dark), with the same invariants everywhere:
//   - no console error and no uncaught exception;
//   - no horizontal scroll;
//   - no « NaN », « undefined », « Infinity », « Invalid Date », « null » visible (text or label);
//   - no card (nor chart) left empty without a message;
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
const EXPECTED = [];
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
  const wide = document.documentElement.scrollWidth - window.innerWidth;
  if (wide > 1) {
    const culprits = [...document.querySelectorAll('#app *')]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(-3)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`);
    out.push({ kind: 'defilement-horizontal', detail: `${wide} px (${culprits.join(', ')})` });
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
    if (SOURCE === 'data') storage.state ??= '{}'; // a device already used: no first launch
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
    else await openDemo(this.page, base, this.run.data, hash);
    if (DISPLAYS[this.display].big) await this.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
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
  const richData = !job.run.data; // the demo itself, its modes, or real data
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
          const lost = [...moved];
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
 * too wide block are slipped in, and the invariants must see all three before anything else runs.
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
      const wide = document.createElement('div');
      wide.style.width = '3000px';
      wide.style.height = '1px';
      view.append(wide);
    });
    const kinds = (await s.page.evaluate(pageChecks)).map((f) => f.kind);
    const missing = ['texte-interdit', 'carte-vide', 'defilement-horizontal'].filter((k) => !kinds.includes(k));
    if (missing.length) throw new Error(`auto-contrôle : invariants muets (${missing.join(', ')})`);
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
    console.log(QUIET ? `page ${name} : ${tag} : ${f.kind}` : `page ${name} : ${tag} : ${f.kind}${f.detail ? ` → ${f.detail}` : ''}${known ? ` (${known.why})` : ''}`);
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
      : [{ name: 'demo', data: null }, ...fixtures.map((f) => ({ name: f, data: f })), ...Object.entries(MODES).map(([name, m]) => ({ name, ...m }))];
  const wanted = list(env.SWEEP_FIXTURES);
  const runs = wanted ? runsAll.filter((r) => wanted.includes(r.name)) : runsAll;
  const displays = list(env.SWEEP_DISPLAYS) ?? Object.keys(DISPLAYS);
  const main = (r) => r.name === 'demo' || r.name === 'donnees-reelles';

  const jobs = [];
  for (const run of runs) {
    for (const display of displays) {
      // CI: the plain demo (or real data) in every display, axe included; the fixtures at 360 px.
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
      console.log('Auto-contrôle : les invariants voient un « NaN », une carte vide et un débordement.');
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
