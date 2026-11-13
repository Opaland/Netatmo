// #202: the editor of the plan of the house (⚙ Mon logement → « Plan de la maison »), in the demo
// (a fictitious plan).
// - A room is added, named, sized by its fields (the caret stays in the form), moved by dragging
//   (finger: touch events of a phone; by whole cells), and a device is added and said which one
//   it is; the drawing follows each change.
// - The change applies on this device at once: Pièces → Plan shows it; it survives a reload
//   (sealed draft), never in clear in localStorage; « Revenir à la version du foyer » drops it.
// - The demo sends nothing: « Enregistrer pour le foyer » stays disabled.
// - axe; 360 px with the system text at 200 % (DejaVu Sans, A6) without horizontal scroll.
// Run after `npm run build`: node e2e/plan-edition.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/plan-edition-*.png.
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { frames, goto, openDemo, ready, seriousAxe, startPreview } from './lib.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = process.env.E2E_OUT ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4203));
const errors = [];
const check = (ok, msg) => ok || errors.push(`${BROWSER}: ${msg}`);
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const SHORT = { timeout: 5000 };
const NAME = 'Véranda fictive';

const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: BROWSER === 'chromium' });
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
const card = (page) => page.locator('#plan-edit-card');
const openEditor = async (page) => {
  await goto(page, 'parametres-logement');
  await card(page).locator('.plan-edit-svg').waitFor(SHORT);
};
const shapes = (page) => card(page).locator('.plan-edit-svg rect.plan-room');
/** The rectangle of the room selected: [x, y, w, h] in cells. */
const selectedBox = (page) =>
  card(page)
    .locator('.plan-edit-svg rect.plan-room.is-selected')
    .evaluate((r) => ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a))));
