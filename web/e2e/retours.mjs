// v1.6 retours du propriétaire, in the demo:
// - Air et confort, card « Radiateur et station » (S-3.8): every indoor module of the station is
//   offered for every room, whatever its name (« Cave » for a bedroom); a room linked to a module
//   of another name is compared (heading, mean gap, chart), an unlinked room is not.
// - Outils › Télétravail (S-4.9): the table stays shown, with consistent rows, for 0 to 5 weekdays
//   ticked (5 used to empty the card: no « office » day left to compare with).
// Axe in light, dark and high contrast, 360 px with the text at 200 % (no horizontal scroll).
// Run after `npm run build`: node e2e/retours.mjs  (starts `vite preview` itself; port: E2E_PORT;
// E2E_BROWSER=webkit|chromium). Captures in e2e/screenshots/retours-*.png.
import { spawn } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { chromium, webkit } from 'playwright';
import { capturesOut } from './captures.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const PORT = Number(process.env.E2E_PORT ?? 4189);
const OUT = capturesOut(); // #583: e2e/screenshots/ only in the CI's font
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let serverExited = false;
server.on('exit', () => (serverExited = true));
const base = `http://localhost:${PORT}/`;
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${BROWSER} ${s}`);

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

const ready = (page) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout: 30000 });
async function go(page, key) {
  await page.evaluate((k) => (location.hash = `#${k}`), key);
  await page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
}
async function audit(page, where, enhanced = false) {
  progress(`axe ${where}`);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])]);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
    errors.push(`${BROWSER} ${where} : axe « ${v.id} » → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const probeTitles = (page) => page.$$eval('#probe-card h3', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
/** Rooms linked on the card (select with a module chosen), by name. */
const linkedRooms = (page) =>
  page.$$eval('#probe-card select[data-map-room]', (els) => els.filter((s) => s.value).map((s) => s.closest('tr').querySelector('th, td').textContent.trim()));

/**
 * Clicks a segment below the fold (`want`: a selector, else the last unchecked segment button of
 * the page that starts beyond the first screen) and checks that the page does not jump (#370: the
 * segment kept within a few px of where it was on screen once the redrawn page has settled, even
 * when the content above it changed height) and that the focus stays on it.
 */
async function segmentKeepsPlace(page, where, want) {
  const target = await page.evaluate((w) => {
    const all = [...document.querySelectorAll(w ?? '#view .seg button[aria-checked="false"]')].filter((b) => b.offsetParent);
    const top = (b) => b.getBoundingClientRect().top + window.scrollY;
    const below = all.filter((b) => top(b) > window.innerHeight);
    // a period bar sits at the top of its page: scroll just enough to tuck the header away
    const b = below[below.length - 1] ?? all[0];
    if (!b) return null;
    const header = Math.max(0, ...[...document.querySelectorAll('header.top, .tabs')].map((h) => (getComputedStyle(h).position === 'sticky' ? h.getBoundingClientRect().bottom : 0)).filter((y) => y < window.innerHeight / 2));
    return { sel: `button[data-set="${b.dataset.set}"][data-value="${b.dataset.value}"]`, y: below.length ? Math.max(0, top(b) - window.innerHeight / 2) : Math.max(0, top(b) - header - 8), below: below.length > 0 };
  }, want ?? null);
  if (!target) return errors.push(`${BROWSER} ${where} : aucun segment`);
  const { sel, y, below } = target;
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(200);
  const at = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
  const before = await page.evaluate(() => window.scrollY);
  const top0 = await page.evaluate(at, sel);
  await page.click(sel);
  await page.waitForSelector(`${sel}[aria-checked="true"]`, { state: 'attached', timeout: 15000 });
  await ready(page);
  await page.waitForTimeout(400); // late charts and lazy cards
  const after = await page.evaluate(() => window.scrollY);
  const top1 = await page.evaluate(at, sel);
  const focused = await page.evaluate((s) => document.activeElement === document.querySelector(s), sel);
  check(!below || before > 0, `${where} : le segment ${sel} n'a pas pu être amené sous la ligne de flottaison`);
  check(top0 !== null && top1 !== null && Math.abs(top1 - top0) <= 5, `${where} : le clic sur ${sel} fait sauter la page (segment à ${Math.round(top0)} → ${Math.round(top1)} px de l'écran, défilement ${before} → ${after} px)`);
  check(focused, `${where} : le focus quitte ${sel} après le clic`);
  return before;
}

