// #460: « Isolation, à titre indicatif », under the signature (Historique › Chauffage selon le froid):
// the heat loss in W/°C and the heating kWh/m² of the whole home, electricity + the stove's wood,
// against indicative grids shown as such (isolation.ts). The kWh/m² needs the surfaces entered in
// ⚙ Mon logement (works.ts, loaded on demand): without them, no kWh/m².
import { type DayRecord, addDays, minusYears } from '../aggregate';
import { activeRooms, ds } from '../app';
import { DAYS_OF_A_YEAR, KWH_M2_GRID, W_PER_K_GRID, gradeOf, gridText, homePerM2, wattsPerDegree } from '../isolation';
import type { SeasonSignatures } from '../indoorsig';
import { seasonLabel } from '../glossary';
import { lazyCard } from '../lazy';
import { html } from '../trusted';
import { esc, lastDay, nf0 } from '../ui';
import { stoveRooms } from './wood-state';

/** The latest season with a line and enough days to judge (a provisional one is not judged). */
const judgedSeason = (sigs: SeasonSignatures[], minDays: number) => sigs.filter((s) => s.outdoor && s.days >= minDays).at(-1) ?? null;

/**
 * The block: W/°C of the latest whole-enough season, electricity + wood (`judged`), the
 * electricity alone beside it when the wood counts (`alone`), and the place of the kWh/m².
 */
export function isolationBlock(whole: boolean, judged: SeasonSignatures[], alone: SeasonSignatures[] | null, current: number, minDays: number): string {
  const head = '<h3 class="money-h">Isolation, à titre indicatif</h3>';
  if (!whole) return `${head}<p class="hint muted">L’isolation se juge sur le logement entier : choisissez toutes les pièces pour la voir.</p>`;
  const s = judgedSeason(judged, minDays);
  const label = (season: string) => `hiver ${seasonLabel(Number(season.slice(0, 4)))}${Number(season.slice(0, 4)) >= current ? ', en cours' : ''}`;
  let wk = `<p id="iso-wk" class="hint muted">Pertes en W/°C : il faut une saison d’au moins ${minDays} jours de chauffe.</p>`;
  if (s) {
    // graded on the figure as written (rounded to 5 W/°C), so that « 100 W/°C » is never « très bien »
    const w = Math.round(wattsPerDegree(s.outdoor!.slope) / 5) * 5;
    const a = alone?.find((x) => x.season === s.season)?.outdoor;
    // #499: the words of the grid first (« bien isolé »), the figure and its unit in detail
    wk = `<p id="iso-wk">Logement <strong>${gradeOf(w, W_PER_K_GRID)}</strong>, à titre indicatif (pertes ≈ ${nf0.format(w)} W/°C${alone ? ', électricité + bois' : ''}, ${esc(label(s.season))}).${
      a ? ` <span class="muted">Électricité seule : ${nf0.format(Math.round(wattsPerDegree(a.slope) / 5) * 5)} W/°C.</span>` : ''
    }</p>`;
  }
  return `${head}${wk}<p id="iso-m2" role="status">…</p>
    <p class="hint muted">Repères indicatifs, pas un diagnostic : en W/°C, ${gridText(W_PER_K_GRID)} ; en kWh de chauffage par m² et par an, ${gridText(KWH_M2_GRID)}. Les W/°C viennent de la droite (kWh de plus par jour pour 1 °C de moins dehors, × 1 000 ÷ 24) : un grand logement en perd plus qu’un petit, le kWh/m² le ramène à la surface.</p>`;
}

/** Fill #iso-m2: the heating kWh/m² of the last 12 months, once the surfaces are loaded. */
export function fillPerM2(records: DayRecord[], wood: Map<string, [number, number]> | null, uncertain: number) {
  void lazyCard(
    () => Promise.all([import('./works'), import('../household')]),
    async ([w, h]) => {
      const d = ds!;
      const works = await w.loadWorks();
      const el = document.getElementById('iso-m2');
      if (!el || ds !== d) return;
      const last = lastDay();
      const from = addDays(minusYears(last), 1);
      const heating = activeRooms()
        .filter((r) => r.category === 'heating')
        .map((r) => r.id);
      const stove = stoveRooms().map((id) => d.roomMap?.get(id) ?? id);
      const r = homePerM2(records, h.displaySurfaces(d, works.surfaces), heating, stove, wood, from, last);
      if (!r) {
        el.innerHTML = html`Chauffage par m² : saisissez les surfaces des pièces dans <a class="link" href="#parametres-logement">⚙ Mon logement</a>.`;
        return;
      }
      const first = records.reduce((a, x) => (x.day < a ? x.day : a), last);
      const year = first <= addDays(last, -DAYS_OF_A_YEAR);
      const part = r.known < r.rooms ? ` (${r.known} pièces chauffées sur ${r.rooms} renseignées)` : '';
      const noWood = wood && !r.wood ? ' Bois non compté : la surface de la pièce du poêle n’est pas saisie.' : '';
      const perM2 = Math.round(r.perM2); // graded as written
      el.innerHTML = html(
        `Chauffage des 12 derniers mois ≈ <strong>${nf0.format(perM2)} kWh/m²</strong>${r.wood ? ', électricité + bois' : ''}, sur ${esc(nf0.format(r.m2))} m²${esc(part)}${
          year ? ` : <strong>${gradeOf(perM2, KWH_M2_GRID)}</strong>.` : '. Moins d’un an de données : pas de repère.'
        }${uncertain ? ` <span class="muted">${uncertain} jour${uncertain > 1 ? 's' : ''} estimé${uncertain > 1 ? 's' : ''} ou incomplet${uncertain > 1 ? 's' : ''} y ${uncertain > 1 ? 'sont comptés tels quels' : 'est compté tel quel'}.</span>` : ''}${esc(noWood)}`,
      );
    },
    { zone: 'iso-m2', what: 'Chauffage par m²' },
  );
}
