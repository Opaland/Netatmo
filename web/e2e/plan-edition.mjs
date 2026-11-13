// #202: the editor of the plan of the house (⚙ Mon logement → « Plan de la maison »), in the demo
// (a fictitious plan).
// - A room is added, named, sized by its fields (the caret stays in the form), moved by dragging
//   (finger: touch events of a phone; by whole cells), and a device is added and said which one
//   it is; the drawing follows each change.
// - #597: while a mark or a room is held (finger and mouse), no mark covers a letter of a name
//   (the measure of plan.mjs, plan-mots.mjs) and a room's name moves with it.
// - The change applies on this device at once: Pièces → Plan shows it; it survives a reload
//   (sealed draft), never in clear in localStorage; « Revenir à la version du foyer » drops it.
// - The demo sends nothing: « Enregistrer pour le foyer » stays disabled.
// - axe; 360 px with the system text at 200 % (DejaVu Sans, A6) without horizontal scroll.
// Run after `npm run build`: node e2e/plan-edition.mjs (port: E2E_PORT; E2E_BROWSER=webkit|chromium).
// Captures in e2e/screenshots/plan-edition-*.png.
import { chromium, webkit } from 'playwright';
import { frames, goto, openDemo, ready, seriousAxe, startPreview } from './lib.mjs';
import { capturesOut } from './captures.mjs';
import { coveredLetters } from './plan-mots.mjs';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const OUT = capturesOut(); // #583: e2e/screenshots/ only in the CI's font
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
/**
 * #597: a gesture pressed at `from` and moved to `to`, held (finger not yet lifted); returns the
 * release. `how`: « doigt », touch events of a phone through CDP (Chromium); « souris », the mouse
 * (pointer events: the same path in the editor).
 */
async function hold(page, how, from, to) {
  if (how === 'doigt') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch('touchStart', from);
    for (let i = 1; i <= 6; i++) await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
    await touch('touchMove', to); // the last move again: CDP may coalesce it with the end of the touch
    return () => touch('touchEnd');
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  return () => page.mouse.up();
}
/** A drag: the finger in Chromium, the mouse in WebKit. */
async function drag(page, box, dx, dy) {
  const from = { x: box.x + 6, y: box.y + 6 };
  const release = await hold(page, BROWSER === 'chromium' ? 'doigt' : 'souris', from, { x: from.x + dx, y: from.y + dy });
  await frames(page);
  await release();
}
/** The point on the screen of a point of the drawing given in cells. */
const cellPoint = (page, x, y) =>
  card(page)
    .locator('.plan-edit-svg')
    .evaluate(
      (svg, [x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
        return { x: p.x, y: p.y };
      },
      [x, y],
    );
/** Read again until `ok` (or 3 s): the layout of a gesture lands at a later image, a single reading proves nothing. */
async function settle(page, read, ok) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < 3000) {
    await frames(page);
    v = await read();
  }
  return v;
}

