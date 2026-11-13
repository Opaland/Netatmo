// #594: the keyboard alone (WCAG 2.2, 2.4.7 « Focus visible » and 2.4.11 « Focus non masqué »).
// On every route of the registry (src/router.ts, as the sweep) and every room, at 360 × 800, for
// the demo and the fuller account (fixture « compte-charge », opened as real data, longer names):
// every fold of the view is opened (what is folded by default is what a probe forgets), the focus
// is put back at the start of the page, then Tab until the focus comes back to an element already
// seen (or leaves the page). At each stop, named invariants:
//   - focus-sans-anneau (2.4.7): the focused element draws a ring (outline or box-shadow);
//   - focus-masque (2.4.11): the focused element is PAINTED (document.elementFromPoint at the
//     centre of at least one of its lines, getClientRects(): a link on two lines has its
//     bounding-box centre between them), not under the tab bar, a pinned column, a sheet…;
//   - focus-coupe-tableau: in a scrolled table (.table-wrap), the focused field is painted at
//     both its left and right edges: whole, beside the pinned first column, not under it.
// A self-check first: an element under another, one without a ring and a field half under a
// pinned cell, slipped into the page, must each fail on its invariant.
//
// Run after `npm run build` (and the fixtures, python -m collector fixtures, generated when
// missing): node e2e/clavier.mjs   E2E_PORT=4205  E2E_BROWSER=webkit|chromium
//   CLAVIER_ROUTES=<regex>  CLAVIER_FIXTURES=demo,compte-charge
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { RICH_STORAGE, dataFixtures, frames, goto, openData, openDemo, ready, registryRoutes, roomRoutes, seedStorage, serveFixtureAsData, startPreview } from './lib.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const BROWSER = env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const ROUTE_FILTER = env.CLAVIER_ROUTES ? new RegExp(env.CLAVIER_ROUTES) : null;
const RUNS = [
  { name: 'demo', data: null },
  { name: 'compte-charge', data: 'compte-charge', storage: RICH_STORAGE },
].filter((r) => !env.CLAVIER_FIXTURES || env.CLAVIER_FIXTURES.split(',').includes(r.name));
const VIEWPORT = { width: 360, height: 800 };
const MAX_STOPS = 400; // a page that would hold more stops is itself a finding (see below)

// ------------------------------------------------------------------ in the page
/** Put the sequential focus navigation starting point at the start of the document. */
function focusStart() {
  window.__e2eSeen = new WeakSet();
  let start = document.getElementById('e2e-focus-start');
  if (!start) {
    start = Object.assign(document.createElement('span'), { id: 'e2e-focus-start', tabIndex: -1 });
    document.body.prepend(start);
  }
  start.focus();
}

/** The stop reached by the last Tab: { end } when the walk is over, else { what, kinds }. */
function focusStop() {
  const el = document.activeElement;
  if (!el || el === document.body || el.id === 'e2e-focus-start' || window.__e2eSeen.has(el)) return { end: true };
  window.__e2eSeen.add(el);
  const what = (() => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    return `${tag}${id}${cls}${name ? ` « ${name.slice(0, 40)} »` : ''}`;
  })();
  const kinds = [];
  const cs = getComputedStyle(el);
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  if (!ring) kinds.push('focus-sans-anneau');
  const paints = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  };
  const lines = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  if (!lines.some((r) => paints(r.left + r.width / 2, r.top + r.height / 2))) kinds.push('focus-masque');
  const wrap = el.closest('.table-wrap');
  const notes = [];
  if (wrap && wrap !== el && lines.length) {
    const r = lines[0];
    const y = r.top + r.height / 2;
    // a field wider than the room beside the pinned column cannot be whole: its start (where
    // its value is written) must then sit right after the column, and the rest is a note
    const cell = el.closest('th, td');
    const first = cell?.parentElement?.firstElementChild;
    const pinnedRight = first && first !== cell ? first.getBoundingClientRect().right : wrap.getBoundingClientRect().left;
    const visibleRight = wrap.getBoundingClientRect().left + wrap.clientLeft + wrap.clientWidth;
    const tooWide = r.width > visibleRight - pinnedRight;
    if (!paints(r.left + 2, y) || (!tooWide && !paints(r.right - 2, y))) kinds.push('focus-coupe-tableau');
    else if (tooWide) notes.push('plus-large-que-la-place');
  }
  return { what, kinds, notes };
}

/** Open every fold of the view (and say how many were closed). */
function openFolds() {
  let n = 0;
  for (const d of document.querySelectorAll('#view details:not([open])')) {
    d.open = true;
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ the walk of one page
async function walk(page) {
  await page.evaluate(focusStart);
  const stops = [];
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(focusStop);
    if (s.end) return stops;
    stops.push(s);
  }
  stops.push({ what: `plus de ${MAX_STOPS} arrêts`, kinds: ['focus-sans-fin'] });
  return stops;
}

async function openRun(browser, base, run) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  const storage = { ...(run.storage ?? {}) };
  if (run.data) {
    storage.state ??= '{}'; // a device already used: no first launch
    await serveFixtureAsData(ctx, base, join(WEB, 'dist/demo-fixtures', run.data));
  }
  await seedStorage(ctx, storage);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  if (run.data) await openData(page, base, 'demo');
  else await openDemo(page, base);
  // the CI's wide font everywhere (A6): a field pushed further right here is pushed there too
  await page.addStyleTag({ content: 'html, body, button, input, select, textarea { font-family: "DejaVu Sans", system-ui, sans-serif !important; }' });
  return { ctx, page, errors };
}

