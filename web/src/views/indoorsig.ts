// S-3.7: energy signature on the indoor − outdoor difference, with 95 % intervals, next to
// the outdoor-only signature. Lazily loaded under the "Signature énergétique" card.
import type { DayRecord } from '../aggregate';
import { ds, state } from '../app';
import { scatterChart } from '../charts';
import { effectiveMapping } from '../comfort';
import { MIN_DAYS, indoorModule, seasonSignatures, signatureDays } from '../indoorsig';
import { seasonOf } from '../aggregate';
import { signatureTable } from './analyse';
import { activeRooms, esc, lastDay, measureColor } from '../ui';
import { uncertainDays } from './quality';
import { html } from '../trusted';
import { dayLong, seasonLabel } from '../glossary';
import { alertHtml } from '../components';


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
    Mêmes jours que la signature ci-dessus ; les valeurs sont dans son tableau.</p>
    ${
      latest
        ? `<div class="chart tall" id="indoor-sig-chart" role="img" aria-label="Chauffage selon l'écart intérieur − extérieur"></div>`
        : alertHtml('info', `Données insuffisantes : il faut au moins ${MIN_DAYS} jours de chauffage avec la température de ${name} et de l'extérieur dans une saison.`)
    }
`;
  // #303: one table for both signatures (same days, same fit), under the outdoor chart
  const tbl = document.getElementById('sig-table');
  if (tbl) tbl.innerHTML = html(signatureTable(sigs, Number(seasonOf(lastDay()).slice(0, 4)), true));
  if (!latest) return;
  const pts = signatureDays(records, ds!.weather, st, indoor, exclude)
    .get(latest.season)!
    .filter((p) => p.tIn !== null)
    .map((p) => [Math.round((p.tIn! - p.tOut) * 10) / 10, Math.round(p.kwh * 10) / 10, dayLong(p.day)] as [number, number, string]);
  const xs = pts.map((p) => p[0]);
  const f = latest.delta!;
  scatterChart(document.getElementById('indoor-sig-chart')!, {
    xName: `Écart ${st.modules[indoor].name} − extérieur (°C)`,
    yName: 'kWh / jour',
    slopeUnit: "kWh par °C d'écart",
    series: [
      {
        name: seasonLabel(Number(latest.season.slice(0, 4))),
        color: measureColor(),
        points: pts,
        fit: { slope: f.slope, intercept: f.intercept, from: Math.max(Math.min(...xs), f.threshold ?? Math.min(...xs)), to: Math.max(...xs) },
      },
    ],
  });
}
