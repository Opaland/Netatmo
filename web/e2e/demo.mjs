// S-1.9: visual smoke test of the demo, every view, light and dark, mobile and desktop.
// S-7.6: axe-core audit of every view (fails on "serious" or "critical"), keyboard route.
// S-7.7: high contrast (7:1 checked by axe), forced colours, system text at 200 % in simple mode.
// S-7.8, S-7.11, S-7.12: pinned room, swipe, offline.
// Run after `npm run build`: node e2e/demo.mjs  (starts `vite preview` itself; port: E2E_PORT).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4179);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
// A port that already answers belongs to another server: never test someone else's build.
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
// vite itself (not npx): kill() must stop the server, not only a wrapper.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
// With --strictPort the server exits at once when the port is taken: never test someone else's build.
let serverExited = false;
server.on('exit', () => (serverExited = true));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    if (serverExited) throw new Error(`port ${PORT} déjà utilisé (choisir E2E_PORT=…)`);
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const errors = [];
const check = (ok, msg) => ok || errors.push(msg);

/** axe-core on the current page: WCAG A/AA (and AAA contrast when asked), serious and critical only. */
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${s}`);

async function audit(page, where, { enhanced = false } = {}) {
  progress(`axe ${where}`);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])];
  const builder = new AxeBuilder({ page }).withTags(tags);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    const nodes = v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}${n.failureSummary ? ` (${n.failureSummary.split('\n').slice(1).join(' ').trim()})` : ''}`);
    errors.push(`${where} : axe ${v.impact} « ${v.id} » ${v.help} → ${nodes.join(' | ')}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3})` : ''}`);
  }
}

async function openDemo(page) {
  await page.goto(base);
  await page.click('#demo');
  await page.waitForSelector('header.top', { timeout: 30000 });
}

/** Keyboard only: tabs, charts and menu (S-7.6). */
async function keyboard(page, name) {
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      const cs = el ? getComputedStyle(el) : null;
      return {
        view: el?.getAttribute('data-view') ?? null,
        chart: !!el?.classList.contains('chart'),
        label: el?.getAttribute('aria-label') ?? '',
        summary: el?.tagName === 'SUMMARY' && !!el.closest('.menu'),
        outline: cs ? cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 : false,
      };
    });
  await page.click('[data-view=overview]');
  await page.evaluate(() => document.activeElement?.blur());
  let f;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (f.view === 'compare') break;
  }
  check(f?.view === 'compare', `${name}/clavier : l'onglet « Comparer » n'est pas atteignable au clavier`);
  check(f?.outline, `${name}/clavier : focus invisible sur l'onglet`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-view=compare][aria-current=page]');
  await page.waitForTimeout(400);
  let charts = 0;
  for (let i = 0; i < 80 && charts < 2; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (f.chart) {
      charts++;
      check(f.outline, `${name}/clavier : focus invisible sur un graphique`);
      check(/\d/.test(f.label) && f.label.length > 30, `${name}/clavier : graphique sans résumé (« ${f.label} »)`);
    }
  }
  check(charts >= 2, `${name}/clavier : graphiques non atteignables au clavier`);
  await page.focus('.menu summary');
  await page.keyboard.press('Enter');
  check(await page.locator('.menu[open]').count(), `${name}/clavier : le menu ne s'ouvre pas avec Entrée`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.menu[open]').count()), `${name}/clavier : Échap ne ferme pas le menu`);
  check((await focused()).summary, `${name}/clavier : le focus ne revient pas au bouton du menu`);
}

/** Synthetic touch swipe (pointer events, as a finger would send them). */
async function swipe(page, selector, dx) {
  await page.evaluate(
    ({ selector, dx }) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const opts = (cx) => ({ bubbles: true, pointerType: 'touch', pointerId: 7, clientX: cx, clientY: y, isPrimary: true });
      el.dispatchEvent(new PointerEvent('pointerdown', opts(x)));
      el.dispatchEvent(new PointerEvent('pointerup', opts(x + dx)));
    },
    { selector, dx },
  );
  await page.waitForTimeout(300);
}

