// #20: the « Réglages du graphique » sheet, common to every chart: a button under each chart
// opens a modal sheet (bottom sheet at 360 px), axe clean in light, dark and high contrast, no
// horizontal overflow at 360 px with the text at 200 %, Échap closes it and gives the focus back
// to the button; each choice applies to all the charts at once and is kept on this device
// (after a reload): « Comparer avec l'an dernier » removes « Un an plus tôt », « Un point sur
// chaque valeur », « Afficher les valeurs ». #370: the control acted on stays where it was.
// Run after `npm run build`: node e2e/reglages.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/reglages-*.png.
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { goto, openDemo, ready, seriousAxe, startPreview, frames } from './lib.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4191));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();

/** Series names of the ECharts chart drawn in `sel` (its aria-label lists them too, but not all). */
const seriesOf = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    // the chart instance is not reachable from the page: read the screen-reader summary, built from the series shown
    return el?.getAttribute('aria-label') ?? '';
  }, sel);
const open = async (page, nth = 0) => {
  const b = page.locator('[data-chart-settings]').nth(nth);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await page.waitForSelector('#chart-sheet[open]');
};
const toggle = async (page, key) => {
  await page.locator(`#chart-sheet [data-chart-pref="${key}"]`).click();
  await frames(page);
  await ready(page);
};

