// S-1.10: data quality per month. Days estimated from a monthly total (Intuis kept the
// month but lost the days) vs days lost at Intuis (neither the day nor the month).
import { type DayRecord, MONTHS_LONG, bucketKey } from '../aggregate';
import { app, ds, onDatasetLoaded, state } from '../app';
import { type Coverage, computeCoverage, gapMonths, uncertainDays } from '../checks';
import { activeRooms, esc, lastDay, roomName, table } from '../ui';
import { html } from '../trusted';
import { lsKey } from '../scope';

let cached: Coverage | null = null;
onDatasetLoaded(() => {
  cached = null;
});

/** Coverage written by the collector, or computed here for older archives. */
export function coverage(): Coverage {
  cached ??= ds!.coverage ?? computeCoverage(ds!.records, ds!.estimated, lastDay());
  return cached;
}

export { uncertainDays };

// S-1.10: rebuilding lost days is opt-in (remembered on this device) and lazily loaded.
const RECON_KEY = lsKey('recon');
let reconOn = (() => {
  try {
    return localStorage.getItem(RECON_KEY) === '1';
  } catch {
    return false;
  }
})();
app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.recon === undefined) return;
  reconOn = t.checked;
  try {
    localStorage.setItem(RECON_KEY, reconOn ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  drawReconstitution();
});

/** Fills (or empties) the rebuilt-days zone of the quality card. */
export function drawReconstitution() {
  const zone = document.getElementById('recon-zone');
  if (!zone) return;
  if (!reconOn) return void (zone.innerHTML = html(''));
  zone.innerHTML = html('<p class="hint muted">Reconstitution en cours…</p>');
  import('./reconstitution')
    .then((m) => zone.isConnected && m.renderReconstitution(zone))
    .catch(() => (zone.innerHTML = html('<p class="hint muted">Reconstitution indisponible.</p>')));
}

// The "N jours estimés" link of the period total opens the card.
app.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest('a[href="#quality"]');
  const card = document.getElementById('quality') as HTMLDetailsElement | null;
  if (!link || !card) return;
  e.preventDefault();
  card.open = true;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const monthLabel = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Collapsible card under the main chart; empty when every month is complete. */
export function qualityCard(): string {
  const rooms = new Set(activeRooms().map((r) => r.id));
  const gaps = gapMonths(coverage(), rooms);
  if (!gaps.length) return '';
  const years = [...new Set(gaps.map((g) => g.month.slice(0, 4)))].sort();
  const lost = gaps.some((g) => g.missing > 0);
  // The card is inserted by the caller in this same task: draw once it is in the page.
  if (lost && reconOn) queueMicrotask(drawReconstitution);
  return `<details class="card quality" id="quality">
    <summary><strong>Qualité des données</strong> · ${gaps.length} mois incomplet${gaps.length > 1 ? 's' : ''} (${years.join(', ')})</summary>
    <p class="hint muted"><strong>Estimé</strong> : Intuis a gardé le total du mois mais perdu le détail de certains jours ; la collecte répartit l'écart sur ces jours. <strong>Perdu chez Intuis</strong> : ni le jour ni le total du mois ne sont disponibles ; la consommation de ces jours manque dans les totaux, qui ne contiennent que des valeurs mesurées. Sur les graphiques par jour et par semaine, les barres concernées sont plus pâles.</p>
    ${table(
      ['Mois', 'Jours estimés', 'Jours perdus chez Intuis', 'Pièces concernées'],
      gaps.map((g) => [
        monthLabel(g.month),
        g.estimated || '—',
        g.missing || '—',
        esc(
          g.rooms
            .map((r) => roomName(r))
            .sort()
            .join(', '),
        ),
      ]),
    )}
    ${
      lost
        ? `<label class="toggle"><input type="checkbox" data-recon ${reconOn ? 'checked' : ''}> Reconstituer les jours perdus (à part, depuis Linky et la signature)</label>
    <div id="recon-zone"></div>`
        : ''
    }
  </details>`;
}

/** Per chart bucket (day or week): does it contain an estimated or lost day? */
export function uncertainBuckets(records: DayRecord[], keys: string[], from: string, to: string): boolean[] | undefined {
  if (state.gran !== 'day' && state.gran !== 'week') return undefined;
  const days = uncertainDays(records, ds!.estimated, from, to);
  if (!days.size) return undefined;
  const flagged = new Set([...days].map((d) => bucketKey(d, state.gran)));
  return keys.map((k) => flagged.has(k));
}