let failed = false;

// S-8.9: every CSP violation (Trusted Types included) is recorded in the page and fails the run.
const recordViolations = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ''} ${(e.sample || '').slice(0, 60)}`.trim()),
  );
};
const checkViolations = async (page, where) => {
  for (const v of await page.evaluate(() => window.__csp ?? [])) errors.push(`${where}: violation CSP ${v}`);
};
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const [name, opts] of [
    ['mobile-clair', { ...devices['iPhone 13'] }],
    ['mobile-sombre', { ...devices['Pixel 7'], colorScheme: 'dark' }],
    ['bureau', { viewport: { width: 1280, height: 900 } }],
    // smallest common Android width: only the tab bar and the comfort view (five tabs must fit)
    ['mobile-360', { viewport: { width: 360, height: 740 }, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await page.goto(base);
    await page.waitForSelector('#demo');
    await audit(page, `${name}/verrou`);
    await page.click('#demo');
    await page.waitForSelector('.kpi', { timeout: 30000 });
    for (const view of name === 'mobile-360' ? [] : ['overview', 'compare', 'rooms', 'analyse']) {
      await page.click(`[data-view=${view}]`);
      await page.waitForTimeout(view === 'analyse' ? 2000 : 600);
      if (view === 'overview') {
        // Linky 30-min load curve card (lazy module + lazy documents)
        try {
          await page.waitForSelector('#curve-day-chart canvas', { timeout: 15000 });
          const talon = await page.locator('#curve-talon').innerText();
          if (!/\d\s?W/.test(talon)) errors.push(`${name}/overview: talon de veille absent (${talon})`);
          if ((await page.locator('#curve-card canvas').count()) < 2) errors.push(`${name}/overview: courbe de charge incomplète`);
        } catch (err) {
          errors.push(`${name}/overview: carte « Courbe de charge » non rendue (${err})`);
        }
        // S-1.10: lost days rebuilt apart, on demand (lazy module)
        try {
          await page.click('#quality summary');
          await page.check('[data-recon]');
          await page.waitForSelector('#recon-chart canvas', { timeout: 15000 });
          if (!(await page.getByText('Jours suspects').count())) errors.push(`${name}/overview: jours suspects absents`);
        } catch (err) {
          errors.push(`${name}/overview: reconstitution non rendue (${err})`);
        }
      }
      if (view === 'analyse') {
        // S-3.7: indoor − outdoor signature (lazy module)
        try {
          await page.waitForSelector('#indoor-sig-chart canvas', { timeout: 15000 });
        } catch (err) {
          errors.push(`${name}/analyse: signature intérieur − extérieur non rendue (${err})`);
        }
      }
      const charts = await page.locator('.chart canvas').count();
      if (!charts) errors.push(`${name}/${view}: aucun graphique rendu`);
      if (view === 'analyse' && !(await page.locator('#insight-card .insight-usage').count())) errors.push(`${name}/analyse: carte IA (S-5.8) non rendue`);
      // Tooltip (ECharts) shown then hidden: goes through the Trusted Types policy.
      if (charts && !opts.isMobile) {
        const canvas = page.locator('.chart canvas').first();
        const { width, height } = (await canvas.boundingBox()) ?? { width: 0, height: 0 };
        await canvas.hover({ position: { x: width * 0.6, y: height * 0.6 } });
        await page.waitForTimeout(400);
        if (view === 'overview' && !(await page.locator('.tt').count())) errors.push(`${name}/${view}: infobulle ECharts absente`);
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await checkViolations(page, `${name}/${view}`);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
      await audit(page, `${name}/${view}`);
    }
    if (name === 'bureau') {
      try {
        // S-9.6: « volets fermés » card (lazy module) in Analyse
        await page.waitForSelector('#shutters-card', { timeout: 10000 });
        // S-12.2: bedrooms merged by default, detail on demand until the next lock
        const picker = () => page.locator('.rooms-panel').textContent();
        if (!(await picker()).includes('Chambres') || (await picker()).includes('Chambre parentale')) errors.push('vue foyer : chambres non regroupées');
        const openMenu = async () => (await page.locator('.menu').getAttribute('open')) === null && (await page.click('.menu summary'));
        await page.click('[data-view=overview]');
        await openMenu();
        await page.click('[data-household=reveal]');
        if (!(await picker()).includes('Chambre parentale')) errors.push('vue foyer : détail non affiché');
        await openMenu();
        await page.click('[data-household=hide]');
        await openMenu();
        // S-8.14: « Cadre juridique » from Paramètres (lazy module)
        await page.click('.menu-panel [data-view=settings]');
        await page.click('#legal-open');
        await page.waitForSelector('#legal-card .legal-list', { timeout: 10000 });
        await page.screenshot({ path: `${OUT}/${name}-juridique.png`, fullPage: true });
      } catch (err) {
        errors.push(`${name}: vue foyer / volets / cadre juridique (${err})`);
      }
    }
    // S-11 / S-3.8: comfort view (lazy chunk), bedroom detail on a deliberate gesture, other threshold
    await page.click('[data-view=comfort]');
    await page.waitForSelector('#cold-chart canvas', { timeout: 15000 });
    await page.click('[data-comfort=show-bedrooms]');
    await page.waitForSelector('#co2-0 canvas');
    await page.selectOption('select[data-comfort=threshold]', '18');
    await page.waitForFunction(() => !document.querySelector('#view td.num')?.closest('table')?.textContent?.includes('…'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    for (const id of ['co2-0', 'cellar-0', 'cold-chart', 'probe-0']) {
      if (!(await page.locator(`#${id} canvas`).count())) errors.push(`${name}/comfort: graphique ${id} absent`);
    }
    if (!(await page.getByText('Heures sous 18,0 °C').count())) errors.push(`${name}/comfort: seuil 18 °C non appliqué`);
    const overflow = await page.evaluate(() => {
      const t = document.querySelector('.tabs');
      return t ? t.scrollWidth > t.clientWidth + 1 : false;
    });
    if (overflow) errors.push(`${name}: barre d'onglets plus large que l'écran`);
    await page.screenshot({ path: `${OUT}/${name}-comfort.png`, fullPage: true });
    await page.selectOption('select[data-comfort=threshold]', '19');

    await page.click('.menu summary');
    await page.click('.menu-panel [data-view=report]');
    await page.waitForSelector('.report');
    // S-6.3: offer comparator and maximum power in the annual report (lazy module)
    try {
      await page.waitForSelector('#report-offers table', { timeout: 15000 });
      await page.waitForSelector('#report-pmax table', { timeout: 15000 });
    } catch (err) {
      errors.push(`${name}/report: comparateur ou pic de puissance absent (${err})`);
    }
    // S-5.9: a canned question answered by code
    await page.click('[data-question=normal]');
    await page.waitForSelector('.question-answer li', { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/${name}-report.png`, fullPage: true });
    // S-6.4: anonymised report, without any room or home name of the demo
    const roomNames = await page.locator('#report-waterfall ~ .table-wrap').first().locator('tbody td:first-child').allInnerTexts();
    const homeName = (await page.locator('.top h1').innerText()).replace(/\s*démo$/i, '').trim();
    if (roomNames.length < 2) errors.push(`${name}/report: tableau des pièces introuvable`);
    await page.click('#report-anon');
    await page.waitForSelector('.anon-report #anon-chart canvas', { timeout: 15000 });
    const anon = await page.locator('.anon-report').innerText();
    for (const secret of [homeName, ...roomNames.filter((n) => !/^chauffe-eau$/i.test(n.trim()))]) {
      if (anon.includes(secret)) errors.push(`${name}/anonymisé: « ${secret} » apparaît`);
    }
    if (!/Pièce A/.test(anon) || !/Période/.test(anon)) errors.push(`${name}/anonymisé: pseudonymes ou période absents`);
    await page.screenshot({ path: `${OUT}/${name}-report-anonymise.png`, fullPage: true });
    // S-9.7: long export, generated in the page
    if (name === 'bureau') {
      await page.click('.menu summary');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-long=csv]')]);
      const head = readFileSync(await dl.path(), 'utf8').split('\n')[0];
      if (head !== 'date,source,entity,metric,value,unit') errors.push(`export long : en-tête inattendu (${head})`);
      if (!/^energie-long-v1-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())) errors.push(`export long : nom ${dl.suggestedFilename()}`);
    }
    await audit(page, `${name}/report`);
    if (!(await page.locator('.menu[open]').count())) await page.click('.menu summary');
    await audit(page, `${name}/menu`);
    await page.click('.menu-panel [data-view=settings]');
    await page.waitForTimeout(400);
    await audit(page, `${name}/settings`);

    if (name === 'bureau') await keyboard(page, name);

    if (name === 'mobile-clair') {
      // S-7.11: swipe on the header changes the period, on the tab bar the view.
      await page.click('[data-view=overview]');
      await page.waitForTimeout(400);
      const period = () => page.$eval('select[data-set=period]', (s) => s.value);
      const before = await period();
      await swipe(page, '.top .title', 120);
      const older = await period();
      check(older !== before, `${name}/glisser : la période ne change pas (${before})`);
      await swipe(page, '.top .title', -120);
      check((await period()) === before, `${name}/glisser : retour impossible à la période ${before}`);
      await swipe(page, '.tabs', -120);
      check(await page.locator('[data-view=compare][aria-current=page]').count(), `${name}/glisser : l'onglet ne change pas`);
      check(/Comparer/.test(await page.textContent('#sr-status')), `${name}/glisser : changement non annoncé`);

      // S-7.8 + S-7.7: pinned room in simple mode, system text at 200 %, nothing cut.
      await page.click('.menu summary');
      const room = await page.$eval('select[data-pin] option:nth-child(2)', (o) => o.value);
      await page.selectOption('select[data-pin]', room);
      await page.check('.menu-panel [data-toggle=simple]');
      await page.waitForSelector('body.is-simple');
      check((await page.locator('.kpi.pinned').count()) >= 1, `${name}/épingle : pièce épinglée absente du mode simple`);
      check(
        (await page.locator('.kpis > .kpi').first().getAttribute('class')).includes('pinned'),
        `${name}/épingle : la pièce épinglée n'est pas en premier`,
      );
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(300);
      const cut = await page.evaluate(() => {
        const out = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`);
        for (const el of document.querySelectorAll('.top *, .verdict *, .kpi, .kpi *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('details:not([open]) > :not(summary)')) continue;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflowX !== 'visible') out.push(el.className || el.tagName);
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1) out.push(`${el.className || el.tagName} déborde (${Math.round(r.right)}px)`);
        }
        return out;
      });
      check(!cut.length, `${name}/texte 200 % : texte tronqué ou débordant → ${cut.slice(0, 5).join(', ')}`);
      await page.screenshot({ path: `${OUT}/${name}-simple-200.png`, fullPage: true });
      await page.click('.menu summary');
      await page.uncheck('.menu-panel [data-toggle=simple]');
    }
    await checkViolations(page, `${name}/report+settings`);
    await ctx.close();
  }

  // S-7.7: high contrast (axe checks the enhanced 7:1 ratio) and forced colours, light and dark.
  for (const [name, opts] of [
    ['contraste-clair', { viewport: { width: 1280, height: 900 }, contrast: 'more' }],
    ['contraste-sombre', { ...devices['Pixel 7'], colorScheme: 'dark', contrast: 'more' }],
    ['couleurs-forcees', { viewport: { width: 1280, height: 900 }, forcedColors: 'active' }],
  ]) {
    const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await openDemo(page);
    // S-7.8: pinned room in simple mode under Trusted Types (insertAdjacentHTML path).
    await page.click('.menu summary');
    await page.selectOption('select[data-pin]', { index: 1 });
    await page.check('.menu-panel [data-toggle=simple]');
    await page.waitForSelector('.kpi.pinned');
    await page.click('.menu summary');
    await page.uncheck('.menu-panel [data-toggle=simple]');
    await checkViolations(page, `${name}/épingle`);
    for (const view of ['overview', 'compare']) {
      await page.click(`[data-view=${view}]`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${name}-${view}.png`, fullPage: true });
      await audit(page, `${name}/${view}`, { enhanced: name !== 'couleurs-forcees' });
    }
    await ctx.close();
  }

  // S-7.12: once visited, the demo opens offline, with a banner instead of errors.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`hors-ligne: ${e.message}`));
    await page.goto(base);
    progress('hors ligne : installation du service worker');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => {
          navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
          setTimeout(r, 10000);
        });
      }
    });
    await openDemo(page); // through the service worker: files are cached
    await page.click('[data-view=analyse]');
    await page.waitForSelector('#hour-grid canvas', { timeout: 20000 });
    await ctx.setOffline(true);
    progress('hors ligne : ouverture de la démo');
    await openDemo(page).catch(async (e) => {
      throw new Error(`hors-ligne : la démo ne s'ouvre pas (${(await page.textContent('#app'))?.slice(0, 200)}) ${e.message.split('\n')[0]}`);
    });
    await page.waitForSelector('#net-status:not([hidden])', { timeout: 5000 });
    const banner = await page.textContent('#net-status');
    check(/Hors ligne/.test(banner) && /profil horaire compris/.test(banner), `hors-ligne : bandeau inattendu « ${banner} »`);
    await page.click('[data-view=analyse]');
    await page.waitForSelector('#hour-grid canvas', { timeout: 20000 }).catch(() => errors.push('hors-ligne : profil horaire absent'));
    await page.screenshot({ path: `${OUT}/hors-ligne-analyse.png`, fullPage: true });
    await ctx.close();
  }
  // S-8.9: Trusted Types enforced (a raw string is refused) and libsodium still works under it.
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(recordViolations);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('#demo');
    const raw = await page.evaluate(() => {
      try {
        document.body.insertAdjacentHTML('beforeend', '<b>brut</b>');
        return 'accepté';
      } catch (e) {
        return e.name;
      }
    });
    if (raw !== 'TypeError') errors.push(`Trusted Types non appliqué : innerHTML brut ${raw}`);
    const seen = await page.evaluate(() => window.__csp);
    if (!seen.some((v) => v.startsWith('require-trusted-types-for'))) errors.push('Trusted Types : aucune violation signalée pour un innerHTML brut');
    const sodium = readdirSync('dist/assets').find((f) => f.startsWith('libsodium-wrappers-') && f.endsWith('.js'));
    const sealed = await page.evaluate(async (path) => {
      const { default: s } = await import(path);
      await s.ready;
      const kp = s.crypto_box_keypair();
      return s.crypto_box_seal(s.from_string('test'), kp.publicKey).length;
    }, `./assets/${sodium}`);
    if (sealed !== 4 + 48) errors.push(`libsodium sous Trusted Types : scellement inattendu (${sealed})`);
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(String(err));
} finally {
  server.kill();
}
if (errors.length) {
  failed = true;
  console.error(errors.join('\n'));
}
console.log(failed ? 'E2E : ÉCHEC' : 'E2E : OK (captures dans ' + OUT + ')');
process.exit(failed ? 1 : 0);