/**
 * #553: the same rule for a select that redraws its card (« Comparer » of « Hiver contre hiver »):
 * choosing a value keeps the select where it was on the screen and keeps the focus on it.
 */
async function selectKeepsPlace(page, where, sel, value) {
  const y = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const header = Math.max(0, ...[...document.querySelectorAll('header.top, .tabs')].map((h) => (getComputedStyle(h).position === 'sticky' ? h.getBoundingClientRect().bottom : 0)).filter((y) => y < window.innerHeight / 2));
    return Math.max(0, el.getBoundingClientRect().top + window.scrollY - header - 8);
  }, sel);
  if (y === null) return errors.push(`${BROWSER} ${where} : pas de liste ${sel}`);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(200);
  const at = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
  const top0 = await page.evaluate(at, sel);
  // a property, not a data-* attribute: the app finds the focused control again by its data-*
  await page.evaluate((s) => (document.querySelector(s).e2eOld = true), sel);
  await page.focus(sel);
  await page.selectOption(sel, value);
  // the card is redrawn: a new select, with the value chosen
  await page.waitForFunction(([s, v]) => !document.querySelector(s)?.e2eOld && document.querySelector(s)?.value === v, [sel, value], { timeout: 15000 });
  await ready(page);
  await page.waitForTimeout(400); // late charts and lazy cards
  const top1 = await page.evaluate(at, sel);
  const focused = await page.evaluate((s) => document.activeElement === document.querySelector(s), sel);
  check(top0 !== null && top1 !== null && Math.abs(top1 - top0) <= 5, `${where} : choisir « ${value} » dans ${sel} fait sauter la page (${Math.round(top0)} → ${Math.round(top1)} px de l'écran)`);
  check(focused, `${where} : le focus quitte ${sel} après le choix « ${value} »`);
}

/** Ticks the first `n` weekdays of the telework card (Monday first), one change at a time. */
async function tickDays(page, n) {
  for (let i = 0; i < 5; i++) {
    const box = page.locator(`#telework-card [data-tw-day="${i}"]`);
    const want = i < n;
    if ((await box.isChecked()) !== want) {
      await box.setChecked(want);
      await page.waitForFunction(([d, w]) => document.querySelector(`#telework-card [data-tw-day="${d}"]`)?.checked === w, [i, want], { timeout: 15000 });
    }
  }
  await ready(page);
}

