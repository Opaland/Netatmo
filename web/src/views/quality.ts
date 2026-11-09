// S-1.10: data quality per month. Days estimated from a monthly total (Intuis kept the
// month but lost the days) vs days lost at Intuis (neither the day nor the month).
import { type DayRecord, type Granularity, MONTHS_LONG, minusYears } from '../aggregate';
import { app, ds, onDatasetLoaded, state } from '../app';
import { type Coverage, computeCoverage, gapMonths, uncertainDays } from '../checks';
import { bucketMarks, countIn, shortDate, uncertainText } from '../periods';
import { activeRooms, esc, lastDay, roomName, table } from '../ui';
import { html } from '../trusted';
import { lsKey } from '../scope';
import { lazyCard } from '../lazy';

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
  void lazyCard(() => import('./reconstitution'), (m) => zone.isConnected && m.renderReconstitution(zone), { zone, what: 'Reconstitution' });
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
    <p class="hint muted"><strong>Estimé</strong> : Intuis a gardé le total du mois mais perdu le détail de certains jours ; la collecte répartit l'écart sur ces jours. <strong>Perdu chez Intuis</strong> : ni le jour ni le total du mois ne sont disponibles ; la consommation de ces jours manque dans les totaux, qui ne contiennent que des valeurs mesurées. Sur les graphiques, les barres qui contiennent de tels jours sont plus pâles à toutes les granularités (jour, semaine, mois, an), et leur infobulle donne le nombre de jours ; les évolutions par rapport à l'année précédente le signalent.</p>
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

/** #297: the estimated or lost days behind a « vs N-1 » of [from, to] (HTML, empty when there are none). */
export function yoyGapNote(records: DayRecord[], from: string, to: string): string {
  const pf = minusYears(from);
  const pt = minusYears(to);
  const days = uncertainDays(records, ds!.estimated, pf, to);
  const now = countIn(days, from, to);
  const before = countIn(days, pf, pt);
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? pf);
  const parts = [
    ...(first > pf && first <= pt ? [`N-1 incomplète : collecte depuis le ${shortDate(first, true)}`] : []),
    ...(now ? [`${from.slice(0, 4)} : ${uncertainText(now)}`] : []),
    ...(before ? [`N-1 : ${uncertainText(before)}`] : []),
  ];
  return parts.length ? `<br><small class="muted">${esc(parts.join(' · '))}</small>` : '';
}

/**
 * #297: what a bar chart over [from, to] must say about its buckets: paler when they hold
 * estimated or lost days, hatched when the period or the data covers them only in part
 * (first and last bucket of a sliding period, first data year, current month), and a
 * tooltip note with the days (« 22 jours sur 30 », « 18 jours estimés ou manquants »).
 */
export function chartMarks(records: DayRecord[], keys: string[], from: string, to: string, g: Granularity = state.gran) {
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? from);
  const lo = first > from ? first : from;
  const hi = lastDay() < to ? lastDay() : to;
  const marks = bucketMarks(keys, g, lo, hi, uncertainDays(records, ds!.estimated, lo, hi));
  return {
    muted: marks.some((m) => m.uncertain) ? marks.map((m) => m.uncertain > 0) : undefined,
    partial: marks.some((m) => m.partial) ? marks.map((m) => m.partial) : undefined,
    notes: marks.some((m) => m.note) ? marks.map((m) => m.note) : undefined,
  };
}
