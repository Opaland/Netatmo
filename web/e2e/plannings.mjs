// v1.6 #211 / #210: Outils → « Mes plannings et les heures creuses » and the absences rebuilt from
// the absence mode of the radiators, on Chromium with the demo:
// - plannings: what is counted, share in off-peak hours, a comfort start per room with its real
//   warm-up, one figured suggestion (the living room: start earlier, in off-peak hours), a slot
//   never reached (the bathroom), read-only said;
// - absences: start and end hours, the detection delay and its correction, the heating saved; a
//   room alone in frost guard kept apart; Historique says how many days away each winter;
// - 360 px phone, text at 200 %: no horizontal scroll, nothing sticks out;
// - axe-core clean in light, dark and high contrast (7:1), light and dark.
// Run after `npm run build`: node e2e/plannings.mjs   (port E2E_PORT, captures in E2E_OUT)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT ?? 4187);
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const busy = await fetch(`http://localhost:${PORT}/`).then(
  () => true,
  () => false,
);
if (busy) {
  console.error(`E2E : le port ${PORT} est déjà utilisé, définir E2E_PORT.`);
  process.exit(1);
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const t0 = Date.now();
const progress = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] plannings ${s}`);
const PAGES = ['outils-plannings', 'outils-absences', 'historique'];
const WAIT = { 'outils-plannings': '#plannings-summary', 'outils-absences': '#absence-card', historique: '#hist-absences' };

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}
const ready = (page) => page.waitForSelector('#view[data-ready]', { state: 'attached', timeout: 30000 });
async function go(page, key) {
  const tab = page.locator(`.tabs [data-view="${key}"]`);
  if (await tab.count()) await tab.click();
  else await page.evaluate((k) => (location.hash = `#${k}`), key);
  await page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
  await page.waitForSelector(WAIT[key] ?? '#view', { timeout: 20000 });
}
async function openDemo(page) {
  await page.goto(base);
  await page.click('#demo');
  await page.waitForSelector('header.top', { timeout: 30000 });
}
async function audit(page, where, enhanced = false) {
  progress(`axe ${where}`);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])]);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    errors.push(`${where} : axe ${v.impact} « ${v.id} » ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }
}
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ');

try {
  await waitForServer();
  const browser = await chromium.launch();

  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`plannings: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`plannings: ${m.text()}`));
    await openDemo(page);

    // ------------------------------------------------------------ the tool, from the Outils tab
    await go(page, 'outils');
    check(await page.locator('#view a[href="#outils-plannings"]').count(), 'Outils : pas de ligne « Mes plannings et les heures creuses »');
    await go(page, 'outils-plannings');
    progress('plannings');
    const sum = await text(page, '#plannings-summary');
    check(/Compté : 4 semaines, du .+ au 8 nov\. 2026/.test(sum), `plannings : « Compté : » → ${sum.slice(0, 200)}`);
    check(/En heures creuses \d+\s%/.test(sum), `plannings : part en heures creuses absente → ${sum.slice(0, 300)}`);
    check(/Gain possible/.test(sum), 'plannings : tuile « Gain possible » absente');
    check(/Lecture seule/.test(sum) && /ne modifie jamais/.test(sum), 'plannings : la lecture seule n’est pas dite');
    const salon = await text(page, '#plan-r-salon');
    check(/7 h → 20,0\s°C/.test(salon), `Salon : relance de 7 h absente → ${salon.slice(0, 300)}`);
    check(/Avancer la relance de 7 h à \d+ h/.test(salon) && /€ par mois de chauffe/.test(salon), `Salon : pas de suggestion chiffrée → ${salon.slice(0, 400)}`);
    check(/heures pleines/.test(salon), 'Salon : part en heures pleines de la montée absente');
    check(await page.locator('#plan-r-salon .sched').count(), 'Salon : planning type absent');
    const sdb = await text(page, '#plan-r-sdb');
    check(/À revoir/.test(sdb) && /n'est atteint que/.test(sdb), `Salle de bain : créneau jamais atteint non signalé → ${sdb.slice(0, 400)}`);
    check(/sans atteindre la consigne/.test(sdb), 'Salle de bain : heures de montée inutiles absentes');
    await page.screenshot({ path: `${OUT}/plannings-mobile.png`, fullPage: true });

    // ------------------------------------------------------------ absences (S-13.7)
    await go(page, 'outils-absences');
    progress('absences');
    await page.waitForSelector('#absence-card .absence-list', { timeout: 15000 });
    const abs = await text(page, '#absence-card');
    check(/du 24 sept\. \d+ h au 1er oct\. \d+ h/.test(abs), `absences : heures de début et de fin absentes → ${abs.slice(0, 300)}`);
    check(/confirmée par le mode de consigne/.test(abs), 'absences : période non confirmée par le mode');
    check(/économie estimée/.test(abs), 'absences : économie estimée absente');
    check(/sans doute commencé vers le 24 sept\. \d+ h/.test(abs), 'absences : délai de détection non signalé');
    check(/Bureau 4 jours/.test(abs), `absences : la pièce seule en hors-gel n’est pas mise à part → ${abs.slice(-400)}`);
    const before = abs.match(/du (24 sept\. \d+ h)/)?.[1];
    await page.locator('#absence-card [data-absence-earlier]').first().click();
    await page.waitForFunction(() => /Début avancé de 12 h/.test(document.querySelector('#absence-card')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => errors.push('absences : la correction du début ne s’applique pas'));
    const after = (await text(page, '#absence-card')).match(/du (\d+ sept\. \d+ h)/)?.[1];
    check(before && after && before !== after, `absences : début inchangé après correction (${before} → ${after})`);
    await page.screenshot({ path: `${OUT}/absences-mobile.png`, fullPage: true });
    await page.locator('#absence-card [data-absence-earlier]').first().click(); // back as seen by the radiators
    await page.waitForFunction(() => !/Début avancé de 12 h/.test(document.querySelector('#absence-card')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => errors.push('absences : la correction ne s’annule pas'));

    // ------------------------------------------------------------ Historique: absences next to the comparisons
    await go(page, 'historique');
    const hist = await text(page, '#hist-absences');
    check(/\d+ jours? d'absence l'hiver 2026–2027/.test(hist), `Historique : jours d’absence de l’hiver absents → ${hist.slice(0, 300)}`);
    check(await page.locator('#hist-absences a[href="#outils-absences"]').count(), 'Historique : pas de lien vers le détail des absences');
    await ctx.close();
  }

  // 360 px phone, text at 200 %
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`360-200: ${e.message}`));
    await openDemo(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const key of PAGES) {
      progress(`360 px, texte 200 % : ${key}`);
      await go(page, key);
      const out = await page.evaluate(() => {
        const found = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push(`page ${document.documentElement.scrollWidth}px`);
        for (const el of document.querySelectorAll('#view .card-head, #view .card-sub, #view .legend, #view .list .row, #view .kpi, #view .alert, #view .sched, #view .plan-rises li, #view .absence-list li, #view .link')) {
          if (el.closest('details:not([open])') || el.closest('[hidden]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1) found.push(`${el.className || el.tagName} déborde (${Math.round(r.right)} px)`);
        }
        return found;
      });
      check(!out.length, `360 px, texte 200 %/${key} : ${out.slice(0, 5).join(', ')}`);
      await page.screenshot({ path: `${OUT}/plannings-texte200-${key}.png`, fullPage: true });
    }
    await ctx.close();
  }

  // axe: light, dark, high contrast light and dark (7:1)
  for (const [name, opts, enhanced] of [
    ['clair', { colorScheme: 'light' }, false],
    ['sombre', { colorScheme: 'dark' }, false],
    ['contraste-clair', { colorScheme: 'light', contrast: 'more' }, true],
    ['contraste-sombre', { colorScheme: 'dark', contrast: 'more' }, true],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block', ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await openDemo(page);
    for (const key of PAGES) {
      await go(page, key);
      await ready(page);
      await audit(page, `${name}/${key}`, enhanced);
    }
    await ctx.close();
  }
  await browser.close();
} catch (err) {
  errors.push(`plannings: ${err}`);
} finally {
  server.kill();
}
if (errors.length) {
  console.error(`${errors.length} problème(s) :\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Plannings et absences : OK');