try {
  await waitForServer();
  const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
  const runs = [
    ['clair', { viewport: { width: 390, height: 900 } }],
    ['sombre', { viewport: { width: 390, height: 900 }, colorScheme: 'dark' }],
    ['contraste', { viewport: { width: 390, height: 900 }, contrast: 'more' }, true],
    ['texte-200', { viewport: { width: 360, height: 800 } }, false, true],
  ];
  for (const [name, opts, enhanced, big] of runs) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${BROWSER} ${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${BROWSER} ${name} console: ${m.text()}`));
    await page.goto(base);
    await page.click('#demo');
    await page.waitForSelector('header.top', { timeout: 30000 });
    if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    // ---------------------------------------------------------------- Air et confort: radiator vs station
    progress(`${name} : Air et confort`);
    await go(page, 'confort');
    // #452: the setup of « Niveau inférieur » opens by itself; it must not turn « Voir les valeurs »
    // on for every table of the app (Accueil grew by a table after a visit to Air et confort)
    await page.waitForSelector('#lower-card #lower-setup[open]', { timeout: 15000 });
    await go(page, 'accueil');
    // the values fold of Accueil is drawn after `ready`: counting before it would find nothing
    await page.waitForSelector('#consumption-card details.table-details', { state: 'attached', timeout: 15000 });
    check((await page.locator('#view details.table-details[open]').count()) === 0, `${name} : visiter Air et confort ouvre les tableaux de l'Accueil`);
    // #546: « Comment c'est calculé » has the look of « Voir les valeurs » but is not that
    // preference: opening it must not open the tables of the next screen
    // the `toggle` event is queued after the click: wait for it, or the next screen replaces the
    // fold before main.ts hears it (and the check passes for nothing)
    await page.locator('#view .verdict details.table-details').first().evaluate(
      (d) => new Promise((done) => {
        d.addEventListener('toggle', done, { once: true });
        d.querySelector('summary').click();
      }),
    );
    check(await page.locator('#view .verdict details.table-details').first().evaluate((d) => d.open), `${name} : « Comment c'est calculé » de l'Accueil ne s'ouvre pas`);
    await go(page, 'confort');
    await go(page, 'accueil');
    await page.waitForSelector('#consumption-card details.table-details', { state: 'attached', timeout: 15000 });
    check((await page.locator('#view details.table-details[open] table').count()) === 0, `${name} : ouvrir « Comment c'est calculé » ouvre les tableaux de valeurs`);
    await go(page, 'confort');
    await page.waitForSelector('#probe-card', { timeout: 15000 });
    // #498: the explanation is folded under « Comment lire l’écart moyen »: still in the card
    const card = await page.locator('#probe-card').textContent();
    check(/écart moyen/i.test(card) && /recalez la consigne/.test(card), `${name} : la carte radiateur/station n'explique pas l'écart moyen ni son usage`);
    // every select offers every indoor module, « Cave » included; never the outdoor one
    const options = await page.$$eval('#probe-card select[data-map-room]', (els) => els.map((s) => [...s.options].map((o) => o.textContent.replace(' (suggéré)', '').trim())));
    check(options.length >= 4, `${name} : sélecteurs de module absents (${options.length})`);
    check(
      options.every((o) => o.includes('Cave') && o.includes('Salon') && o.includes('Chambre enfants') && !o.includes('Extérieur')),
      `${name} : modules proposés incomplets (${JSON.stringify(options[0])})`,
    );
    // one comparison per linked room, none for an unlinked room
    let linked = await linkedRooms(page);
    let titles = await probeTitles(page);
    check(linked.length >= 1 && titles.length === linked.length, `${name} : ${titles.length} comparaison(s) pour ${linked.length} pièce(s) liée(s)`);
    check(linked.every((r) => titles.some((t) => t.startsWith(r))), `${name} : pièce liée sans comparaison (${linked.join(', ')} / ${titles.join(' | ')})`);
    check(!titles.some((t) => t.startsWith('Chambre parentale')), `${name} : la chambre parentale (non liée) est comparée`);
    check((await page.locator('#probe-card canvas').count()) >= 1, `${name} : graphique radiateur/station absent`);

    if (name === 'clair' || name === 'texte-200') {
      // the demo of a room linked to a module of another name: « Chambre parentale » ↔ « Cave »
      progress(`${name} : chambre parentale liée au module Cave`);
      await page.locator('#probe-links > summary').click();
      await page.selectOption('#probe-card select[data-map-room="r-ch1"]', { label: 'Cave' });
      await page.waitForFunction(() => [...document.querySelectorAll('#probe-card h3')].some((h) => h.textContent.includes('Chambre parentale')), null, { timeout: 15000 });
      await ready(page);
      titles = await probeTitles(page);
      check(titles.some((t) => /^Chambre parentale .*« Cave »/.test(t)), `${name} : pièce liée à « Cave » non comparée (${titles.join(' | ')})`);
      const idx = titles.findIndex((t) => t.startsWith('Chambre parentale'));
      await page.waitForSelector(`#probe-${idx} canvas`, { timeout: 15000 }).catch(() => errors.push(`${name} : graphique Chambre parentale ↔ Cave absent`));
      const text = await page.locator('#view').innerText();
      check(/Station \(Cave\)/.test(text), `${name} : le confort de la chambre parentale n'utilise pas le module Cave`);
      check((await page.locator('#cellar-0').count()) === 0, `${name} : le module Cave lié à une chambre reste traité comme une cave`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur Air et confort (${await wide(page)} px)`);
      await audit(page, `${name}/confort-lien`, enhanced);
      await page.locator('#probe-card').screenshot({ path: `${OUT}/retours-${BROWSER}-${name}-confort-cave.png` });
      // unlinked again: no comparison for it
      await page.selectOption('#probe-card select[data-map-room="r-ch1"]', '');
      await page.waitForFunction(() => ![...document.querySelectorAll('#probe-card h3')].some((h) => h.textContent.includes('Chambre parentale')), null, { timeout: 15000 });
      await ready(page);
      linked = await linkedRooms(page);
      titles = await probeTitles(page);
      check(titles.length === linked.length && !linked.includes('Chambre parentale'), `${name} : délier la pièce ne retire pas sa comparaison`);
      await page.click('[data-comfort=reset-map]');
      await ready(page);
    } else {
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur Air et confort (${await wide(page)} px)`);
      await audit(page, `${name}/confort`, enhanced);
    }

    // ---------------------------------------------------------------- #452 Niveau inférieur
    progress(`${name} : niveau inférieur`);
    await go(page, 'confort');
    await page.waitForSelector('#lower-card [data-lower-room="r-bureau"]', { timeout: 15000 });
    check(/Choisissez les pièces chauffées du niveau inférieur/.test(await page.locator('#lower-card').innerText()), `${name} : niveau inférieur sans consigne de départ`);
    // #499: the help sits under the label of the setup, before the controls (design system § 4)
    const helpFirst = await page.evaluate(() => {
      const help = document.getElementById('lower-help');
      const rooms = document.querySelector('#lower-card .lower-rooms');
      return !!help && !!rooms && !!(help.compareDocumentPosition(rooms) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check(helpFirst, `${name} : #499 l'aide du niveau inférieur n'est pas avant ses réglages`);
    await page.locator('#lower-card [data-lower-room="r-bureau"]').click();
    await page.waitForSelector('#lower-card [data-lower-room="r-bureau"]:checked', { state: 'attached', timeout: 15000 });
    await page.locator('#lower-card [data-lower-room="r-ch2"]').click();
    // a bedroom on the lower level: its detail is masked until the deliberate gesture (S-12.2)
    await page.waitForSelector('#lower-card [data-comfort="show-bedrooms"]', { timeout: 15000 });
    await page.click('#lower-card [data-comfort="show-bedrooms"]');
    await ready(page);
    await page.waitForSelector('#lower-card table', { timeout: 15000 });
    let lower = await page.locator('#lower-card').innerText();
    check(/Hiver 20\d\d–20\d\d/.test(lower) && /kWh par degré-jour/.test(lower), `${name} : niveau inférieur sans tendance d'un hiver à l'autre (« ${lower.slice(0, 200)} »)`);
    if (!(await page.evaluate(() => document.getElementById('lower-setup')?.open))) await page.click('#lower-setup summary');
    await page.selectOption('#lower-probe', { label: 'Cave' });
    await page.waitForFunction(() => /Sonde − dehors/.test(document.querySelector('#lower-card table')?.textContent ?? ''), null, { timeout: 15000 });
    await page.fill('#lower-day', '2025-01-15');
    await page.selectOption('#lower-kind', 'joints');
    await page.click('#lower-add');
    await page.waitForSelector('#lower-card [data-lower-del]', { timeout: 15000 });
    await ready(page);
    lower = await page.locator('#lower-card').innerText();
    check(/après « Joints de porte » du 15 janvier 2025/.test(lower) && /[−+]?\d+\s%\sd'énergie par degré-jour/.test(lower), `${name} : avant / après absent (« ${lower.slice(0, 240)} »)`);
    check(/^Avant .*jours retenus/m.test(lower) && /^Après /m.test(lower), `${name} : lignes avant / après absentes`);
    const hyp = await page.locator('#lower-card details:last-of-type').evaluate((d) => d.textContent);
    check(/médiane/.test(hyp) && /MJ\/m²/.test(hyp) && /base 18 °C/.test(hyp) && /pas la chaleur partie seule/.test(hyp), `${name} : hypothèses du niveau inférieur incomplètes`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal avec le niveau inférieur (${await wide(page)} px)`);
    await audit(page, `${name}/niveau-inferieur`, enhanced);
    await page.locator('#lower-card').screenshot({ path: `${OUT}/retours-${BROWSER}-${name}-niveau-inferieur.png` });

    // ---------------------------------------------------------------- segments: the page stays in place
    if (name === 'clair' || name === 'texte-200') {
      progress(`${name} : segments sans saut de page`);
      await go(page, 'historique');
      await selectKeepsPlace(page, `${name}/historique`, '#view select[data-set="compareMode"]', 'monthly');
      await selectKeepsPlace(page, `${name}/historique`, '#view select[data-set="compareMode"]', 'season');
      await segmentKeepsPlace(page, `${name}/historique (autre segment)`);
      for (const key of ['accueil', 'compteur']) {
        await go(page, key);
        await segmentKeepsPlace(page, `${name}/${key}`);
      }
      // the page of a room has no segment: its link to Historique keeps the rule « new page = top »
      await go(page, 'piece-r-salon');
      await page.evaluate(() => window.scrollTo(0, 400));
      await go(page, 'historique');
      check((await page.evaluate(() => window.scrollY)) === 0, `${name} : changer de page ne remonte pas en haut`);
    }

    // ---------------------------------------------------------------- Outils › Télétravail, 0 to 5 days ticked
    progress(`${name} : télétravail`);
    await go(page, 'outils-teletravail');
    await page.waitForSelector('#telework-card', { timeout: 15000 });
    const counts = name === 'clair' || name === 'texte-200' ? [0, 1, 2, 3, 4, 5] : [5];
    for (const n of counts) {
      await tickDays(page, n);
      const rows = await page.$$eval('#telework-card table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
      const want = n === 0 ? ['Jour ouvré (lun.–ven.)', 'Jour de week-end'] : n === 5 ? ['Jour de télétravail', 'Jour de week-end'] : ['Jour de télétravail', 'Jour ouvré au bureau', 'Jour de week-end'];
      check(JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(want), `${name} : ${n} jour(s) cochés → lignes ${JSON.stringify(rows.map((r) => r[0]))}`);
      check(
        rows.every((r) => /\d/.test(r[1]) && /€/.test(r[2]) && Number(r[3]) >= 3),
        `${name} : ${n} jour(s) cochés → valeurs incohérentes ${JSON.stringify(rows)}`,
      );
      const p = await page.locator('#telework-card > p').first().innerText();
      check(!/Pas assez/.test(p), `${name} : ${n} jour(s) cochés → « ${p.slice(0, 120)} »`);
      if (n === 5) check(/Tous vos jours ouvrés sont en télétravail/.test(p), `${name} : 5 jours cochés sans phrase adaptée (« ${p.slice(0, 120)} »)`);
    }
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur Télétravail (${await wide(page)} px)`);
    await audit(page, `${name}/teletravail`, enhanced);
    await page.locator('#telework-card').screenshot({ path: `${OUT}/retours-${BROWSER}-${name}-teletravail-5j.png` });
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(`${BROWSER}: ${err}`);
} finally {
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Retours confort et télétravail : OK (captures dans ${OUT})`);
