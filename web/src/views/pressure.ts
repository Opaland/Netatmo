// S-11.4 (#220): « Pression et bruit du séjour » in Air et confort: the last 7 days of the main
// module of the station, next to the outdoor temperature. Sober: one sentence and one table.
import type { Station, Dataset } from '../data';
import { dayShort, fmt1 } from '../glossary';
import { NOISY_DB, type PressureSummary, STABLE_HPA, pressureSummary, trendOf } from '../pressure';
import { esc, nf0, table } from '../ui';
import { howDetails } from '../components';

const hpa = (v: number | null) => (v === null ? '—' : `${nf0.format(Math.round(v))} hPa`);
const signedHpa = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt1(Math.abs(v))}`;

function trendText(t: number | null): string {
  const k = trendOf(t);
  if (k === null || t === null) return '—';
  return k === 'up' ? `en hausse (${signedHpa(t)})` : k === 'down' ? `en baisse (${signedHpa(t)})` : 'stable';
}

function sentence(s: PressureSummary): string {
  const today = s.rows.find((r) => r.pressure !== null);
  const parts: string[] = [];
  if (today) {
    const k = trendOf(today.trend);
    parts.push(
      `Pression le ${dayShort(today.day)} : ${hpa(today.pressure)}${k === 'up' ? ', en hausse : temps plus sec et souvent plus froid la nuit (anticyclone)' : k === 'down' ? ', en baisse : temps plus doux et humide, souvent venteux (dépression)' : ''}${s.mean !== null ? ` ; ${hpa(s.mean)} en moyenne sur 30 jours` : ''}.`,
    );
  }
  if (s.hasNoise) {
    parts.push(
      s.meanLoud !== null
        ? `Séjour : ${fmt1(s.meanLoud)} heure${s.meanLoud >= 2 ? 's' : ''} bruyante${s.meanLoud >= 2 ? 's' : ''} par jour en moyenne (30 derniers jours).`
        : 'Séjour : pas encore de journée de bruit relevée en entier.',
    );
  }
  return parts.join(' ');
}

export function pressureCard(st: Station | null, d: Pick<Dataset, 'weather'>, last: string): string {
  const s = pressureSummary(st, d.weather, last);
  if (!s) return '';
  const head = ['Jour', 'Dehors (moyenne)', 'Pression', 'Sur 24 h', ...(s.hasNoise ? ['Heures bruyantes'] : [])];
  const rows = s.rows.map((r) => [
    esc(dayShort(r.day)),
    r.outdoor === null ? '—' : `${fmt1(r.outdoor)}\u00a0°C`,
    hpa(r.pressure),
    trendText(r.trend),
    ...(s.hasNoise ? [r.loud === null ? '—' : `${r.loud} h${r.noiseHours !== null && r.noiseHours < 20 ? ' <small class="muted">(journée incomplète)</small>' : ''}`] : []),
  ]);
  return `<section class="card" id="pressure-card" aria-labelledby="pressure-title">
    <div class="card-head"><h2 id="pressure-title">Pression${s.hasNoise ? ' et bruit' : ''} <small class="muted">module principal de la station, 7 derniers jours</small></h2></div>
    <p>${esc(sentence(s))}</p>
    ${table(head, rows)}
    ${howDetails(
      'Comment c’est mesuré',
      `<p class="hint muted">Pression moyenne du jour, ramenée au niveau de la mer ; « stable » à moins de ${STABLE_HPA} hPa d’écart avec la veille.${
        s.hasNoise
          ? ` Bruit : seulement le nombre d’heures par jour où le bruit moyen du séjour dépasse ${NOISY_DB} dB (conversation animée, télévision forte), jamais l’heure ; activé par le foyer (variable STATION_NOISE).`
          : ''
      }</p>`,
    )}
  </section>`;
}
