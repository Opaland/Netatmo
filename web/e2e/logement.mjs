// #462: the forms of ⚙ Mon logement keep what is typed.
// - « Localisation et toits »: the form as typed survives a change of tab, a visit to ⚙ Sources
//   de données and a reload (an encrypted draft on this device, never in clear); « Annuler » and
//   « Appliquer » / « Enregistrer pour le foyer » drop it; the coordinates are shown only while
//   editing.
// - « Poêle à bois »: the folds « Noter un achat de bois » and « Hypothèses » stay open after an
//   action, and the efficiency applies when its field is left, before the first purchase too.
// - « Surfaces »: a value typed does not redraw the grid; the focus goes on to the next field.
// Run after `npm run build`: node e2e/logement.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/logement-*.png.
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { goto, openDemo, ready, seriousAxe, startPreview, frames } from './lib.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4197));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const SHORT = { timeout: 5000 };
// fictive values, recognisable in the storage if they were ever kept in clear
const TYPED = { commune: 'Villefictive-sur-Test', lat: '44,123', lon: '3,456', roof: 'Toit du test' };

const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${BROWSER}: console ${m.text()}`));
  return { ctx, page };
};
const card = (page) => page.locator('#location-card');
const value = (page, sel) => page.locator(sel).inputValue(SHORT).catch(() => null);
/** The location form, as shown now (null fields when it is closed). */
const form = async (page) => ({
  commune: await value(page, '#loc-commune'),
  lat: await value(page, '#loc-lat'),
  lon: await value(page, '#loc-lon'),
  roof: await value(page, '[data-roof="0"] [data-f="name"]'),
});
const sameAsTyped = (f) => f.commune === TYPED.commune && f.lat === TYPED.lat && f.lon === TYPED.lon && f.roof === TYPED.roof;
/** Reload the app (closed by the phone): the demo key may be remembered, else the demo is reopened. */
/** One parcours: an exception stops it, not the others (each is seen red on its own). */
const part = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    errors.push(`${BROWSER} ${name}: ${e.message ?? e}`);
  }
};
const reopen = async (page) => {
  await page.goto('about:blank');
  await page.goto(`${base}#parametres-logement`);
  const demo = page.getByRole('button', { name: /données de démonstration/ });
  await Promise.race([demo.waitFor({ timeout: 60000 }), page.waitForSelector('header.top', { timeout: 60000 })]);
  if (await demo.isVisible().catch(() => false)) await demo.click();
  await page.waitForSelector('header.top', { timeout: 60000 });
  await card(page).locator('h2').waitFor({ state: 'attached', timeout: 15000 });
  await ready(page);
};

