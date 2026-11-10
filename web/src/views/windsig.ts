// S-3.12 (#221): « Le vent et la pluie », under the signature of the home (Historique). The
// numbers come from windsig.ts; an effect whose 95 % interval contains 0 is written « pas
// d'effet mesurable », never as a number that would read as real.
import type { SigPoint } from '../indoorsig';
import { MIN_DAYS } from '../indoorsig';
import { fmt1 } from '../glossary';
import { esc, table } from '../ui';
import { type Effect, type WindSignature, windSignatures } from '../windsig';
import { PROVISIONAL_DAYS, seasonName } from './analyse';

const pct = (v: number) => `${fmt1(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt1(Math.abs(v))}`;
const range = (c: [number, number], k: number) => `entre ${signed(c[0] * k)} et ${signed(c[1] * k)}`;

/** Table cell of an effect, per `k` units (10 km/h, 10 mm). */
function cell(e: Effect, k: number): string {
  if (!e.real) return `<span class="muted">pas d’effet mesurable</span> <small class="muted">(${range(e.ci, k)})</small>`;
  // less heating with more wind or rain: not a physical effect, most likely chance or something else
  if (e.slope < 0) return `<span class="muted">effet inattendu, sans doute le hasard</span> <small class="muted">(${range(e.ci, k)})</small>`;
  return `${signed(e.slope * k)} kWh <small class="muted">(${range(e.ci, k)})</small>`;
}

/** The sentence of the latest season. */
export function windSentence(w: WindSignature, current: number): string {
  const name = seasonName(w.season, w.n, current);
  if (!w.wind.real) return `${name} : le vent n’a pas d’effet mesurable sur votre chauffage (${w.n} jours de chauffe) ; il n’est donc pas compté.`;
  if (w.wind.slope < 0) {
    return `${name} : un peu moins de chauffage les jours venteux, à froid égal (${signed(10 * w.wind.slope)} kWh par jour pour 10 km/h). Effet inattendu : il tient sans doute à autre chose (soleil, absences), à prendre avec prudence.`;
  }
  const [lo, hi] = w.windRange;
  return `${name} : à température égale, 10 km/h de vent en plus demandent environ ${fmt1(10 * w.wind.slope)} kWh de chauffage par jour (${range(w.wind.ci, 10)}). Un jour venteux (${Math.round(hi)} km/h) coûte ainsi ≈ ${fmt1(w.wind.slope * (hi - lo))} kWh de plus qu’un jour calme (${Math.round(lo)} km/h). Le vent explique ${pct(w.gain)} de ce que le froid seul n’expliquait pas.`;
}

export function windBlock(days: Map<string, SigPoint[]>, wind: Map<string, [number, number | null]> | undefined, rain: Map<string, number> | undefined, current: number): string {
  if (!wind?.size) return '';
  const sigs = windSignatures(days, wind, rain).slice(-3);
  const head = '<h3 class="sub-title" id="sig-wind-title">Le vent et la pluie <small class="muted">à froid égal</small></h3>';
  if (!sigs.length) return `<div id="sig-wind">${head}<p class="hint muted">Pas encore assez de jours de chauffe avec le vent connu (${MIN_DAYS} par saison).</p></div>`;
  // the sentence: the latest season with enough days to be read (a season just started is noisy)
  const last = [...sigs].reverse().find((w) => w.n >= PROVISIONAL_DAYS) ?? sigs[sigs.length - 1];
  const rainLine = last.rain
    ? last.rain.real && last.rain.slope > 0
      ? `La pluie aussi : ${fmt1(10 * last.rain.slope)} kWh de plus par jour pour 10 mm (${range(last.rain.ci, 10)}).`
      : last.rain.real
        ? 'La pluie : effet inattendu (moins de chauffage les jours de pluie), sans doute le hasard ; il n’est pas compté.'
        : 'La pluie : pas d’effet mesurable.'
    : '';
  return `<div id="sig-wind" aria-labelledby="sig-wind-title">${head}
    <p>${esc(windSentence(last, current))}${rainLine ? ` ${esc(rainLine)}` : ''}</p>
    ${table(
      ['Saison', 'Jours', 'Part expliquée par le froid seul', 'Avec le vent', 'Vent : par jour, pour 10 km/h de plus', 'Pluie : par jour, pour 10 mm'],
      sigs
        .slice()
        .reverse()
        .map((w) => [esc(seasonName(w.season, w.n, current)), w.n, pct(w.r2Before), pct(w.r2After), cell(w.wind, 10), w.rain ? cell(w.rain, 10) : '—']),
    )}
    <details class="table-details"><summary>Comment c’est calculé</summary>
      <p class="hint muted">Sur les jours de chauffe de chaque saison (moins de 15 °C dehors, jours perdus ou estimés exclus), on ajuste la consommation de chauffage aux degrés-jours (base 18 °C), puis aux degrés-jours et au vent moyen du jour (Open-Meteo, à 10 m), puis en ajoutant la pluie du jour : régression linéaire sur les mêmes jours (coefficient de détermination R² avant et après). « Explique X % de ce que le froid seul n’expliquait pas » = (R² avec le vent − R² sans) ÷ (1 − R² sans). Entre parenthèses, l’intervalle de confiance à 95 % : quand il contient 0, l’effet n’est pas distinguable du hasard et l’appli écrit « pas d’effet mesurable ».</p>
    </details>
  </div>`;
}
