// #202: the plan of the house, in the demo (a fictitious plan: ground floor, first floor and the
// optional cellar).
// - Pièces → « Plan »: the rooms of the level are drawn, coloured by the value chosen, with the
//   legend; the level and the value change by touch and by keyboard, the focus stays on the
//   control; a room opens its page; the table says the same as the drawing (every room of every
//   level, its value, its devices).
// - Household view (bedrooms grouped): no bedroom of the plan is named, each says « Chambres ».
// - 360 px with the system text at 200 % (DejaVu Sans, A6): no horizontal scroll; axe in light and dark.
// - Nothing of the plan is kept in clear on this device.
// Run after `npm run build`: node e2e/plan.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/plan-*.png.
import { chromium, webkit } from 'playwright';
import { frames, goto, openDemo, ready, seriousAxe, startPreview } from './lib.mjs';
import { capturesOut } from './captures.mjs';
import { coveredLetters } from './plan-mots.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = capturesOut(); // #583: e2e/screenshots/ only in the CI's font
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4202));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const SHORT = { timeout: 5000 };

const newPage = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium', ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${BROWSER}: erreur JS ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${BROWSER}: console ${m.text()}`));
  return { ctx, page };
};
const part = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    errors.push(`${BROWSER} ${name}: ${e.message ?? e}`);
  }
};
/** Pièces shown as the plan, its card drawn. */
const openPlan = async (page) => {
  await goto(page, 'pieces');
  await page.locator('[data-set="piecesShow"][data-value="plan"]').click();
  await ready(page);
  await page.locator('#plan-card .plan-svg').waitFor(SHORT);
};
const roomsDrawn = (page) => page.locator('#plan-card .plan-svg rect.plan-room').count();
const classes = (page) => page.locator('#plan-card .plan-svg rect.plan-room').evaluateAll((rs) => rs.map((r) => r.getAttribute('class')));
/** The table under the plan (« Voir les valeurs », folded by default like every table of the app). */
const tableText = async (page) => {
  const d = page.locator('#plan-card details.table-details');
  if (!(await d.evaluate((x) => x.open))) await d.locator('summary').click();
  return page.locator('#plan-card .card-table').innerText();
};
const axe = async (page, where) => {
  for (const v of await seriousAxe(page)) errors.push(`${BROWSER} ${where} : axe « ${v.id} » → ${v.targets.join(' | ')}`);
};

