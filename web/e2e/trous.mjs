// v2.4 #570: the screens face the gaps of a real account, in shape (fixture « trous-reels »,
// collector/fixtures.py: the water heater without any reading from Sept. 2023 to Jan. 2025, every
// room lost 41 days then 5 days while Linky counted them, a radiator added in Oct. 2025, a room
// stopped on purpose since July 2025). A missing measure is never drawn nor counted as 0, a total
// that holds missing days says « incomplet », and no comparison makes a rise of a gap.
// Run after `npm run build`: node e2e/trous.mjs   (port E2E_PORT; the fixture is made if absent)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { frames, goto, openDemo, ready, startPreview } from './lib.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = 'trous-reels';
if (!existsSync(join(WEB, 'dist/demo-fixtures', FIXTURE, 'meta.enc.json'))) {
  execFileSync('python3', ['-m', 'collector', 'fixtures', '-o', join(WEB, 'dist/demo-fixtures'), FIXTURE], { cwd: join(WEB, '..'), stdio: 'inherit' });
}
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const { base, stop } = await startPreview(Number(process.env.E2E_PORT ?? 4197));
const browser = await (process.env.E2E_BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => m.type() === 'error' && errors.push(`console : ${m.text()}`));
const text = (css = '#view') => page.locator(css).first().innerText();
const pick = async (css, value) => {
  await page.selectOption(css, value);
  await frames(page);
  await ready(page);
};
const openValues = () => page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => (d.open = true)));

try {
  await openDemo(page, base, FIXTURE);

  // Année par année: the water heater of 2024 is « non mesuré », the change of 2025 leaves it out
  await goto(page, 'historique-annees');
  const row = (y) =>
    page.evaluate((y) => {
      const tr = [...document.querySelectorAll('#years-card table')[0].querySelectorAll('tbody tr')].find((r) => r.cells[0].textContent.trim().startsWith(String(y)));
      return tr ? [...tr.cells].map((c) => c.textContent.trim()) : [];
    }, y);
  const y24 = await row(2024);
  check(y24[3]?.trim() === 'non mesuré', `Année par année : chauffe-eau 2024 « ${y24[3]} », attendu « non mesuré »`);
  check(/incomplet/.test(y24[1]), `Année par année : total 2024 sans « incomplet » (${y24[1]})`);
  const y25 = await row(2025);
  check(!/\+4\d\s?%/.test(y25.at(-1)), `Année par année : évolution 2025 « ${y25.at(-1)} » (la hausse d'un chauffe-eau non mesuré)`);
  const years = await text('#years-card');
  check(/Évolution de 2025 : hors Bureau et Chauffe-eau, sans relevé sur l’une des deux périodes/.test(years), 'Année par année : 2025 ne nomme pas ce qui est laissé hors de l’évolution');
  check(/Total de 2024 incomplet : 366 jours manquants/.test(years), 'Année par année : le total 2024 ne dit pas ses jours manquants');

  // Rapport annuel 2025 and 2024
  await goto(page, 'rapport');
  await pick('select[data-set="reportYear"]', '2025');
  const r25 = await text();
  check(!/\+4\d\s?% vs 2024/.test(r25), 'Rapport 2025 : hausse « vs 2024 » d’un chauffe-eau non mesuré');
  check(/Chauffe-eau\t1\s?\d{3}\tnon mesuré\t—/.test(r25), 'Rapport 2025 : la ligne Chauffe-eau ne dit pas « non mesuré » pour 2024');
  check(!/\t0\t—|\t0\t−100\s?%/.test(r25), 'Rapport 2025 : une pièce à 0 kWh pour une année sans relevé');
  await pick('select[data-set="reportYear"]', '2024');
  const r24 = await text();
  check(/chauffe-eau non mesuré en 2024/.test(r24), 'Rapport 2024 : « 100 % / 0 % » au lieu de « chauffe-eau non mesuré »');
  check(!/−100\s?%/.test(r24), 'Rapport 2024 : −100 % pour le chauffe-eau non mesuré');

  // Accueil: the Novembers without the water heater are no reference of the verdict
  await goto(page, 'accueil');
  const home = await page.evaluate(() => document.querySelector('.verdict')?.textContent ?? '');
  check(/écartée/.test(home), 'Accueil : le verdict ne dit pas les années écartées (sans chauffe-eau ni Bureau)');

  // Historique, every month: no 0 for the water heater of 2024, « incomplet » by a month with gaps
  await goto(page, 'historique');
  await pick('select[data-set="period"]', 'all');
  await openValues();
  const table = await text('#main-table');
  const line = (label) => table.split('\n').find((l) => l.startsWith(label)) ?? '';
  check(/^juin 2024\t[\d\s]+\t—\t/.test(line('juin 2024')), `Historique : eau chaude de juin 2024 « ${line('juin 2024')} », attendu « — »`);
  check(/incomplet/.test(line('sept. 2023')), `Historique : septembre 2023 (28 jours perdus) sans « incomplet » : ${line('sept. 2023')}`);
  check(!/incomplet/.test(line('juin 2023')), `Historique : juin 2023 (complet) marqué « incomplet »`);

  // Hiver contre hiver: the days missing of each winter are said under the change
  const winter = await text('.season-tiles + p');
  check(/2024–2025 : \d+ jours estimés ou manquants/.test(winter), `Hiver contre hiver : les manques de 2024–2025 ne sont pas dits (${winter})`);

  // Expliquer janvier 2025: no « Eau chaude » part, the water heater's run said with its own end
  await goto(page, 'outils-expliquer');
  await pick('select[data-explain-month]', '2025-01');
  const ex = await text();
  check(!/^Eau chaude\t/m.test(ex), 'Expliquer janvier 2025 : une part « Eau chaude » pour un chauffe-eau sans relevé en janvier 2024');
  check(/Chauffe-eau : hors ligne du 14 oct\. 2023 au 4 janv\. 2025/.test(ex), 'Expliquer janvier 2025 : le chauffe-eau n’est pas dit avec la fin de son trou');
  check(!/Salon : hors ligne/.test(ex), 'Expliquer janvier 2025 : un trou de novembre 2024 (entre les deux mois) est cité');

  // Pièce Chauffe-eau, sur l'année: the days missing a year earlier are said by the amounts
  await goto(page, 'piece-r-ce');
  await page.getByRole('radio', { name: 'Année' }).first().click();
  await frames(page);
  await ready(page);
  const ce = await text('#piece-conso');
  check(/2025 : \d+ jours manquants/.test(ce), `Pièce Chauffe-eau : les jours manquants de 2025 ne sont pas dits (${ce.split('\n').slice(0, 4).join(' / ')})`);
} catch (err) {
  errors.push(`trous : ${err.stack ?? err}`);
} finally {
  await browser.close();
  stop();
}
if (errors.length) {
  console.error(`${errors.length} problème(s) :\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Trous réels (#570) : OK');
