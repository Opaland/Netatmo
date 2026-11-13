// Overview (v1.5 « Synthèse »), split up (#308, #311): « Consommation en détail » of Historique,
// invoice and data quality (the Linky cards are the Compteur tab, views/meter.ts). Accueil itself is views/home.ts.
import {
  type Category,
  type DayRecord,
  addDays,
  aggregate,
  bucketLabel,
  minusYears,
  totalsBy,
} from '../aggregate';
import { ds, setState, state } from '../app';
import { type Series, barChart } from '../charts';
import { OTHER, activeRooms, avgPrice, catColor, esc, eurOf, firstDay, fmtKwh, lastDay, nf0, roomColor, roomGroup, roomName, seg, table, tableToggle } from '../ui';
import { rangeLabel, usageLabel } from '../glossary';
import { yearGranularityAllowed } from '../history';
import { countedHtml } from './counted';
import { chartMarks, cutDays, cutDaysIn, uncertainDays } from './quality';
import { cutText } from '../periods';
import { html } from '../trusted';
import { lazyCard } from '../lazy';
import { ENERGY_ONLY, EUROS_NOTE } from '../synthese';

/** The periods of « Consommation en détail », shortest first (its menu, and the swipe of main.ts). */
export function historyPeriods(): [string, string][] {
  return [
    ['30d', '30 jours'],
    ['12m', '12 mois'],
    ...ds!.meta.years
      .slice()
      .reverse()
      .map((y) => [String(y), String(y)] as [string, string]),
    ['all', 'Tout'],
  ];
}

function periodRange(): [string, string] {
  const last = lastDay();
  if (state.period === 'all') return [firstDay(), last];
  if (state.period === '12m') return [addDays(minusYears(last), 1), last];
  if (state.period === '30d') return [addDays(last, -29), last];
  return [`${state.period}-01-01`, `${state.period}-12-31` < last ? `${state.period}-12-31` : last];
}

/**
 * #308 / #311: the v1.5 « Synthèse » cards, spread over the new pages: « explore » (Historique:
 * « Consommation en détail », any period, usage, granularity, by usage or by room, the values)
 * and « invoice » (Outils → Une facture). Accueil (verdict, tiles, budget, alerts…) is
 * views/home.ts; the quality card, État des données (pages.ts). #386: the 12-month tile left
 * Historique (a third period on the screen; Accueil has « 12 mois »).
 */
export type OverviewPart = 'explore' | 'invoice';