const failures = [];
const notes = []; // not failures: what only a decision can settle (said in the report)
let stopsCount = 0;
let pagesCount = 0;

async function walkRun(browser, base, run) {
  const { ctx, page, errors } = await openRun(browser, base, run);
  try {
    const rooms = await roomRoutes(page);
    const all = [...ROUTES.slice(0, 5), ...rooms, ...ROUTES.slice(5)].filter((r) => !ROUTE_FILTER || ROUTE_FILTER.test(r));
    for (const route of all) {
      await goto(page, route);
      if (await page.evaluate(openFolds)) {
        await frames(page);
        await ready(page);
      }
      const stops = await walk(page);
      pagesCount++;
      stopsCount += stops.length;
      for (const s of stops) for (const kind of s.kinds) failures.push({ run: run.name, route, kind, what: s.what });
      for (const s of stops) for (const kind of s.notes ?? []) notes.push({ run: run.name, route, kind, what: s.what });
      if (!stops.length) failures.push({ run: run.name, route, kind: 'aucun-arret', what: 'Tab n’atteint rien' });
    }
    for (const e of errors) failures.push({ run: run.name, route: '-', kind: 'erreur-console', what: e });
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ self-check
async function selfCheck(browser, base) {
  const { ctx, page } = await openRun(browser, base, RUNS[0] ?? { name: 'demo', data: null });
  try {
    await goto(page, ROUTES[0]);
    await page.evaluate(() => {
      const view = document.getElementById('view');
      // under another element (2.4.11)
      const hidden = Object.assign(document.createElement('button'), { id: 'auto-controle-masque', textContent: 'x' });
      const cover = document.createElement('div');
      Object.assign(cover.style, { position: 'relative', zIndex: '50', marginTop: '-44px', height: '60px', background: 'var(--surface-card)' });
      // without a ring (2.4.7)
      const bare = Object.assign(document.createElement('button'), { id: 'auto-controle-sans-anneau', textContent: 'y' });
      bare.style.cssText = 'outline: none !important; box-shadow: none !important;';
      // a field of a scrolled table, its left part under a pinned cell (the bug of #594)
      const wrap = Object.assign(document.createElement('div'), { className: 'table-wrap', tabIndex: 0 });
      const el = (tag, props = {}, css = '') => Object.assign(document.createElement(tag), props, css ? { style: css } : {});
      const pinned = el('td', { textContent: 'Tableau électrique fictif' });
      const cell = el('td', {}, 'position: relative');
      cell.append(el('input', { id: 'auto-controle-tableau', ariaLabel: 'z' }), el('span', {}, 'position: absolute; z-index: 3; left: 0; top: 0; bottom: 0; width: 40%; background: var(--surface-card)'));
      const row = el('tr');
      row.append(pinned, cell);
      const table = el('table');
      table.append(el('tbody'));
      table.firstChild.append(row);
      wrap.append(table);
      view.append(hidden, cover, bare, wrap);
    });
    const kinds = (await walk(page)).filter((s) => s.what.includes('auto-controle')).flatMap((s) => s.kinds.map((k) => `${s.what.split(' ')[0]} ${k}`));
    const want = ['button#auto-controle-masque focus-masque', 'button#auto-controle-sans-anneau focus-sans-anneau', 'input#auto-controle-tableau focus-coupe-tableau'];
    const missing = want.filter((w) => !kinds.includes(w));
    if (missing.length) throw new Error(`auto-contrôle : invariants muets (${missing.join(', ')}) ; vus : ${kinds.join(', ') || 'aucun'}`);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ main
const ROUTES = registryRoutes();
const t0 = Date.now();
const { base, stop } = await startPreview(Number(env.E2E_PORT ?? 4205));
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
let crashed = null;
try {
  if (RUNS.some((r) => r.data)) dataFixtures();
  await selfCheck(browser, base);
  console.log(`Auto-contrôle (${BROWSER}) : un élément focalisé sous un autre, un focus sans anneau et un champ à moitié sous une colonne collante sont vus.`);
  for (const run of RUNS) await walkRun(browser, base, run);
} catch (err) {
  crashed = err;
} finally {
  await browser.close();
  stop();
}
for (const f of notes) console.log(`note : ${f.run} · ${f.route} : ${f.kind} → ${f.what}`);
for (const f of failures) console.log(`échec : ${f.run} · ${f.route} : ${f.kind} → ${f.what}`);
console.log(`\nParcours au clavier (${BROWSER}, 360 × 800) : ${pagesCount} pages, ${stopsCount} arrêts en ${Math.round((Date.now() - t0) / 1000)} s : ${failures.length} échec(s).`);
if (crashed) {
  console.error(`Parcours interrompu : ${crashed}`);
  process.exit(1);
}
process.exit(failures.length ? 1 : 0);