try {
  for (const scheme of ['light', 'dark']) {
    for (const contrast of scheme === 'light' ? ['no-preference', 'more'] : ['no-preference']) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium', colorScheme: scheme, contrast });
      const page = await ctx.newPage();
      const name = `${scheme}${contrast === 'more' ? '-contraste' : ''}`;
      await openDemo(page, base, null, 'accueil');
      check((await page.locator('[data-chart-settings]').count()) >= 1, `${name} : pas de bouton « Réglages du graphique » sous le graphique de l'Accueil`);
      await open(page);
      const dlg = page.locator('#chart-sheet');
      check(await dlg.evaluate((d) => d.matches(':modal')), `${name} : la feuille n'est pas modale`);
      check((await dlg.getAttribute('aria-labelledby')) === 'chart-sheet-title', `${name} : feuille sans titre accessible`);
      check(await page.evaluate(() => !!document.activeElement?.closest('#chart-sheet')), `${name} : le focus n'entre pas dans la feuille`);
      // bottom sheet on a phone: glued to the bottom of the screen
      const box = await dlg.boundingBox();
      check(box && Math.abs(box.y + box.height - 740) <= 2, `${name} : la feuille n'est pas en bas de l'écran (${box && Math.round(box.y + box.height)} px)`);
      for (const v of await seriousAxe(page)) errors.push(`${BROWSER} ${name} feuille : axe « ${v.id} » → ${v.targets.join(' | ')}`);
      await page.screenshot({ path: `${OUT}/reglages-${BROWSER}-${name}.png` });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#chart-sheet:not([open])', { state: 'attached' });
      check(await page.evaluate(() => document.activeElement?.matches('[data-chart-settings]')), `${name} : Échap ne rend pas le focus au bouton`);
      await ctx.close();
    }
  }

  // 360 px, text at 200 %: nothing wider than the screen, every switch reachable
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
    const page = await ctx.newPage();
    await openDemo(page, base, null, 'accueil');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await open(page);
    const over = await page.evaluate(() => {
      const d = document.getElementById('chart-sheet');
      return { sheet: d.scrollWidth - d.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
    });
    check(over.sheet <= 1 && over.page <= 1, `200 % : débordement horizontal (feuille ${over.sheet} px, page ${over.page} px)`);
    const last = page.locator('#chart-sheet [data-chart-pref="smooth"]');
    await last.scrollIntoViewIfNeeded();
    const s = await last.evaluate((e) => {
      const r = e.closest('label').getBoundingClientRect();
      return { h: r.height, inside: r.bottom <= window.innerHeight + 1 };
    });
    check(s.h >= 44 && s.inside, `200 % : le dernier réglage n'est pas atteignable (${Math.round(s.h)} px)`);
    await page.screenshot({ path: `${OUT}/reglages-${BROWSER}-200.png` });
    // the « Voir les valeurs » fold next to the button keeps a usable title (it shrank to 0 px
    // beside the floated button at 200 %, and could not be clicked)
    await page.keyboard.press('Escape');
    const folds = await page.evaluate(() =>
      [...document.querySelectorAll('.chart-settings + .table-details > summary')].map((s) => {
        const r = s.getBoundingClientRect();
        return Math.round(Math.min(r.width, r.height));
      }),
    );
    check(folds.length > 0 && folds.every((v) => v >= 44), `200 % : titre de « Voir les valeurs » écrasé à côté du bouton (${folds.join(', ')} px)`);
    await ctx.close();
  }

  // the choices apply to every chart and are kept on this device
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
    const page = await ctx.newPage();
    await openDemo(page, base, null, 'accueil');
    const tables = () => page.locator('details.table-details[open] table').count();
    check((await tables()) === 0, 'tableaux ouverts par défaut');
    await open(page);
    await toggle(page, 'values');
    check((await tables()) > 0, '« Afficher les valeurs » : aucun tableau ouvert sur l’Accueil');
    await page.keyboard.press('Escape');
    await goto(page, 'piece-r-salon');
    await page.waitForSelector('#room-detail canvas', { timeout: 15000 });
    check(/Un an plus tôt/.test(await seriesOf(page, '#room-detail')), 'Pièce : « Un an plus tôt » absent par défaut');
    const at = await page.locator('[data-chart-settings]').evaluateAll((bs) => bs.findIndex((b) => b.dataset.chartSettings === 'room-detail'));
    check(at >= 0, 'Pièce : pas de bouton sous le graphique de consommation');
    await open(page, Math.max(0, at));
    await toggle(page, 'lastYear');
    check(!/Un an plus tôt/.test(await seriesOf(page, '#room-detail')), '« Comparer avec l’an dernier » décoché : « Un an plus tôt » toujours là');
    check(await page.locator('#chart-sheet[open]').count(), 'la feuille se ferme quand un réglage change');
    check(await page.evaluate(() => !!document.activeElement?.matches('#chart-sheet [data-chart-pref="lastYear"]')), 'le focus quitte la case après le changement');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#chart-sheet:not([open])', { state: 'attached' });
    await ready(page);
    const back = await page
      .waitForFunction(() => document.activeElement?.getAttribute('data-chart-settings'), null, { timeout: 2000 })
      .then((h) => h.jsonValue(), () => null);
    check(back === 'room-detail', `le focus revient au bouton du graphique de consommation (${back})`);
    // kept after a reload (this device)
    await page.reload();
    const lock = page.getByRole('button', { name: /données de démonstration/ });
    await Promise.race([lock.waitFor({ timeout: 60000 }), page.waitForSelector('header.top', { timeout: 60000 })]);
    if (await lock.isVisible()) await lock.click();
    await goto(page, 'piece-r-salon');
    await page.waitForSelector('#room-detail canvas', { timeout: 15000 });
    check(!/Un an plus tôt/.test(await seriesOf(page, '#room-detail')), 'après rechargement : « Un an plus tôt » revenu');
    await goto(page, 'accueil');
    check((await tables()) > 0, 'après rechargement : tableaux refermés');
    await goto(page, 'piece-r-salon');
    await open(page);
    check(!(await page.locator('#chart-sheet [data-chart-pref="lastYear"]').isChecked()), 'après rechargement : la case n’est plus décochée');
    await page.locator('#chart-sheet [data-chart-reset]').click();
    await frames(page);
    await ready(page);
    check(await page.locator('#chart-sheet [data-chart-pref="lastYear"]').isChecked(), '« Rétablir » ne recoche pas « Comparer avec l’an dernier »');
    check(/Un an plus tôt/.test(await seriesOf(page, '#room-detail')), '« Rétablir » : « Un an plus tôt » absent');
    await ctx.close();
  }
} catch (e) {
  errors.push(`${BROWSER}: exception ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser.close();
  stop();
}
if (errors.length) {
  console.error(`Réglages du graphique : ${errors.length} échec(s)\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Réglages du graphique (${BROWSER}) : tout est bon.`);