const axe = async (page, where) => {
  for (const v of await seriousAxe(page)) errors.push(`${BROWSER} ${where} : axe « ${v.id} » → ${v.targets.join(' | ')}`);
};
/** A finger drag (touch events through CDP in Chromium; the mouse in WebKit, whose pointer events are the same path). */
async function drag(page, box, dx, dy) {
  const from = { x: box.x + 6, y: box.y + 6 };
  const to = { x: from.x + dx, y: from.y + dy };
  if (BROWSER === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch('touchStart', from);
    for (let i = 1; i <= 6; i++) await touch('touchMove', { x: from.x + (dx * i) / 6, y: from.y + (dy * i) / 6 });
    await touch('touchMove', to); // the last move again: CDP may coalesce it with the end of the touch
    await frames(page);
    await touch('touchEnd');
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
}

try {
  await part('édition', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await card(page).locator('.plan-edit-svg').waitFor(SHORT);
    check(await card(page).locator('#plan-save').isDisabled(), 'démo : « Enregistrer pour le foyer » actif');
    await page.locator('[data-plan-edit-level="rdc"]').click();
    await frames(page);
    const before = await shapes(page).count();
    // a room: added (selected), named, sized by its fields
    await page.locator('#plan-add-room').click();
    await card(page).locator('[data-plan-f="name"]').waitFor(SHORT);
    check((await shapes(page).count()) === before + 1, 'pièce non ajoutée au dessin');
    await card(page).locator('[data-plan-f="name"]').fill(NAME);
    await page.keyboard.press('Tab');
    await frames(page);
    check(await card(page).locator('[data-plan-f="room"]').evaluate((s) => s === document.activeElement), 'nom : le focus ne passe pas au champ suivant');
    check((await card(page).locator('[data-plan-select]').allInnerTexts()).includes(NAME), 'nom : la liste ne suit pas');
    await card(page).locator('[data-plan-f="w"]').fill('8');
    await page.keyboard.press('Tab');
    await frames(page);
    let b = await selectedBox(page);
    check(b[2] === 8, `largeur : ${b[2]} cases au lieu de 8`);
    // dragged by the finger: 3 cells to the right, the field follows
    await card(page).locator('.plan-edit-svg').scrollIntoViewIfNeeded();
    // the size of a cell on the screen, as the drawing places it (the frame may letterbox it)
    const cell = await card(page).locator('.plan-edit-svg').evaluate((s) => s.getScreenCTM().a);
    const shape = await card(page).locator('.plan-edit-svg rect.plan-room.is-selected').boundingBox();
    const x0 = b[0];
    await drag(page, shape, cell * 3, 0);
    await card(page).locator('[data-plan-f="x"]').waitFor(SHORT);
    await frames(page);
    b = await selectedBox(page);
    check(b[0] === x0 + 3, `glisser : colonne ${b[0]} au lieu de ${x0 + 3}`);
    check((await card(page).locator('[data-plan-f="x"]').inputValue()) === String(x0 + 3), 'glisser : le champ « Colonne » ne suit pas');
    // a device, said which one it is, by keyboard
    await card(page).locator('#plan-add-device').focus();
    await page.keyboard.press('Enter');
    await card(page).locator('[data-plan-f="kind"]').waitFor(SHORT);
    await card(page).locator('[data-plan-f="kind"]').selectOption('prise');
    await frames(page);
    check(await card(page).locator('[data-plan-f="kind"]').evaluate((s) => s === document.activeElement), 'appareil : focus perdu sur le choix');
    await card(page).locator('[data-plan-f="ref"]').selectOption({ label: 'Box TV' });
    await frames(page);
    check((await card(page).locator('[data-plan-select]').allInnerTexts()).some((t) => /Prise mesurée \(Box TV\)/.test(t)), 'appareil : la liste ne dit pas lequel');
    await axe(page, 'éditeur');
    await card(page).screenshot({ path: `${OUT}/plan-edition-${BROWSER}.png` });
    // applied on this device at once: Pièces → Plan
    await goto(page, 'pieces');
    await page.locator('[data-set="piecesShow"][data-value="plan"]').click();
    await ready(page);
    await page.locator('#plan-card details.table-details summary').click();
    check((await page.locator('#plan-card .card-table').innerText()).includes(NAME), 'Pièces : la pièce ajoutée n’est pas sur le plan');
    // never in clear on this device; kept across a reload (sealed draft)
    const stored = await page.evaluate(() => Object.values(localStorage).join('\n'));
    check(!stored.includes('Véranda'), 'le plan est gardé en clair dans ce navigateur');
    await page.reload();
    const demo = page.getByRole('button', { name: /données de démonstration/ });
    await Promise.race([demo.waitFor({ timeout: 60000 }), page.waitForSelector('header.top', { timeout: 60000 })]);
    if (await demo.isVisible().catch(() => false)) await demo.click();
    await page.waitForSelector('header.top', { timeout: 60000 });
    await openEditor(page);
    await page.waitForFunction((n) => [...document.querySelectorAll('[data-plan-select]')].some((b) => b.textContent === n), NAME, { timeout: 15000 }).catch(() => {});
    check((await card(page).locator('[data-plan-select]').allInnerTexts()).includes(NAME), 'rechargement : la pièce ajoutée est perdue');
    // back to the household's version
    await card(page).locator('#plan-reset').click();
    await frames(page);
    check(!(await card(page).locator('[data-plan-select]').allInnerTexts()).includes(NAME), '« Revenir à la version du foyer » garde la pièce');
    await ctx.close();
  });

  await part('360 px, texte 200 %', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { font-family: "DejaVu Sans", sans-serif !important; }' });
    await card(page).locator('.plan-edit-svg').waitFor(SHORT);
    await card(page).locator('[data-plan-select]').first().click();
    await frames(page);
    // this card only: in WebKit at 200 %, the « Motif » list of « Radiateurs arrêtés », on the same
    // page, already widens it (seen on main, reported apart)
    const out = await card(page).evaluate((c) =>
      [c, ...c.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > 361 || e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && !(e instanceof SVGElement)).map((e) => e.tagName + (e.id ? '#' + e.id : '')),
    );
    check(!out.length, `200 % : la carte dépasse l’écran (${out.slice(0, 4).join(', ')})`);
    await card(page).screenshot({ path: `${OUT}/plan-edition-${BROWSER}-200.png` });
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
console.log(`${BROWSER} : éditeur du plan de la maison (pièce, appareil, glisser, brouillon scellé, 200 %, axe)`);