export function renderOverview(view: HTMLElement, records: DayRecord[], part: OverviewPart = 'explore') {
  if (part === 'invoice') {
    view.innerHTML = html('<div id="invoice-zone"></div>');
    // S-2.3: reconcile with an invoice (lazy module)
    void lazyCard(() => import('./invoice'), (m) => m.fillInvoice(), { zone: 'invoice-zone', what: 'Facture' });
    return;
  }
  const [from, to] = periodRange();
  const split = state.split;
  // #306: « An » only over whole years; over a sliding window the months are shown instead
  const yearOk = yearGranularityAllowed(state.period);
  const gran = state.gran === 'year' && !yearOk ? 'month' : state.gran;
  const byCat = totalsBy(records, from, to, (r) => r.cat);
  const periodTotal = [...byCat.values()].reduce((a, b) => a + b, 0);
  const periodOptions = historyPeriods();
  const shares = (['heating', 'water_heater'] as Category[])
    .filter((c) => byCat.get(c))
    .map((c) => ({ c, v: byCat.get(c)!, p: (byCat.get(c)! / periodTotal) * 100 }));
  const periodEur = eurOf(records, from, to);
  view.innerHTML = html`
  <section class="card" id="explore-card">
    <div class="card-head">
      <h2>Consommation en détail <small class="muted">kWh</small></h2><span class="card-period">${esc(rangeLabel(from, to))}</span>
      <div class="controls">
        <label class="select"><span class="sr-only">Période</span><select data-set="period">${periodOptions
          .map(([v, l]) => `<option value="${v}" ${state.period === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
        ${seg('cat', state.cat, [['all', 'Tout'], ['heating', usageLabel('heating')], ['water_heater', usageLabel('water_heater')]], 'Usage')}
        ${seg('gran', gran, [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ...(yearOk ? [['year', 'An'] as [string, string]] : [])], 'Granularité')}
        ${seg('split', split, [['category', 'Par usage'], ['room', 'Par pièce']], 'Détail')}
      </div>
    </div>
    <p class="period-total"><strong>${fmtKwh(periodTotal)}</strong> ${periodEur ? `· ${periodEur} ${ENERGY_ONLY}` : ''}${estimatedNote(records, from, to)}</p>
    ${
      shares.length > 1
        ? `<div class="share" aria-hidden="true">${shares
            .map((s) => `<span style="flex:${s.p};background:${catColor(s.c)}"></span>`)
            .join('')}</div><p class="share-legend">${shares
            .map((s) => `<span><i style="background:${catColor(s.c)}"></i>${usageLabel(s.c)} ${nf0.format(s.p)} % · ${fmtKwh(s.v)}</span>`)
            .join('')}</p>`
        : ''
    }
    <div class="chart" id="main-chart" role="img" aria-label="Consommation par période"></div>
    <div id="main-table"></div>
    ${countedHtml(false, periodEur ? EUROS_NOTE : '')}
  </section>`;

  const set = aggregate(records, from, to, gran, split === 'category' ? (r) => r.cat : (r) => roomGroup(r.room));
  const order =
    split === 'category'
      ? (['heating', 'water_heater'] as string[]).filter((k) => set.groups.has(k))
      : [...activeRooms().map((r) => r.id), OTHER].filter((k) => set.groups.has(k));
  const ser: Series[] = order.map((k) => ({
    name: split === 'category' ? usageLabel(k as Category) : roomName(k),
    color: split === 'category' ? catColor(k as Category) : roomColor(k),
    data: set.groups.get(k)!.map((v) => Math.round(v * 10) / 10),
  }));
  const labels = set.keys.map((k) => bucketLabel(k, gran));
  // #297: partial buckets hatched, buckets with estimated or lost days paler, both explained in the tooltip
  const marks = chartMarks(records, set.keys, from, to);
  // #386: by usage, the share line above already names the two colours (no second legend)
  const ownLegend = split === 'category' && shares.length > 1;
  barChart(document.getElementById('main-chart')!, { labels, series: ser, stacked: true, price: avgPrice(records), zoom: labels.length > 60, ...marks, ...(ownLegend ? { legend: false } : {}) });
  document.getElementById('main-table')!.innerHTML = html(tableToggle(
    table(
      ['Période', ...ser.map((s) => s.name), 'Total'],
      labels
        .map((l, i) => [esc(l), ...ser.map((s) => s.data[i] ?? 0), ser.reduce((a, s) => a + (s.data[i] ?? 0), 0)])
        .reverse(),
    ),
  ));
}

function estimatedNote(records: DayRecord[], from: string, to: string) {
  const n = uncertainDays(records, ds!.estimated, from, to).size;
  const cuts = cutText(cutDaysIn(from, to), cutDays()); // #394
  return `${n ? ` <a class="muted" href="#etat" title="Jours estimés à partir du total mensuel ou perdus chez Intuis : voir « État des données ».">· ${n} jour${n > 1 ? 's' : ''} estimé${n > 1 ? 's' : ''} ou manquant${n > 1 ? 's' : ''}</a>` : ''}${
    cuts ? ` <a class="muted" href="#etat" id="cut-note" title="Journal des incidents : voir « État des données ».">· ${esc(cuts)}</a>` : ''
  }`;
}

/** Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'period') return false;
  setState({ period: t.value });
  return true;
}
