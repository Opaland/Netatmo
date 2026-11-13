// #337 « Expliquer un mois » and #346 rooms without reading, in the demo: the kitchen radiator
// switched off on purpose since 14 October 2025 (a wood stove, declared in ⚙ Mon logement) and the
// kids' bedroom out of reach since 5 November 2026. The link under the verdict of Accueil and the
// row of Outils, January 2026 explained (sentence, parts from 0 with the change of heating, rooms),
// « hors ligne » vs « arrêté (poêle) » in Accueil, Pièces, the room pages and État des données,
// the setting of Mon logement; axe in light, dark and high contrast, 360 px with the text at
// 200 % (no horizontal scroll).
// Run after `npm run build`: node e2e/expliquer.mjs  (starts `vite preview` itself; port: E2E_PORT;
// E2E_BROWSER=webkit|chromium). Captures in e2e/screenshots/expliquer-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { chromium, webkit } from 'playwright';

const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const PORT = Number(process.env.E2E_PORT ?? 4186);
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

const shown = (page, key) => page.waitForSelector(`#view[data-page="${key}"][data-ready]`, { state: 'attached', timeout: 30000 });
async function go(page, key) {
  const tab = page.locator(`.tabs [data-view="${key}"]`);
  if (await tab.count()) await tab.click();
  else await page.evaluate((k) => (location.hash = `#${k}`), key);
  await shown(page, key);
}
async function audit(page, where, enhanced = false) {
  progress(`axe ${where}`);
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', ...(enhanced ? ['wcag2aaa'] : [])]);
  if (enhanced) builder.withRules(['color-contrast-enhanced']);
  const { violations } = await builder.analyze();
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'))
    errors.push(`${BROWSER} ${where} : axe « ${v.id} » → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}
/**
 * #532: an audit report as the workflow Diagnostic writes it (the shared fixture of
 * tests/test_audit.py), its fictive room named as a demo room, encrypted with the demo key.
 */
async function auditFile() {
  const info = JSON.parse(readFileSync('dist/demo/keyinfo.json', 'utf8'));
  const named = readFileSync('src/__fixtures__/audit-report.json', 'utf8').replaceAll('1234500100', 'r-bureau');
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('demo'), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(info.salt, 'base64'), iterations: info.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(named)));
  return Buffer.from(JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: info.iter, salt: info.salt, iv: Buffer.from(iv).toString('base64'), ct: ct.toString('base64') }));
}
const AUDIT = await auditFile();

const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const BEDROOM = /Chambre enfant : hors ligne depuis le 5 nov\. 2026/;
const STOVE = /arrêté depuis le 14 oct\. 2025 \(poêle\)/;

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

    // ---------------------------------------------------------------- Accueil: the room offline, the stove, the link under the verdict
    progress(`${name} : Accueil`);
    await go(page, 'accueil');
    // the room out of reach is said in the verdict that leaves it out, with what to do (#346,
    // #311), in the very phrase that says the scope of its figures (#383)
    const warn = (await page.locator('.verdict .verdict-warn').allInnerTexts()).join(' ');
    check(/^⚠ hors Chambre enfant, hors ligne depuis le 5 nov\. \(que faire \?\)$/.test(warn.trim()), `${name} : « hors ligne » absent du verdict (« ${warn} »)`);
    check(!/Cuisine/.test(warn), `${name} : la Cuisine, arrêtée volontairement, signalée hors ligne (« ${warn} »)`);
    // #383: the figures of the verdict add up, over one scope said in the sentence
    {
      const num = (s) => Number(s.replace(/[\s  ]/g, '').replace('−', '-'));
      const title = (await page.locator('#verdict-title').innerText()).trim();
      const said = (await page.locator('.verdict .verdict-sub').first().innerText()).replace(/\s+/g, ' ');
      // #433: the demo's stove: the verdict counts the heating electricity + wood, and says so
      const h = title === "Comme d'habitude" ? ['', '0', 'plus'] : /^([\d\s  ]+)\s€ de (moins|plus) que d'habitude$/.exec(title);
      const s = /^([\d\s  ]+)\s€ d’électricité \+ bois \(([\d\s  ]+)\skWh\) ⚠ hors Chambre enfant, hors ligne depuis le 5 nov\. \(que faire \?\), en novembre \(au 8\), pour ([\d\s  ]+)\s€ attendus .*?\(([−+]?[\d\s  ]+)\s%\)/.exec(said);
      check(h && s, `${name} : verdict illisible (« ${title} » / « ${said.slice(0, 200)} »)`);
      if (h && s) {
        const gap = num(h[1]) * (h[2] === 'moins' ? -1 : 1);
        const [spent, expected, pct] = [num(s[1]), num(s[3]), num(s[4])];
        check(gap === spent - expected, `${name} : « ${title} » mais ${spent} € pour ${expected} € (#383)`);
        const lo = Math.floor(((spent - 0.5) / (expected + 0.5) - 1) * 100);
        const hi = Math.ceil(((spent + 0.5) / (expected - 0.5) - 1) * 100);
        check(pct >= lo && pct <= hi, `${name} : ${pct} % pour ${spent} € sur ${expected} € (#383)`);
      }
    }
    check((await page.locator('.verdict .verdict-warn a[href="#piece-r-ch2"]').count()) === 1, `${name} : « que faire ? » ne mène pas à la Chambre enfant`);
    const link = page.locator('.verdict a.verdict-link[href^="#outils-expliquer-"]');
    check((await link.count()) === 1, `${name} : lien « Pourquoi ? » absent sous le verdict`);
    const sub = await page.locator('.verdict').innerText();
    check(/Pourquoi \? \(poêle\)/.test(sub) && /dont le poêle \(Cuisine\)/.test((await link.textContent()) ?? ''), `${name} : le verdict n'attribue pas la baisse au poêle (« ${sub.slice(0, 300)} »)`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur l'Accueil (${await wide(page)} px)`);

    // ---------------------------------------------------------------- the link opens the month shown
    progress(`${name} : Expliquer un mois`);
    const href = (await link.getAttribute('href')) ?? '';
    await link.click();
    await shown(page, href.slice(1));
    check((await page.locator('select[data-explain-month]').count()) === 1, `${name} : choix du mois absent`);
    check(BEDROOM.test(await page.locator('#view').innerText()), `${name} : la Chambre enfant hors ligne n'est pas signalée dans l'explication du mois`);

    // ---------------------------------------------------------------- January 2026, the owner's question
    await page.selectOption('select[data-explain-month]', '2026-01');
    await shown(page, 'outils-expliquer-2026-01');
    await page.waitForSelector('#explain-chart .cascade-row', { timeout: 15000 }).catch(() => errors.push(`${name} : cascade absente`));
    // short names on the chart, and no text over another text or a bar (360 px, text at 200 % included)
    const names = await page.locator('#explain-chart .cascade-label').allInnerTexts();
    check(names.join('|') === 'Météo|Consignes|Poêle|Pièces|Eau chaude|Autres', `${name} : libellés de la cascade (${names.join(' | ')})`);
    const clash = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('#explain-chart .cascade-label, #explain-chart .cascade-value, #explain-chart .cascade-track i')].map((e) => {
        const r = e.getBoundingClientRect();
        return { what: `${e.className || e.tagName} « ${e.textContent} »`, l: r.left, r: r.right, t: r.top, b: r.bottom, text: e.tagName !== 'I' };
      });
      const out = [];
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        if (a.text && (a.l < 0 || a.r > window.innerWidth)) out.push(`${a.what} hors de l'écran`);
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          if (!a.text && !b.text) continue;
          if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) out.push(`${a.what} sur ${b.what}`);
        }
      }
      return out;
    });
    check(!clash.length, `${name} : cascade, textes superposés : ${clash.slice(0, 4).join(' ; ')}`);
    const sentence = await page.locator('#explain-sentence').innerText();
    check(/^En janvier 2026, le logement a consommé \d+\skWh de moins qu’en janvier 2025/.test(sentence), `${name} : phrase de synthèse inattendue (« ${sentence} »)`);
    check(/Surtout le poêle \(Cuisine\)/.test(sentence) && /plus froid/.test(sentence), `${name} : la synthèse ne cite ni le poêle ni la météo (« ${sentence} »)`);
    const steps = await page.locator('#explain-steps ul[aria-label="Écart par cause"] .row').allInnerTexts();
    const want = ['Météo', 'Températures demandées', 'Changement de mode de chauffage (poêle : Cuisine)', 'Pièces', 'Eau chaude', 'Autres usages']; // the full names, under the chart
    check(want.every((w, i) => steps[i]?.startsWith(w)), `${name} : parts de l'écart (${steps.map((s) => s.split('\n')[0]).join(' | ')})`);
    // #366: the stove's wood, out of the meter: its own line, never in the parts that add up
    const wood = await page.locator('#explain-wood').innerText();
    check(/Poêle \(bois\)[\s\S]*≈ [\d\s ]+\skWh de chaleur et ≈ \d+\s€ en janv\. 2026/.test(wood) && /Chauffage électricité \+ bois/.test(wood), `${name} : ligne « poêle » absente (« ${wood.slice(0, 200)} »)`);
    check(!steps.some((s) => /bois/.test(s.split('\n')[0])), `${name} : le bois compté dans les parts de l'écart`);
    const scope = await page.locator('#view .periodbar .scope').innerText();
    check(/^Compté : tout le logement \(compteur Linky\), du 1er janv\. au 31 janv\. 2026, comparé aux mêmes jours de janvier 2025$/.test(scope), `${name} : ligne « Compté : » (« ${scope} »)`);
    // the parts are drawn from 0 (no zoomed axis): the summary gives both totals
    const aria = (await page.locator('#explain-chart').getAttribute('aria-label')) ?? '';
    check(/^Écart par cause, en kWh\. de [\d\s ]+\skWh \(janv\. 2025\) à [\d\s ]+\skWh \(janv\. 2026\)/.test(aria), `${name} : résumé de la cascade (« ${aria.slice(0, 160)} »)`);
    const view = await page.locator('#view').innerText();
    check(/Cuisine : radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(view) && !/Cuisine : hors ligne/.test(view), `${name} : la Cuisine arrêtée n'est pas signalée comme telle dans l'explication`);
    check((await page.locator('#explain-rooms .row').count()) >= 5, `${name} : pièce par pièce incomplet`);
    check((await wide(page)) <= 1, `${name} : défilement horizontal sur « Expliquer un mois » (${await wide(page)} px)`);
    await audit(page, `${name}/expliquer`, enhanced);
    await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}.png`, fullPage: true });

    // #366: winter against winter (Historique) counts the whole heating, electricity + wood
    if (name === 'clair' || big) {
      await go(page, 'historique');
      // #426: folded under its headline (the change in energy and euros), the winters inside
      const fold = page.locator('#wood-seasons');
      const headline = (await fold.count()) ? await fold.locator('summary').innerText() : '';
      check(/^Électricité \+ bois : [−+]\d+\s% en énergie, [−+]\d+\s% en euros$/.test(headline), `${name} : hiver contre hiver, l'écart électricité + bois absent du titre replié (« ${headline} »)`);
      // #432 (decision of the owner): its headline in the text colour, not muted
      const [head, text] = (await fold.count())
        ? await fold.locator('summary').evaluate((s) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text)';
            s.parentElement.append(probe);
            const out = [getComputedStyle(s).color, getComputedStyle(probe).color];
            probe.remove();
            return out;
          })
        : ['', '?'];
      check(head === text, `${name} : hiver contre hiver, le titre replié n'est pas en couleur de texte (${head} au lieu de ${text})`);
      if (await fold.count()) await fold.locator('summary').click();
      const seasons = (await fold.count()) ? await fold.innerText() : '';
      check(/2025–2026 : ≈ [\d\s ]+\skWh dont [\d\s ]+\skWh de bois, ≈ [\d\s ]+\s€/.test(seasons) && /en énergie, [−+]\d+\s% en euros/.test(seasons), `${name} : hiver contre hiver sans le bois (« ${seasons.slice(0, 200)} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur Historique (${await wide(page)} px)`);
    }

    // #469: the fires of the demo's stove (two bedrooms warming at 0 W), a calendar of its own
    // under Historique, and « poêle allumé ce soir ? » kept on the device
    {
      await go(page, 'historique');
      const link = page.locator('#history-more a[href="#historique-flambees"]');
      check((await link.count()) === 1, `${name} : Historique sans le lien « Flambées du poêle »`);
      await go(page, 'historique-flambees');
      const card = page.locator('#fires-card');
      const rows = await card.locator('[data-fire-day]').count();
      check(rows >= 5, `${name} : flambées, ${rows} soir(s) listé(s) au lieu des soirs de la démo`);
      const text = await card.innerText();
      check(/\d+ soirs de flambée sur \d+ soirs où la détection peut juger/.test(text), `${name} : flambées, compte des soirs absent (« ${text.slice(0, 160)} »)`);
      check(/Confiance : à établir/.test(text), `${name} : flambées, confiance non dite`);
      check(/2 pièces témoins · (nette|à peine marquée)/.test(text), `${name} : flambées, pièces témoins ou netteté absentes`);
      check(/à partir de \d+ h( 30)? · ≈ \d+ h/.test(text), `${name} : flambées, heure et durée absentes`);
      check(!/Chambre|Cuisine/.test(text), `${name} : flambées, un nom de pièce affiché`);
      await audit(page, `${name}/flambees`, enhanced);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur Flambées (${await wide(page)} px)`);
      if (name === 'clair') {
        await card.locator('[data-fire-answer="yes"]').click();
        await page.waitForSelector('#fires-card [data-fire-answer="yes"][aria-pressed="true"]', { timeout: 10000 }).catch(() => {});
        check((await card.locator('[data-fire-answer="yes"]').getAttribute('aria-pressed')) === 'true', `${name} : flambées, « Oui » non retenu`);
        check(await card.locator('[data-fire-answer="yes"]').evaluate((b) => b === document.activeElement), `${name} : flambées, focus perdu après « Oui »`);
        // kept encrypted on the device: still there after leaving and coming back
        await go(page, 'historique');
        await go(page, 'historique-flambees');
        check((await page.locator('#fires-card [data-fire-answer="yes"]').getAttribute('aria-pressed')) === 'true', `${name} : flambées, réponse perdue en revenant`);
        await page.locator('#fires-card [data-fire-answer="none"]').click();
        await page.waitForSelector('#fires-card [data-fire-answer="yes"][aria-pressed="false"]', { timeout: 10000 }).catch(() => {});
      }
      await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}-flambees.png`, fullPage: true });
    }

    // #460: the screens that judge the insulation count the stove's wood (the one split of #433)
    if (name === 'clair' || big) {
      await go(page, 'historique-froid');
      const pick = page.locator('#sig-card [data-set="sigEnergy"][aria-checked="true"]');
      check((await pick.count()) === 1 && (await pick.innerText()) === 'Électricité + bois', `${name} : la signature n'est pas en électricité + bois par défaut`);
      const wk = await page.locator('#iso-wk').innerText();
      // #499: the words of the grid first, the W/°C in detail
      const m = /^Logement (très bien|bien|moyennement|mal) isolé, à titre indicatif \(pertes ≈ ([\d\s  ]+) W\/°C, électricité \+ bois, hiver 2025–2026\)\. Électricité seule : ([\d\s  ]+) W\/°C\./.exec(wk);
      const num = (v) => Number(v.replace(/\s/g, ''));
      check(!!m && num(m[2]) > num(m[3]), `${name} : verdict d'isolation sans le bois, ou pas plus fort qu'électricité seule (« ${wk} »)`);
      const isoHint = await page.locator('#sig-isolation').innerText();
      check(/Repères indicatifs, pas un diagnostic : en W\/°C, < 100 très bien · 100–170 bien · 170–280 moyen · > 280 mal isolé/.test(isoHint), `${name} : grille indicative absente (« ${isoHint.slice(0, 300)} »)`);
      const slope = async () => num(((await page.locator('#sig-table tbody tr').nth(1).locator('td').nth(2).innerText()).split('[')[0]).replace(',', '.'));
      const both = await slope();
      await page.locator('#sig-card [data-set="sigEnergy"][data-value="elec"]').click();
      await page.waitForSelector('#sig-card [data-set="sigEnergy"][data-value="elec"][aria-checked="true"]', { timeout: 10000 });
      await shown(page, 'historique-froid');
      const alone = await slope();
      check(both > alone && alone > 0, `${name} : la pente électricité + bois (${both}) n'est pas plus forte que l'électricité seule (${alone})`);
      check((await page.locator('#iso-wk').innerText()) === wk, `${name} : le verdict d'isolation change avec l'affichage électricité seule`);
      await page.locator('#sig-card [data-set="sigEnergy"][data-value="wood"]').click();
      await page.waitForSelector('#sig-card [data-set="sigEnergy"][data-value="wood"][aria-checked="true"]', { timeout: 10000 });
      await shown(page, 'historique-froid');
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur « Chauffage selon le froid » (${await wide(page)} px)`);
      await go(page, 'historique-annees');
      const years = await page.locator('#years-card').innerText();
      check(/Chauffage électricité \+ bois/.test(years) && /\n2025\t[\d\s  ]+\t[1-9][\d\s  ]*\t\d+,\d\d\t[\d\s  ]+\s€/.test(years), `${name} : « Année par année » sans le chauffage électricité + bois (« ${years.slice(-700)} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur « Année par année » (${await wide(page)} px)`);
    }

    // #394: October 2026 has two cuts in the incident log (14 Oct. power, 31 Oct. Internet): left out of both months
    if (name === 'clair' || big) {
      await page.evaluate(() => (location.hash = '#outils-expliquer-2026-10'));
      await shown(page, 'outils-expliquer-2026-10');
      const oct = await page.locator('#view .periodbar .scope').innerText();
      check(/sans le 14 oct\. \(coupure de courant\) ni le 31 oct\. \(coupure Internet\) : jours retirés des deux mois/.test(oct), `${name} : octobre 2026 compte les jours de coupure (« ${oct} »)`);
      // #423: the stove's wood skips the same days, and the line says so when the wood card is there
      const woodShown = (await page.locator('#explain-wood').count()) > 0;
      check(woodShown && /des deux mois, bois du poêle compris$/.test(oct), `${name} : octobre 2026, le bois compté les jours de coupure (« ${oct} »)`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur octobre 2026 (${await wide(page)} px)`);
    }

    // ---------------------------------------------------------------- Outils, Pièces and the room pages
    if (name === 'clair' || big) {
      await go(page, 'outils');
      check((await page.locator('#view a[href="#outils-expliquer"]').count()) === 1, `${name} : « Expliquer un mois » absent d'Outils`);
      // Historique: a month opens its explanation
      await go(page, 'historique');
      await page.locator('#explain-fold summary').click(); // #386: folded under the winter chart
      const jan = page.locator('#explain-links a[href="#outils-expliquer-2026-01"]');
      check((await jan.count()) === 1 && /Expliquer janv\. 2026 \(janvier 2026\)/.test((await jan.textContent()) ?? ''), `${name} : pas de lien « janv. 2026 » dans l'Historique`);
      await jan.click();
      await shown(page, 'outils-expliquer-2026-01');
      check((await page.locator('select[data-explain-month]').inputValue()) === '2026-01', `${name} : l'Historique n'ouvre pas janvier 2026`);
      await go(page, 'pieces');
      const list = await page.locator('#view ul[aria-label^="Pièces chauffées"]').innerText();
      check(/Chambre enfant[\s\S]*hors ligne depuis le 5 nov\. 2026/.test(list), `${name} : Pièces ne dit pas que la Chambre enfant est hors ligne`);
      check(new RegExp(`Cuisine[\\s\\S]*${STOVE.source}`).test(list), `${name} : Pièces ne dit pas que la Cuisine est arrêtée (poêle)`);
      check(!/Cuisine\s*\n?\s*0 (kWh|€)/.test(list), `${name} : la Cuisine affiche 0`);
      await go(page, 'piece-r-ch2');
      const p = await page.locator('#view').innerText();
      check(BEDROOM.test(p) && /non comparé/.test(p), `${name} : page Chambre enfant sans « hors ligne » ni comparaison écartée`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur la page Chambre enfant (${await wide(page)} px)`);
      await audit(page, `${name}/chambre-enfant`, enhanced);
      await go(page, 'piece-r-cuisine');
      const k = await page.locator('#view').innerText();
      check(/Radiateur arrêté depuis le 14 oct\. 2025 \(poêle\)/.test(k) && /changement de mode de chauffage/.test(k) && !/hors ligne/.test(k), `${name} : page Cuisine sans « arrêté (poêle) » (« ${k.slice(0, 300)} »)`);
      await audit(page, `${name}/cuisine`, enhanced);
      await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}-cuisine.png`, fullPage: true });

      // ---------------------------------------------------------------- État des données: no data expected, the year not degraded by it
      progress(`${name} : État des données`);
      await go(page, 'etat');
      await page.waitForSelector('#quality-sources', { timeout: 15000 });
      // #387: the details are folded, one line per source and per year
      await page.click('#quality-sources [data-source=heating] > summary');
      await page.click('#quality-years > summary');
      const etat = await page.locator('#view').innerText();
      check(/Cuisine : radiateur arrêté volontairement depuis le 14 oct\. 2025 \(chauffée par un poêle à bois\) : pas de données attendues/.test(etat), `${name} : État des données sans « arrêté volontairement : pas de données attendues »`);
      check(!/muette depuis le 14 oct\. 2025/.test(etat), `${name} : État des données compte la Cuisine comme muette`);
      // 2025 and 2026 (since the stove): never explained by the kitchen; 2024 has its own gap (two rooms)
      const years = (await page.locator('#quality-years .year-verdict').allInnerTexts()).slice(0, 2).join(' ');
      // #336: the kitchen is named once per year, as stopped on purpose (not a hole), never as a gap
      const stoppedLine = /Cuisine : radiateur arrêté volontairement depuis le 14 oct\. 2025[^\n]*: pas de données attendues, ce n’est pas un trou\./g;
      check((years.match(stoppedLine) ?? []).length === 2, `${name} : 2025 et 2026 sans « Cuisine : … ce n’est pas un trou » (« ${years.replace(/\s+/g, ' ').slice(0, 300)} »)`);
      check(/^2026/.test(years) && /2025/.test(years) && !/Cuisine/.test(years.replace(stoppedLine, '')), `${name} : 2025 ou 2026 expliquée par la Cuisine arrêtée (« ${years.replace(/\s+/g, ' ').slice(0, 300)} »)`);
      // État des appareils: the kitchen radiator is switched off on purpose, not « injoignable »
      await page.waitForSelector('#devices-card:not([hidden])', { state: 'attached', timeout: 15000 });
      await page.click('#devices-fold > summary');
      const dev = await page.locator('#devices-card').innerText();
      check(/Radiateur arrêté volontairement : Cuisine, depuis le 14 octobre 2025 \(chauffée par un poêle à bois\)/.test(dev), `${name} : État des appareils sans « radiateur arrêté volontairement » (« ${dev.slice(0, 300)} »)`);
      check(/Un module Intuis ne répond plus\s+Radiateur \(Chambre enfant\)/.test(dev) && !/adiateur \(Cuisine\) depuis/.test(dev), `${name} : État des appareils dit la Cuisine injoignable (« ${dev.slice(0, 300)} »)`);
      // #532: the detailed audit, opened from the file the workflow Diagnostic gives (encrypted)
      const auditCard = page.locator('#audit-card');
      await page.waitForSelector('#audit-card #audit-file', { state: 'attached', timeout: 15000 });
      await page.click('#audit-fold > summary'); // folded: État des données holds in 4 screens (#387)
      check(/workflow Diagnostic/.test(await auditCard.innerText()), `${name} : carte « Audit détaillé » sans le mode d'emploi`);
      // revue v2.2: the audit checks the values too (#547), and says so before a report is opened
      const intro = (await auditCard.innerText()).replace(/\s+/g, ' ');
      check(/bonnes valeurs \(/.test(intro) && /bonnes valeurs : rapport à ouvrir/.test(intro), `${name} : l'audit détaillé ne dit pas qu'il vérifie les valeurs (« ${intro.slice(0, 200)} »)`);
      await page.setInputFiles('#audit-card #audit-file', { name: 'audit-donnees.enc.json', mimeType: 'application/json', buffer: AUDIT });
      await page.waitForSelector('#audit-card [data-audit="heure-inexistante"]', { timeout: 15000 });
      await page.click('#audit-card [data-audit="heure-inexistante"] > summary');
      await page.click('#audit-card [data-audit="deux-fichiers"] > summary');
      const au = (await auditCard.innerText()).replace(/\s+/g, ' ');
      check(/31 mars 2024, Bureau/.test(au) && /Heure qui n’existe pas|Heure qui n'existe pas/.test(au), `${name} : audit sans le cas du 31 mars 2024 (Bureau) (« ${au.slice(0, 300)} »)`);
      check(/5 mars 2024, Bureau/.test(au) && /celle du fichier de l'année du jour/.test(au), `${name} : audit sans le jour rangé dans deux fichiers (« ${au.slice(0, 300)} »)`);
      check(/gardé chiffré sur cet appareil/.test(au), `${name} : rapport d'audit non gardé chiffré`);
      check((await wide(page)) <= 1, `${name} : défilement horizontal sur État des données (${await wide(page)} px)`);
      await audit(page, `${name}/etat`, enhanced);

      // ---------------------------------------------------------------- ⚙ Mon logement: declare the bedroom switched off, the alert goes
      progress(`${name} : Mon logement`);
      await go(page, 'parametres-logement');
      const card = page.locator('#stopped-card');
      check(/Cuisine/.test(await card.locator('ul[aria-label="Radiateurs arrêtés"]').innerText()), `${name} : la Cuisine n'est pas listée parmi les radiateurs arrêtés`);
      // revue v1.7: a stopped room keeps the colour of its room (#300), not the orange of the heating usage
      const swatchOf = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
      const [stoppedColor, roomColorShown] = [await swatchOf('#stopped-card ul[aria-label="Radiateurs arrêtés"] .swatch'), await swatchOf('a[href="#piece-r-cuisine"] .swatch')];
      check(stoppedColor === roomColorShown, `${name} : radiateur arrêté de la Cuisine en ${stoppedColor}, la pièce en ${roomColorShown}`);
      check(/Chambre enfant n’envoie plus rien depuis le 5 nov\. 2026/.test(await card.innerText()), `${name} : la Chambre enfant n'est pas proposée`);
      await audit(page, `${name}/logement`, enhanced);
      if (!big) {
        await page.selectOption('#stop-room', 'r-ch2');
        // #440: radiators taken down: listed with their reason, and their module raises nothing
        await page.selectOption('#stop-reason', 'retires');
        await page.click('#stop-add');
        await page.waitForSelector('#stopped-card [data-stop-remove="r-ch2"]', { timeout: 10000 });
        check(/Chambre enfant\s*arrêté depuis le 5 nov\. 2026 \(radiateurs retirés\)/.test(await card.locator('ul[aria-label="Radiateurs arrêtés"]').innerText()), `${name} : la Chambre enfant n'est pas listée « radiateurs retirés »`);
        await page.screenshot({ path: `${OUT}/expliquer-${BROWSER}-${name}-radiateurs-retires.png`, fullPage: true });
        await go(page, 'accueil');
        check(!/Chambre enfant, hors ligne/.test(await page.locator('.verdict').innerText()), `${name} : alerte toujours là après « arrêté volontairement »`);
        await go(page, 'etat');
        await page.waitForSelector('#devices-card:not([hidden])', { state: 'attached', timeout: 15000 });
        await page.click('#devices-fold > summary');
        const devGone = await page.locator('#devices-card').innerText();
        check(/Radiateur arrêté volontairement : Chambre enfant/.test(devGone) && !/ne répond plus\s+Radiateur \(Chambre enfant\)/.test(devGone), `${name} : État des appareils dit encore la Chambre enfant injoignable (« ${devGone.slice(0, 300)} »)`);
        // the incidents from the declared day on are gone (an older one, 19 Oct., stays: before the date)
        const after = (await page.locator('#view').innerText()).split('\n').filter((l) => /Chambre enfant injoignable/.test(l) && /\bnov\./.test(l));
        check(!after.length, `${name} : incident « Chambre enfant injoignable » après le retrait (« ${after.join(' | ')} »)`);
        await go(page, 'parametres-logement');
        await page.click('#stopped-card [data-stop-remove="r-ch2"]');
        await page.waitForSelector('#stopped-card #stop-room option[value="r-ch2"]', { state: 'attached', timeout: 10000 });
        await go(page, 'accueil');
        check(/Chambre enfant, hors ligne/.test(await page.locator('.verdict').innerText()), `${name} : alerte absente après avoir retiré la Chambre enfant`);
      }
    }
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
console.log(`Expliquer un mois : OK (captures dans ${OUT})`);
