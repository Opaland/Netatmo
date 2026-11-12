// #127: « Repère en kWh/m²/an, pas un DPE » in the annual report, loaded on demand (report.ts):
// heating (electricity + the stove's wood, the rule of the kWh/m² under « Chauffage selon le
// froid ») and hot water of the 12 months ending with the report, over the surfaces entered in
// ⚙ Mon logement, against the thresholds of the DPE energy label (isolation.ts dpeMark). Hidden
// without any surface.
import { addDays, minusYears } from '../aggregate';
import { activeRooms, ds } from '../app';
import { DAYS_OF_A_YEAR, DPE_CLASSES, DPE_ENERGY_GRID, ELEC_PRIMARY, dpeMark } from '../isolation';
import { localDay } from '../glossary';
import { displaySurfaces } from '../household';
import { html } from '../trusted';
import { esc, longDate, nf0 } from '../ui';
import { howDetails } from '../components';
import { loadWorks } from './works';
import { stoveRooms, verdictWood } from './wood-state';

const f1 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** #518: the thresholds of the energy label as a list (« A : 70 ou moins » … « G : plus de 420 »). */
export const dpeGridItems = (): string[] => [
  ...DPE_CLASSES.slice(0, -1).map((c, i) => `${c} : ${DPE_ENERGY_GRID[i]} ou moins`),
  `${DPE_CLASSES[DPE_CLASSES.length - 1]} : plus de ${DPE_ENERGY_GRID[DPE_ENERGY_GRID.length - 1]}`,
];

/** « 2,3 avant 2026, 1,9 à partir de 2026, 1,7 à partir de 2027 ». */
const factorsText = () =>
  ELEC_PRIMARY.map(([from, v], i) => `${f1(v)}${i ? ` à partir du ${longDate(from)}` : ` jusqu’au ${longDate(addDays(ELEC_PRIMARY[1][0], -1))}`}`).join(', ');

/** The section's HTML for a report ending on `end`, or '' without any surface (hidden). */
export async function dpeHtml(end: string): Promise<string> {
  const d = ds!;
  const works = await loadWorks();
  if (ds !== d) return '';
  const from = addDays(minusYears(end), 1);
  const rooms = activeRooms();
  const heating = rooms.filter((r) => r.category === 'heating').map((r) => r.id);
  const water = rooms.filter((r) => r.category === 'water_heater').map((r) => r.id);
  const stove = stoveRooms().map((id) => d.roomMap?.get(id) ?? id);
  const today = localDay();
  const m = dpeMark(d.records, displaySurfaces(d, works.surfaces), heating, water, stove, verdictWood('all', null), from, end, today);
  if (!m) return '';
  const head = '<h3 id="dpe-title">Repère en kWh/m²/an, pas un DPE</h3>';
  const wrap = (body: string) => `<section id="report-dpe" aria-labelledby="dpe-title">${head}${body}</section>`;
  const first = d.records.reduce((a, r) => (r.day < a ? r.day : a), end);
  if (first > addDays(end, -DAYS_OF_A_YEAR)) return wrap(`<p class="hint muted">Moins d’un an de données avant le ${esc(longDate(end))} : pas de repère.</p>`);
  const what = `chauffage${m.wood ? ', électricité + bois,' : ''} et eau chaude, du ${longDate(from)} au ${longDate(end)}, sur ${nf0.format(m.m2)} m²`;
  const figures = `<p id="dpe-figure">Mesuré : <strong>${nf0.format(Math.round(m.finalPerM2))} kWh/m²</strong> d’énergie finale (${esc(what)}), soit ≈ <strong>${nf0.format(Math.round(m.primaryPerM2))} kWh/m²</strong> d’énergie primaire${
    m.cls ? ` : <strong>classe ${m.cls}</strong> à titre indicatif.` : '.'
  }</p>`;
  const partial = m.cls ? '' : `<p class="hint muted">Pas de classe : ${m.known} pièce${m.known > 1 ? 's' : ''} chauffée${m.known > 1 ? 's' : ''} sur ${m.rooms} ont leur surface ; l’eau chaude de tout le logement sur une partie de sa surface paraîtrait trop haute. Complétez les surfaces dans <a class="link" href="#parametres-logement">⚙ Mon logement</a>.</p>`;
  // #518: the figure and the class on screen; why it is not a DPE, the dated factors and the grid folded
  const why = howDetails(
    'Comment c’est calculé',
    `<p class="hint muted">Pas un DPE : le diagnostic calcule une consommation <em>conventionnelle</em> (climat du département, 19 °C, occupation type), compte aussi l’éclairage, les auxiliaires et le refroidissement, rapporte tout à la surface habitable (ici, celle des pièces chauffées saisies), et sa classe est la moins bonne de l’étiquette énergie et de l’étiquette climat (CO₂, non calculée ici).</p>
    <p class="hint muted">Ici, la consommation réellement mesurée, ramenée en énergie primaire comme le DPE : électricité × ${esc(f1(m.factor))} (coefficient en vigueur le ${esc(longDate(today))} ; ${esc(factorsText())}), bois × 1.</p>
    <p class="hint muted" id="dpe-grid-title">Seuils de l’étiquette énergie, en kWh d’énergie primaire par m² et par an (logement de plus de 40 m²) :</p>
    <ul class="hint muted" id="dpe-grid" aria-labelledby="dpe-grid-title">${dpeGridItems()
      .map((t) => `<li>${esc(t)}</li>`)
      .join('')}</ul>`,
  );
  return wrap(figures + partial + why);
}

/** Fill the placeholder of the report (#report-dpe-zone). */
export async function renderDpe(el: HTMLElement | null, end: string) {
  const out = await dpeHtml(end);
  if (el?.isConnected) {
    el.innerHTML = html(out);
    el.hidden = !out;
  }
}
