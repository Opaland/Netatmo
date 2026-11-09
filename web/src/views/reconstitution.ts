// S-1.10 (suite): days lost at Intuis, rebuilt apart from the measured data (lazily loaded
// from the "Qualité des données" card). Nothing here changes the records: the rebuilt
// values are only shown as their own series and in their own columns.
import { MONTHS_SHORT } from '../aggregate';
import { ds } from '../app';
import { barChart } from '../charts';
import { rebuildLost, rebuildTotals, suspectDays } from '../reconstitute';
import { activeRooms, esc, fmtKwh, longDate, roomName, series, table } from '../ui';
import { html } from '../trusted';

const monthLabel = (m: string) => `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const kwh = (v: number | null) => (v === null ? '—' : fmtKwh(v));

export function renderReconstitution(zone: HTMLElement) {
  const active = new Set(activeRooms().map((r) => r.id));
  const records = ds!.records.filter((r) => active.has(r.room));
  const opts = { weather: ds!.weather, linky: ds!.linky, estimated: ds!.estimated };
  const rebuilt = rebuildLost(records, opts);
  const suspects = suspectDays(records, opts).sort((a, b) => (a.day < b.day ? 1 : -1));
  const totals = rebuildTotals(records, rebuilt).filter((y) => y.days > 0);
  const method = `<p class="hint muted"><strong>Méthode</strong> : pour un jour perdu, la consommation des pièces concernées est estimée par le
    <strong>compteur Linky</strong> du jour, moins les autres usages du logement (médiane « Linky − Intuis » des jours complets à ±3 semaines),
    moins ce que les autres pièces ont mesuré ce jour-là. Sans Linky, la <strong>signature énergétique</strong> de la saison × la température
    extérieure du jour, au prorata de la part habituelle des pièces (chauffe-eau : sa valeur médiane des jours voisins). Ces valeurs
    <strong>ne sont jamais ajoutées</strong> aux données mesurées : elles restent dans cette carte, en série distincte.</p>`;
  if (!rebuilt.length) {
    zone.innerHTML = html`${method}<p class="notice">Aucun jour perdu ne peut être reconstitué : il faut Linky ou la météo ces jours-là.</p>${suspectsBlock(suspects)}`;
    return;
  }
  // Monthly chart over the months that have rebuilt days.
  const months = [...new Set(rebuilt.map((r) => r.day.slice(0, 7)))].sort();
  const measured = new Map<string, number>();
  const rebuiltM = new Map<string, number>();
  for (const r of records) {
    const m = r.day.slice(0, 7);
    if (months.includes(m)) measured.set(m, (measured.get(m) ?? 0) + r.kwh);
  }
  for (const r of rebuilt) rebuiltM.set(r.day.slice(0, 7), (rebuiltM.get(r.day.slice(0, 7)) ?? 0) + r.kwh);
  const round = (v: number | undefined) => Math.round((v ?? 0) * 10) / 10;
  zone.innerHTML = html`${method}
    <h3 class="sub">Totaux par année</h3>
    ${table(
      ['Année', 'Mesuré', 'Reconstitué (à part)', 'Mesuré + reconstitué', 'Jours (Linky / signature)'],
      totals.map((y) => [y.year, fmtKwh(y.measured), fmtKwh(y.rebuilt), fmtKwh(y.measured + y.rebuilt), `${y.days} (${y.linky} / ${y.signature})`]),
    )}
    <div class="chart" id="recon-chart" role="img" aria-label="Consommation mesurée et reconstituée, par mois"></div>
    <details class="table-details"><summary>Voir les ${rebuilt.length} jour${rebuilt.length > 1 ? 's' : ''} reconstitué${rebuilt.length > 1 ? 's' : ''}</summary>
    ${table(
      ['Jour', 'Pièces perdues', 'Reconstitué', 'Méthode', 'Selon Linky', 'Selon la signature'],
      rebuilt
        .slice()
        .reverse()
        .map((r) => [
          longDate(r.day),
          esc(r.rooms.map((id) => roomName(id)).join(', ')),
          fmtKwh(r.kwh),
          r.method === 'linky' ? 'Linky' : 'Signature',
          kwh(r.linky),
          kwh(r.signature),
        ]),
      2,
    )}</details>
    ${suspectsBlock(suspects)}`;
  barChart(document.getElementById('recon-chart')!, {
    labels: months.map(monthLabel),
    series: [
      { name: 'Mesuré', color: series(0), data: months.map((m) => round(measured.get(m))) },
      { name: 'Reconstitué', color: series(3), data: months.map((m) => round(rebuiltM.get(m))) },
    ],
    stacked: true,
    price: null,
  });
}

function suspectsBlock(list: ReturnType<typeof suspectDays>) {
  if (!list.length) return '';
  return `<h3 class="sub">Jours suspects <small class="muted">${list.length}</small></h3>
    <p class="hint muted">Jours mesurés, mais où le chauffage est très en dessous de ce qu'annonce la signature par temps froid${
      ds!.linky.size ? ', alors que le compteur Linky indique davantage' : ''
    } : la valeur Intuis est probablement incomplète. Ils restent dans les totaux (ce sont des mesures) mais ne sont pas reconstitués.</p>
    ${table(
      ['Jour', 'Chauffage mesuré', 'Attendu (signature)', 'Intuis selon Linky'],
      list.slice(0, 20).map((s) => [longDate(s.day), fmtKwh(s.kwh), fmtKwh(s.expected), s.linky === null ? '—' : `${fmtKwh(s.linky)} (mesuré ${fmtKwh(s.recorded)})`]),
    )}`;
}