try {
  await part('édition', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await card(page).locator('.plan-edit-svg').waitFor(SHORT);
    check(await card(page).locator('#plan-save').isDisabled(), 'démo : « Enregistrer pour le foyer » actif');
    await page.locator('[data-plan-edit-level="rdc"]').click();
    await frames(page);
    // #541: the list of the devices is folded (the card was 1 476 px high at 360 px), and says how many
    const fold = card(page).locator('#plan-devices');
    check(!(await fold.evaluate((d) => d.open)) && /Appareils de ce niveau \(\d+\)/.test(await fold.locator('summary').innerText()), 'appareils : liste non repliée ou sans leur nombre');
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
    // #541: the label in metres follows the value, the focus goes on to the next field
    check(/^Largeur \(4\s?m\)$/u.test(await card(page).locator('[data-plan-l="w"]').innerText()), `largeur : libellé « ${await card(page).locator('[data-plan-l="w"]').innerText()} »`);
    check(await card(page).locator('[data-plan-f="h"]').evaluate((f) => f === document.activeElement), 'largeur : le focus ne passe pas à la profondeur');
    // #541: the link to a station module says what it is for
    check(/pas encore lu/.test(await card(page).locator('#plan-module-hint').innerText()), 'module de la station : son usage n’est pas dit');
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
    check(await card(page).locator('#plan-devices').evaluate((d) => d.open), 'appareil choisi : sa liste reste repliée');
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

  // revue v2.1 (persona 52): a name typed in the plan is text everywhere it is written (list,
  // drawing, form, Pièces → Plan and its table), never markup
  await part('nom saisi = texte', async () => {
    const { ctx, page } = await newPage();
    const HOSTILE = '<img id="xss" src="x">"&';
    await openDemo(page, base, null, 'parametres-logement');
    await card(page).locator('.plan-edit-svg').waitFor(SHORT);
    await page.locator('#plan-add-room').click();
    await card(page).locator('[data-plan-f="name"]').fill(HOSTILE);
    await page.keyboard.press('Tab');
    await frames(page);
    const noMarkup = async (where) => check((await page.locator('#xss').count()) === 0, `${where} : le nom saisi est devenu du HTML`);
    await noMarkup('éditeur');
    check((await card(page).locator('[data-plan-select]').allInnerTexts()).includes(HOSTILE), 'éditeur : le nom saisi n’est pas dit tel quel dans la liste');
    check((await card(page).locator('.plan-edit-svg text.plan-label').allTextContents()).some((t) => t.startsWith('<img')), 'éditeur : le nom saisi n’est pas écrit tel quel sur le dessin');
    await goto(page, 'pieces');
    await page.locator('[data-set="piecesShow"][data-value="plan"]').click();
    await ready(page);
    await page.locator('#plan-card details.table-details summary').click();
    await noMarkup('Pièces → Plan');
    check((await page.locator('#plan-card .card-table').innerText()).includes(HOSTILE), 'Pièces → Plan : le nom saisi n’est pas dit tel quel dans le tableau');
    await ctx.close();
  });

  // #597 (revue v2.3, #564 n° 2): WHILE the gesture is held, the words follow the same rule as the
  // drawing laid down (plan.mjs): a mark dragged onto a room's name never covers a letter of it,
  // and a room dragged carries its name inside it. Measured on what is painted (elementFromPoint),
  // read again until the layout of the image lands, transitions cut; at the finger and the mouse.
  for (const how of BROWSER === 'chromium' ? ['doigt', 'souris'] : ['souris']) {
    await part(`pendant le geste (${how})`, async () => {
      const { ctx, page } = await newPage();
      await openDemo(page, base, null, 'parametres-logement');
      await card(page).locator('.plan-edit-svg').waitFor(SHORT);
      await page.locator('[data-plan-edit-level="rdc"]').click();
      await frames(page);
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      await card(page).locator('.plan-edit-svg').scrollIntoViewIfNeeded();
      const svg = card(page).locator('.plan-edit-svg');
      const word = (name) => card(page).locator(`.plan-edit-svg g.plan-text text[data-full="${name}"]`);
      const crosses = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

      // a mark (the demo radiator of « Salon », cell 0 4) held on the first letters of « Salon » (cell 1 0)
      const salon = await word('Salon').boundingBox();
      const mark = card(page).locator('.plan-edit-svg g.plan-device[data-plan-item="a2"]');
      const markBox = await mark.locator('rect').boundingBox();
      let release = await hold(page, how, { x: markBox.x + markBox.width / 2, y: markBox.y + markBox.height / 2 }, await cellPoint(page, 1.5, 0.5));
      const held = await settle(
        page,
        async () => ({
          cell: await mark.getAttribute('data-cell'),
          on: await mark.locator('rect').boundingBox(),
          covered: await svg.evaluate(coveredLetters, false),
          name: await word('Salon').textContent(),
        }),
        (v) => v.cell === '1 0' && !v.covered.length,
      );
      // the precondition: the mark is held where the name was painted before the gesture
      check(held.cell === '1 0' && crosses(held.on, salon), `${how} : la marque tenue n’est pas sur l’ancien nom « Salon » (case ${held.cell})`);
      check(!held.covered.length, `${how} : pendant le geste, une marque couvre un mot : ${held.covered.join(' ; ')}`);
      check(!!held.name?.trim(), `${how} : pendant le geste, le nom « Salon » a disparu au lieu de s’écarter`);
      await release();
      await card(page).locator('[data-plan-f="x"]').waitFor(SHORT);
      await frames(page);
      check((await card(page).locator('[data-plan-f="x"]').inputValue()) === '1', `${how} : après le geste, le champ « Colonne » de l’appareil ne dit pas 1`);

      // a room (« Salon », 0 0, 12 × 10) held two rows lower: its name is painted inside it, during the gesture
      await svg.scrollIntoViewIfNeeded();
      release = await hold(page, how, await cellPoint(page, 9.5, 7.5), await cellPoint(page, 9.5, 9.5));
      const room = card(page).locator('.plan-edit-svg rect.plan-room[data-plan-item="p2"]');
      const moved = await settle(
        page,
        async () => {
          const r = await room.boundingBox();
          const letters = await word('Salon').evaluate((t) => {
            const m = t.getScreenCTM();
            return [...Array(t.getNumberOfChars()).keys()].map((i) => {
              const e = t.getExtentOfChar(i);
              const p = new DOMPoint(e.x + e.width / 2, e.y + e.height / 2).matrixTransform(m);
              return { x: p.x, y: p.y };
            });
          });
          const out = letters.filter((p) => !(p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height)).length;
          return { y: await room.getAttribute('y'), letters: letters.length, out, covered: await svg.evaluate(coveredLetters, false) };
        },
        (v) => v.y === '2' && v.letters > 0 && !v.out && !v.covered.length,
      );
      check(moved.y === '2', `${how} : la pièce tenue n’a pas suivi le geste (ligne ${moved.y})`);
      check(moved.letters > 0 && !moved.out, `${how} : pendant le geste, le nom « Salon » reste hors de sa pièce (${moved.out} lettres sur ${moved.letters})`);
      check(!moved.covered.length, `${how} : pendant le geste de la pièce, une marque couvre un mot : ${moved.covered.join(' ; ')}`);
      await release();
      await card(page).locator('[data-plan-f="y"]').waitFor(SHORT);
      await frames(page);
      check((await card(page).locator('[data-plan-f="y"]').inputValue()) === '2', `${how} : après le geste, le champ « Ligne » de la pièce ne dit pas 2`);
      await ctx.close();
    });
  }

  await part('360 px, texte 200 %', async () => {
    const { ctx, page } = await newPage();
    await openDemo(page, base, null, 'parametres-logement');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { font-family: "DejaVu Sans", sans-serif !important; }' });
    await card(page).locator('.plan-edit-svg').waitFor(SHORT);
    await card(page).locator('[data-plan-select]').first().click();
    await frames(page);
    // the whole page (#540: in WebKit, the « Motif » list of « Radiateurs arrêtés » followed its
    // longest option and widened ⚙ Mon logement by 225 px), then this card element by element
    const page_w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(page_w <= 360, `200 % : ⚙ Mon logement défile en largeur (${page_w} px pour 360)`);
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
