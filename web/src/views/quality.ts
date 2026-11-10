// S-1.10: data quality per month. Days estimated from a monthly total (Intuis kept the
// month but lost the days) vs days lost at Intuis (neither the day nor the month).
import { type DayRecord, type Granularity, minusYears } from '../aggregate';
import { ds, onDatasetLoaded, state } from '../app';
import type { Handlers } from '../events';
import { type Coverage, computeCoverage, gapMonths, uncertainDays } from '../checks';
import { bucketMarks, countIn, shortDate, uncertainText } from '../periods';
import { activeRooms, esc, lastDay } from '../ui';
import { html } from '../trusted';
import { lsKey } from '../scope';
import { lazyCard } from '../lazy';
import { switchField } from '../components';

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
/** #257: the « reconstituer » switch of the card, dispatched by main.ts (État des données). */
export const qualityHandlers: Handlers = {
  change(t) {
    if (t.dataset.recon === undefined) return false;
    reconOn = (t as HTMLInputElement).checked;
    try {
      localStorage.setItem(RECON_KEY, reconOn ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    drawReconstitution();
    return true;
  },
};

/** Fills (or empties) the rebuilt-days zone of the quality card. */
export function drawReconstitution() {
  const zone = document.getElementById('recon-zone');
  if (!zone) return;
  if (!reconOn) return void (zone.innerHTML = html(''));
  zone.innerHTML = html('<p class="hint muted">Reconstitution en cours…</p>');
  void lazyCard(() => import('./reconstitution'), (m) => zone.isConnected && m.renderReconstitution(zone), { zone, what: 'Reconstitution' });
}

/**
 * #387: the lost days of État des données, folded under one line: the switch that rebuilds them
 * apart (from Linky and the signature). The months and the causes are in « Source par source »
 * just above (one report, not two); empty when Intuis lost no day.
 */
export function qualityCard(open = false): string {
  const rooms = new Set(activeRooms().map((r) => r.id));
  const gaps = gapMonths(coverage(), rooms);
  if (!gaps.some((g) => g.missing > 0)) return '';
  // The card is inserted by the caller in this same task: draw once it is in the page.
  if (reconOn) queueMicrotask(drawReconstitution);
  return `<details class="card fold quality" id="quality"${open || reconOn ? ' open' : ''}>
    <summary><h2>Jours perdus chez Intuis</h2> <span class="fold-sub">les estimer à part</span></summary>
    <p class="hint muted">Ni le jour ni le total du mois ne sont disponibles chez Intuis : les totaux ne contiennent que des valeurs mesurées, et sur les graphiques les barres qui contiennent ces jours sont plus pâles. Une reconstitution à part, depuis le compteur Linky et la signature énergétique, en donne une estimation, sans jamais la mêler aux mesures.</p>
    ${switchField('Reconstituer les jours perdus (à part, depuis Linky et la signature)', reconOn, { 'data-recon': true })}
    <div id="recon-zone"></div>
  </details>`;
}

/** #297: the estimated or lost days behind a « vs l'an dernier » of [from, to] (HTML, empty when there are none). */
export function yoyGapNote(records: DayRecord[], from: string, to: string): string {
  const pf = minusYears(from);
  const pt = minusYears(to);
  const days = uncertainDays(records, ds!.estimated, pf, to);
  const now = countIn(days, from, to);
  const before = countIn(days, pf, pt);
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? pf);
  const parts = [
    ...(first > pf && first <= pt ? [`an dernier incomplet : collecte depuis le ${shortDate(first, true)}`] : []),
    ...(now ? [`${from.slice(0, 4)} : ${uncertainText(now)}`] : []),
    ...(before ? [`${pf.slice(0, 4)} : ${uncertainText(before)}`] : []),
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
