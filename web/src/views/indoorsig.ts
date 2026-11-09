// S-3.7: energy signature on the indoor − outdoor difference, with 95 % intervals, next to
// the outdoor-only signature. Lazily loaded under the "Signature énergétique" card.
import type { DayRecord } from '../aggregate';
import { ds, state } from '../app';
import { scatterChart } from '../charts';
import { effectiveMapping } from '../comfort';
import { type CiFit, MIN_DAYS, indoorModule, seasonSignatures, signatureDays } from '../indoorsig';
import { activeRooms, esc, lastDay, table, measureColor } from '../ui';
import { uncertainDays } from './quality';
import { html } from '../trusted';
import { fmt1 as n1 } from '../glossary';

const n2 = (v: number) => v.toFixed(2).replace('.', ',').replace('-', '−');
const pm = (v: number, ci: [number, number], f: (x: number) => string) => `${f(v)} <small class="muted">[${f(ci[0])} ; ${f(ci[1])}]</small>`;

function cells(f: CiFit | null, sign: 1 | -1, days: number): string[] {
  if (!f) return [`<span class="muted">données insuffisantes (${days} j, ${MIN_DAYS} requis)</span>`, '—'];
  const slope = pm(sign * f.slope, sign === 1 ? f.slopeCi : [-f.slopeCi[1], -f.slopeCi[0]], n2);
  const thr = f.threshold !== null && f.thresholdCi ? pm(f.threshold, f.thresholdCi, n1) + ' °C' : '—';
  return [slope, thr];
}

export function renderIndoorSignature(card: HTMLElement, records: DayRecord[]) {
  const st = ds!.station;
  if (!st) return card.remove();
  const heating = activeRooms().filter((r) => r.category === 'heating');
  const mapping = effectiveMapping(heating, st.modules, state.roomModuleMap);
  const indoor = indoorModule(st, mapping, records);
  if (!indoor) return card.remove();
  const exclude = uncertainDays(ds!.records, ds!.estimated, '0000-01-01', lastDay());
  const sigs = seasonSignatures(signatureDays(records, ds!.weather, st, indoor, exclude)).slice(-3);
  const withDelta = sigs.filter((s) => s.delta);
  const latest = withDelta[withDelta.length - 1];
  const name = esc(st.modules[indoor].name);
  card.hidden = false;
  card.innerHTML = html`<div class="card-head"><h2>Signature intérieur − extérieur <small class="muted">${name} − dehors</small></h2></div>
    <p class="hint muted">Même nuage de jours, mais selon l'<strong>écart</strong> entre ${name} (station Netatmo) et l'extérieur. La <strong>pente</strong>
    (kWh par degré d'écart) mesure les pertes du logement (isolation, renouvellement d'air), quel que soit le réglage du thermostat ;
    le <strong>seuil</strong> est l'écart couvert par les apports gratuits (soleil, occupants, appareils) : en dessous, pas de chauffage.
    Entre crochets, l'intervalle de confiance à 95 %. Les jours perdus ou estimés sont exclus.</p>
    ${
      latest
        ? `<div class="chart tall" id="indoor-sig-chart" role="img" aria-label="Chauffage selon l'écart intérieur − extérieur"></div>`
        : `<p class="notice">Données insuffisantes : il faut au moins ${MIN_DAYS} jours de chauffage avec la température de ${name} et de l'extérieur dans une saison.</p>`
    }
    ${table(
      ['Saison', 'Pente extérieure (kWh par °C en moins)', 'Plus de chauffe au-dessus de', 'Pente sur l\'écart (kWh par °C d\'écart)', 'Chauffe au-delà d\'un écart de', 'Jours'],
      sigs
        .slice()
        .reverse()
        .map((s) => [esc(s.season.replace('-', '–')), ...cells(s.outdoor, -1, s.days), ...cells(s.delta, 1, s.deltaDays), s.deltaDays]),
    )}`;
  if (!latest) return;
  const pts = signatureDays(records, ds!.weather, st, indoor, exclude)
    .get(latest.season)!
    .filter((p) => p.tIn !== null)
    .map((p) => [Math.round((p.tIn! - p.tOut) * 10) / 10, Math.round(p.kwh * 10) / 10, p.day] as [number, number, string]);
  const xs = pts.map((p) => p[0]);
  const f = latest.delta!;
  scatterChart(document.getElementById('indoor-sig-chart')!, {
    xName: `Écart ${st.modules[indoor].name} − extérieur (°C)`,
    yName: 'kWh / jour',
    series: [
      {
        name: latest.season.replace('-', '–'),
        color: measureColor(),
        points: pts,
        fit: { slope: f.slope, intercept: f.intercept, from: Math.max(Math.min(...xs), f.threshold ?? Math.min(...xs)), to: Math.max(...xs) },
      },
    ],
  });
}
