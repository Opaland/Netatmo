// S-1.10: data quality per month. Days estimated from a monthly total (Intuis kept the
// month but lost the days) vs days lost at Intuis (neither the day nor the month).
import { type DayRecord, type Granularity, MONTHS_LONG, bucketKey, minusYears } from '../aggregate';
import { ds, onDatasetLoaded, rawDataset, state } from '../app';
import type { Dataset } from '../data';
import { CUT_ICON, type CutKind, cutCausesOf } from '../incidents';
import type { Handlers } from '../events';
import { type Coverage, computeCoverage, gapMonths, uncertainDays } from '../checks';
import { bucketMarks, countIn, cutText, shortDate, uncertainText } from '../periods';
import { activeRooms, esc, lastDay, roomName, table } from '../ui';
import { html } from '../trusted';
import { lsKey } from '../scope';
import { lazyCard } from '../lazy';
import { devicesQualityHtml } from './devices-quality';
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

// #394: days touched by a power or Internet cut (journal des incidents), per dataset shown.
const cutMemo = new WeakMap<Dataset, Map<string, CutKind>>();
/** The days touched by a cut, with their probable cause (empty without the devices document). */
export function cutDays(): Map<string, CutKind> {
  const d = ds!;
  let m = cutMemo.get(d);
  if (!m) cutMemo.set(d, (m = cutCausesOf((rawDataset() ?? d).devices)));
  return m;
}
/** The cut days of [from, to], sorted. */
export const cutDaysIn = (from: string, to: string): string[] => [...cutDays().keys()].filter((d) => d >= from && d <= to).sort();

/**
 * #394: days that must not be judged (signature, unusual days, absences, « Expliquer un mois »):
 * the lost or estimated days (S-1.10) and the days touched by a cut — a day at 0 kWh during a
 * power cut is not an « économe » day.
 */
export function judgedOut(records: DayRecord[], from: string, to: string): Set<string> {
  const out = uncertainDays(records, ds!.estimated, from, to);
  for (const d of cutDaysIn(from, to)) out.add(d);
  return out;
}

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

const monthLabel = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** #394: what a screen reader hears of the cut days of a chart (the 6 latest named). */
function cutSummary(days: string[], cuts: Map<string, CutKind>): string {
  const named = days.slice(-6).map((d) => `${shortDate(d)} (${cuts.get(d) === 'power' ? 'courant' : 'Internet'})`);
  return `Jours de coupure, marqués ${CUT_ICON.power} ou ${CUT_ICON.internet} et d’un trait pointillé : ${days.length > 6 ? `${days.length}, dont ` : ''}${named.join(', ')}`;
}

/** Collapsible card under the main chart; empty when every month is complete and no device event is known. */
export function qualityCard(open = false): string {
  const rooms = new Set(activeRooms().map((r) => r.id));
  const gaps = gapMonths(coverage(), rooms);
  const devices = devicesQualityHtml(); // v1.5: firmware, restarts, modules offline, Tempo, Linky index
  if (!gaps.length && !devices) return '';
  const years = [...new Set(gaps.map((g) => g.month.slice(0, 4)))].sort();
  const lost = gaps.some((g) => g.missing > 0);
  // The card is inserted by the caller in this same task: draw once it is in the page.
  if (lost && reconOn) queueMicrotask(drawReconstitution);
  const summary = gaps.length ? `${gaps.length} mois incomplet${gaps.length > 1 ? 's' : ''} (${years.join(', ')})` : 'appareils et compteurs';
  return `<details class="card quality" id="quality"${open ? ' open' : ''}>
    <summary><strong>Qualité des données</strong> · ${summary}</summary>
    ${gaps.length ? gapsHtml(gaps, lost) : ''}
    ${devices}
  </details>`;
}

function gapsHtml(gaps: ReturnType<typeof gapMonths>, lost: boolean): string {
  return `<p class="hint muted"><strong>Estimé</strong> : Intuis a gardé le total du mois mais perdu le détail de certains jours ; la collecte répartit l'écart sur ces jours. <strong>Perdu chez Intuis</strong> : ni le jour ni le total du mois ne sont disponibles ; la consommation de ces jours manque dans les totaux, qui ne contiennent que des valeurs mesurées. Sur les graphiques, les barres qui contiennent de tels jours sont plus pâles à toutes les granularités (jour, semaine, mois, an), et leur infobulle donne le nombre de jours ; les évolutions par rapport à l'année précédente le signalent.</p>
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
        ? `${switchField('Reconstituer les jours perdus (à part, depuis Linky et la signature)', reconOn, { 'data-recon': true })}
    <div id="recon-zone"></div>`
        : ''
    }`;
}

/** #297: the estimated or lost days behind a « vs l'an dernier » of [from, to] (HTML, empty when there are none). */
export function yoyGapNote(records: DayRecord[], from: string, to: string): string {
  const pf = minusYears(from);
  const pt = minusYears(to);
  const days = uncertainDays(records, ds!.estimated, pf, to);
  const now = countIn(days, from, to);
  const before = countIn(days, pf, pt);
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? pf);
  // #394: a cut lowers the consumption of its day without saying anything of the household
  const cuts = cutDays();
  const cutNow = cutText(cutDaysIn(from, to), cuts);
  const cutBefore = cutText(cutDaysIn(pf, pt), cuts);
  const parts = [
    ...(first > pf && first <= pt ? [`an dernier incomplet : collecte depuis le ${shortDate(first, true)}`] : []),
    ...(now ? [`${from.slice(0, 4)} : ${uncertainText(now)}`] : []),
    ...(before ? [`${pf.slice(0, 4)} : ${uncertainText(before)}`] : []),
    ...(cutNow ? [`${from.slice(0, 4)} : ${cutNow}`] : []),
    ...(cutBefore ? [`${pf.slice(0, 4)} : ${cutBefore}`] : []),
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
  // #394: buckets touched by a cut get its icon above the bar and the cause in the tooltip
  const cuts = cutDays();
  const byKey = new Map<string, string[]>();
  for (const d of cutDaysIn(lo, hi)) byKey.set(bucketKey(d, g), [...(byKey.get(bucketKey(d, g)) ?? []), d]);
  const cutOf = keys.map((k) => byKey.get(k) ?? []);
  const cutNote = (days: string[]) =>
    days.length ? (g === 'day' ? `${cuts.get(days[0]) === 'power' ? 'coupure de courant' : 'coupure Internet'} ce jour-là : consommation plus basse, pas une économie` : `${cutText(days, cuts)} (${days.map((d) => shortDate(d)).join(', ')})`) : null;
  const notes = marks.map((m, i) => [m.note, cutNote(cutOf[i])].filter(Boolean).join(' · ') || null);
  const flagged = cutOf.some((x) => x.length);
  return {
    muted: marks.some((m) => m.uncertain) ? marks.map((m) => m.uncertain > 0) : undefined,
    partial: marks.some((m) => m.partial) ? marks.map((m) => m.partial) : undefined,
    notes: notes.some(Boolean) ? notes : undefined,
    flags: flagged
      ? {
          icons: cutOf.map((x) => (x.length ? CUT_ICON[x.some((d) => cuts.get(d) === 'power') ? 'power' : 'internet'] : null)),
          text: cutSummary(cutOf.flat(), cuts),
        }
      : undefined,
  };
}