try {
  // ------------------------------------------------------------ Localisation et toits
  await part('localisation', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await page.locator('#loc-edit').click();
    await page.locator('#loc-commune').fill(TYPED.commune);
    await page.locator('#loc-lat').fill(TYPED.lat);
    await page.locator('#loc-lon').fill(TYPED.lon);
    await page.locator('[data-roof="0"] [data-f="name"]').fill(TYPED.roof);
    await page.locator('#loc-precision').selectOption('3');
    await card(page).screenshot({ path: `${OUT}/logement-${BROWSER}-localisation.png` });
    // another tab, then ⚙ Sources de données (where the token is connected), then back
    await goto(page, 'accueil');
    await goto(page, 'parametres-sources');
    await goto(page, 'parametres-logement');
    await card(page).locator('h2').waitFor({ state: 'attached', timeout: 15000 });
    let f = await form(page);
    check(sameAsTyped(f), `localisation : saisie perdue après Accueil puis ⚙ Sources (${JSON.stringify(f)})`);
    check((await value(page, '#loc-precision')) === '3', 'localisation : précision choisie perdue');
    // nothing typed is kept in clear on this device
    const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n'));
    for (const v of Object.values(TYPED)) check(!stored.includes(v), `localisation : « ${v} » en clair dans le stockage de l'appareil`);
    check(/location-draft/.test(stored), 'localisation : aucun brouillon chiffré sur l’appareil');
    // a reload (the app closed by the phone): the encrypted draft reopens the form
    await reopen(page);
    f = await form(page);
    check(sameAsTyped(f), `localisation : saisie perdue après rechargement (${JSON.stringify(f)})`);
    for (const v of await seriousAxe(page)) errors.push(`${BROWSER} localisation : axe « ${v.id} » → ${v.targets.join(' | ')}`);
    // « Annuler » drops it: closed, coordinates hidden, and not back after a reload
    await page.locator('#loc-cancel').click();
    await frames(page);
    check((await page.locator('#loc-lat').count()) === 0, 'localisation : formulaire encore ouvert après Annuler');
    check(!(await card(page).innerText()).includes(TYPED.lat), 'localisation : coordonnées affichées hors édition');
    await reopen(page);
    check((await page.locator('#loc-lat').count()) === 0 && (await page.locator('#loc-edit').count()) === 1, 'localisation : brouillon revenu après Annuler');
    // typed again, then applied (demo; « Enregistrer pour le foyer » outside it): dropped too
    await page.locator('#loc-edit').click();
    await page.locator('#loc-commune').fill(TYPED.commune);
    await page.locator('#loc-lat').fill('44,5');
    await page.locator('#loc-lon').fill('3,5');
    await page.locator('#loc-save').click();
    await frames(page);
    check((await page.locator('#loc-lat').count()) === 0, 'localisation : formulaire encore ouvert après Appliquer');
    check((await card(page).innerText()).includes(TYPED.commune), 'localisation : localisation appliquée absente du résumé');
    await reopen(page);
    check((await page.locator('#loc-lat').count()) === 0, 'localisation : brouillon revenu après Appliquer');
    await ctx.close();
  });

  // ------------------------------------------------------------ Poêle à bois
  await part('bois', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    const wood = page.locator('#wood-card');
    await wood.waitFor({ state: 'attached', timeout: 15000 });
    // no purchase at all: the demo's are removed (the bug was before the first purchase)
    for (let i = 0; i < 10 && (await page.locator('[data-wood-remove]').count()) > 0; i++) {
      const b = page.locator('[data-wood-remove]').first();
      await b.evaluate((el) => el.closest('details')?.setAttribute('open', ''));
      await b.click();
      await ready(page);
    }
    const json = async () => JSON.parse(await page.locator('#wood-card .sim-json').innerText());
    check((await json()).purchases.length === 0, 'bois : achats de la démo non retirés');
    // efficiency typed and left: applied, the fold stays open
    await page.locator('#wood-card details:has(#wood-eff) > summary').click();
    await page.locator('#wood-eff').fill('85');
    await page.locator('#wood-eff').press('Tab');
    await ready(page);
    await page.waitForFunction(() => /"efficiency":85/.test(document.querySelector('#wood-card .sim-json')?.textContent ?? ''), null, SHORT).catch(() => {});
    check((await json()).efficiency === 85, `bois : rendement non appliqué à la sortie du champ (${JSON.stringify(await json())})`);
    check(await page.locator('#wood-card details:has(#wood-eff)').evaluate((d) => d.open).catch(() => false), 'bois : « Hypothèses » replié après la saisie');
    // two purchases in a row: « Noter l'achat » stays under the finger, the fold open
    const fold = page.locator('#wood-new');
    if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
    for (const price of ['120', '130']) {
      await page.locator('#wood-price').fill(price, SHORT).catch(() => errors.push(`${BROWSER}: bois : champ « Prix » caché (volet replié) avant l'achat à ${price} €`));
      // a tap as on the owner's phone (Safari): the field loses the focus and the button does not
      // take it, so no focus restored by the app reopens the fold behind the test's back
      const tapped = await page.evaluate(() => {
        const b = document.getElementById('wood-add');
        if (!b || !b.checkVisibility()) return false;
        document.activeElement?.blur();
        b.click();
        return true;
      });
      if (!tapped) errors.push(`${BROWSER}: bois : « Noter l’achat » caché (volet replié) pour l'achat à ${price} €`);
      await frames(page);
      await ready(page);
      check(await fold.evaluate((d) => d.open).catch(() => false), `bois : « Noter un achat de bois » replié après l'achat à ${price} €`);
    }
    const w = await json();
    check(w.purchases.length === 2, `bois : ${w.purchases.length} achat(s) noté(s) au lieu de 2`);
    check(w.efficiency === 85, `bois : rendement perdu au premier achat (${JSON.stringify(w)})`);
    check(await page.locator('#wood-card details:has(#wood-eff)').evaluate((d) => d.open).catch(() => false), 'bois : « Hypothèses » replié après un achat');
    await wood.screenshot({ path: `${OUT}/logement-${BROWSER}-bois.png` });
    await ctx.close();
  });

  // ------------------------------------------------------------ Bois réellement brûlé (#465)
  await part('bois brûlé', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await page.locator('#wood-card').waitFor({ state: 'attached', timeout: 15000 });
    await ready(page);
    const line = (y) => page.locator(`#wood-card [data-wood-season="${y}"]`).innerText();
    // the demo notes no reading: each season burns all it has, and says it is an assumption
    check(/tout brûlé \(supposé\)/.test(await line(2025)), `bois brûlé : hypothèse non dite (« ${await line(2025)} »)`);
    await page.locator('#wood-burnt > summary').click();
    await page.locator('#wood-burnt-season').selectOption('2025');
    await page.locator('#wood-burnt-kind').selectOption('left');
    await page.locator('#wood-burnt-value').fill('0.25');
    await page.locator('#wood-burn').click();
    await page.waitForFunction(() => /"burnt"/.test(document.querySelector('#wood-card .sim-json')?.textContent ?? ''), null, SHORT).catch(() => {});
    await ready(page);
    const w = JSON.parse(await page.locator('#wood-card .sim-json').innerText());
    check(JSON.stringify(w.burnt) === '[{"season":2025,"left":0.25}]', `bois brûlé : relevé non noté (${JSON.stringify(w.burnt)})`);
    check(/\(stock relevé au printemps\) · reste 0,25 stère/.test(await line(2025)), `bois brûlé : 2025–2026 sans son reste (« ${await line(2025)} »)`);
    check(/^0,25 stère reporté/.test(await line(2026)), `bois brûlé : stock non reporté en 2026–2027 (« ${await line(2026)} »)`);
    check(await page.locator('#wood-burnt').evaluate((d) => d.open).catch(() => false), 'bois brûlé : volet replié après le relevé');
    await page.locator('#wood-card').screenshot({ path: `${OUT}/logement-${BROWSER}-bois-brule.png` });
    await page.locator('[data-wood-unburn="2025"]').click();
    await ready(page);
    check(!/"burnt"/.test(await page.locator('#wood-card .sim-json').innerText()), 'bois brûlé : relevé non retiré');
    await ctx.close();
  });

  // ------------------------------------------------------------ Surfaces
  await part('surfaces', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await page.locator('#works-card [data-works-surface]').first().waitFor({ state: 'attached', timeout: 15000 });
    await page.locator('#works-surfaces > summary').click();
    const inputs = page.locator('[data-works-surface]:not([disabled])');
    check((await inputs.count()) >= 2, 'surfaces : moins de deux champs à saisir');
    await page.evaluate(() => (window.__grid = document.querySelector('#works-surfaces .works-surfaces')));
    await inputs.nth(0).click();
    await page.keyboard.type('12');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => /m²/.test(document.querySelector('#works-surfaces > summary')?.textContent ?? ''), null, SHORT).catch(() => {});
    await frames(page);
    check(/12 m²/.test(await page.locator('#works-surfaces > summary').innerText()), 'surfaces : valeur non prise en compte');
    check(await page.evaluate(() => window.__grid === document.querySelector('#works-surfaces .works-surfaces')), 'surfaces : la grille est reconstruite à la saisie');
    check(await inputs.nth(1).evaluate((el) => el === document.activeElement), 'surfaces : le focus ne passe pas au champ suivant');
    check(await page.locator('#works-surfaces').evaluate((d) => d.open), 'surfaces : volet replié après la saisie');
    // typing in the next field goes on where the caret is
    await page.keyboard.type('9');
    await page.keyboard.press('Tab');
    await frames(page);
    check((await inputs.nth(1).inputValue()) === '9', `surfaces : seconde valeur perdue (« ${await inputs.nth(1).inputValue()} »)`);
    await page.locator('#works-card').screenshot({ path: `${OUT}/logement-${BROWSER}-surfaces.png` });
    await ctx.close();
  });
} catch (e) {
  errors.push(`${BROWSER}: ${e.stack ?? e}`);
} finally {
  await browser.close();
  stop();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${BROWSER} : Mon logement, saisies gardées (localisation, bois, surfaces)`);