try {
  await part('lecture', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'pieces');
    check(await page.locator('[data-set="piecesShow"]').count() === 2, 'pas de choix « Liste | Plan » alors que la démo a un plan');
    await openPlan(page);
    // the ground floor by default: Salon, Cuisine, Cellier
    check((await roomsDrawn(page)) === 3, `rez-de-chaussée : ${await roomsDrawn(page)} pièces dessinées au lieu de 3`);
    const cls = await classes(page);
    check(cls.some((c) => /heat-[1-5]/.test(c)) && cls.includes('plan-room heat-none'), `couleurs : ${cls.join(', ')} (une pièce mesurée et le cellier sans valeur attendus)`);
    check((await page.locator('#plan-card .legend span').count()) >= 2, 'légende absente');
    // #541: the room of the plan linked to no room (Cellier) is said under the drawing
    check(/1 pièce sur 3 de ce niveau n’est liée à aucune pièce Intuis/.test(await page.locator('#plan-card').innerText()), 'pièce non liée : rien ne le dit');
    check(/Compté :/.test(await page.locator('#plan-card .counted').innerText()), 'période non dite');
    await page.locator('#plan-card').screenshot({ path: `${OUT}/plan-${BROWSER}-rdc.png` });
    // the first floor by touch: five rooms, the bedrooms named (detail view)
    await page.locator('[data-plan-level="etage"]').click();
    await frames(page);
    check((await roomsDrawn(page)) === 5, `étage : ${await roomsDrawn(page)} pièces au lieu de 5`);
    check(await page.locator('[data-plan-level="etage"]').evaluate((b) => b === document.activeElement && b.getAttribute('aria-checked') === 'true'), 'niveau : focus perdu ou bouton non coché');
    // another value, by keyboard: the classes change and the focus stays on the select
    const before = await classes(page);
    await page.locator('[data-plan-metric]').focus();
    await page.locator('[data-plan-metric]').selectOption('temp');
    await frames(page);
    check(await page.locator('[data-plan-metric]').evaluate((s) => s === document.activeElement && s.value === 'temp'), 'valeur : focus perdu sur le choix');
    check(/°C/.test(await tableText(page)), 'tableau : pas de température après le choix « Température moyenne »');
    check(JSON.stringify(before) !== JSON.stringify(await classes(page)), 'les couleurs ne changent pas avec la valeur choisie');
    // the table: every room of every level, the devices in words
    const t = await tableText(page);
    for (const w of ['Cave', 'Salon', 'Cuisine', 'Cellier', 'Chambre parentale', 'Chambre enfant', 'Salle de bain', 'Bureau', 'Palier', 'Chauffe-eau', 'Compteur Linky', 'Prise mesurée', 'Hors des pièces'])
      check(t.includes(w), `tableau : « ${w} » absent`);
    await axe(page, 'plan clair');
    // a room opens its page (keyboard: Enter on the link of the drawing)
    await page.locator('[data-plan-level="rdc"]').click();
    await frames(page);
    const salon = page.locator('#plan-card .plan-svg a[href="#piece-r-salon"]');
    check(/Salon : température moyenne \d/.test((await salon.getAttribute('aria-label')) ?? ''), `nom accessible de la pièce : « ${await salon.getAttribute('aria-label')} »`);
    await salon.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#view[data-page="piece-r-salon"][data-ready]', { state: 'attached', timeout: 15000 });
    // nothing of the plan in clear on this device (the state keeps only « plan »)
    const stored = await page.evaluate(() => Object.values(localStorage).join('\n'));
    check(!/Cellier|Palier|"levels"/.test(stored), 'le plan est gardé en clair dans ce navigateur');
    // back on Pièces, the plan is still the choice; dark theme: axe
    await page.emulateMedia({ colorScheme: 'dark' });
    await goto(page, 'pieces');
    await page.locator('#plan-card .plan-svg').waitFor(SHORT);
    await axe(page, 'plan sombre');
    await page.locator('#plan-card').screenshot({ path: `${OUT}/plan-${BROWSER}-sombre.png` });
    // back to the list
    await page.locator('[data-set="piecesShow"][data-value="list"]').click();
    await ready(page);
    check((await page.locator('#plan-card').count()) === 0 && (await page.locator('[data-room-link]').count()) > 0, 'retour à la liste impossible');
    await ctx.close();
  });

  await part('vue foyer', async () => {
    const { ctx, page } = await newPage();
    // #541: a room of the plan not linked to any Intuis room, named as a bedroom (editor of the demo)
    await openDemo(page, base, null, 'parametres-logement');
    await page.locator('#plan-edit-card .plan-edit-svg').waitFor(SHORT);
    await page.locator('[data-plan-edit-level="etage"]').click();
    await frames(page);
    await page.locator('#plan-add-room').click();
    await page.locator('#plan-edit-card [data-plan-f="name"]').fill('Chambre d’amis fictive');
    await page.keyboard.press('Tab');
    await frames(page);
    await goto(page, 'parametres-affichage');
    await page.check('[data-toggle=household]');
    await ready(page);
    await openPlan(page);
    await page.locator('[data-plan-level="etage"]').click();
    await frames(page);
    const t = await tableText(page);
    const svgText = await page.locator('#plan-card .plan-svg').evaluate((s) => s.textContent + [...s.querySelectorAll('a')].map((a) => a.getAttribute('aria-label')).join(' '));
    check(!/Chambre parentale|Chambre enfant|Chambre d’amis/.test(t + svgText), 'vue foyer : une chambre du plan est nommée');
    check(/Chambres/.test(t) && (await page.locator('#plan-card a[href="#piece-__bedrooms__"]').count()) >= 2, 'vue foyer : les chambres ne mènent pas à « Chambres »');
    await ctx.close();
  });

  await part('360 px, texte 200 %', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'pieces');
    // A6: the widest font of the runners, and the system text at 200 %
    await page.addStyleTag({ content: 'html { font-size: 200% !important; font-family: "DejaVu Sans", sans-serif !important; } * { font-family: "DejaVu Sans", sans-serif !important; }' });
    await openPlan(page);
    for (const lv of ['cave', 'rdc', 'etage']) {
      await page.locator(`[data-plan-level="${lv}"]`).click();
      await frames(page);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - 360);
      check(wide <= 0, `200 % : défilement horizontal de ${wide} px au niveau ${lv}`);
      // #541: every word drawn is painted at --font-xs at least (it follows the 200 %), and stays in its room
      const small = await page.locator('#plan-card .plan-svg').evaluate((svg) => {
        const probe = Object.assign(document.createElement('span'), { textContent: 'x' });
        probe.style.fontSize = 'var(--font-xs)';
        document.body.append(probe);
        const min = parseFloat(getComputedStyle(probe).fontSize) - 0.3;
        probe.remove();
        const out = [];
        for (const t of svg.querySelectorAll('text')) {
          if (!t.textContent.trim() || getComputedStyle(t).visibility === 'hidden') continue;
          const px = parseFloat(getComputedStyle(t).fontSize) * t.getScreenCTM().a;
          if (px < min) out.push(`« ${t.textContent} » ${px.toFixed(1)} px < ${min.toFixed(1)}`);
          const g = t.closest('g.plan-text');
          if (g) {
            const [x, , w] = g.dataset.box.split(' ').map(Number);
            const b = t.getBBox();
            if (b.x + b.width > x + w + 0.05) out.push(`« ${t.textContent} » sort de sa pièce`);
          }
        }
        return out;
      });
      check(!small.length, `200 % : texte du dessin au niveau ${lv} : ${small.join(' ; ')}`);
      // #550 (revue v2.2): no device mark is painted over a word of a room: what is painted at the
      // centre of each letter of a name or a value is the word, never a mark
      const covered = await page.locator('#plan-card .plan-svg').evaluate(coveredLetters);
      check(!covered.length, `200 % : un appareil couvre un mot au niveau ${lv} : ${covered.join(' ; ')}`);
    }
    await page.locator('#plan-card').screenshot({ path: `${OUT}/plan-${BROWSER}-200.png` });
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
console.log(`${BROWSER} : plan de la maison (lecture, tableau, vue foyer, 200 %, axe)`);
