// S-1.10: data quality per month. Days estimated from a monthly total (Intuis kept the
// month but lost the days) vs days lost at Intuis (neither the day nor the month).
import { type DayRecord, MONTHS_LONG, bucketKey } from '../aggregate';
import { app, ds, onDatasetLoaded, state } from '../app';
import { type Coverage, computeCoverage, gapMonths, uncertainDays } from '../checks';
import { activeRooms, esc, lastDay, roomName, table } from '../ui';

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
  return `<details class="card quality" id="quality">
    <summary><strong>Qualité des données</strong> · ${gaps.length} mois incomplet${gaps.length > 1 ? 's' : ''} (${years.join(', ')})</summary>
    <p class="hint muted"><strong>Estimé</strong> : Intuis a gardé le total du mois mais perdu le détail de certains jours ; la collecte répartit l'écart sur ces jours. <strong>Perdu chez Intuis</strong> : ni le jour ni le total du mois ne sont disponibles, rien n'est reconstitué (la consommation de ces jours manque dans les totaux). Sur les graphiques par jour et par semaine, les barres concernées sont plus pâles.</p>
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
