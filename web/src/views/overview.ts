// Overview (v1.5 « Synthèse »), split up (#308, #311): « Consommation en détail » of Historique, the
// Linky cards of Compteur, invoice and data quality. Accueil itself is views/home.ts.
import {
  CATEGORY_LABEL,
  type Category,
  type DayRecord,
  addDays,
  aggregate,
  bucketLabel,
  minusYears,
  total,
  totalsBy,
} from '../aggregate';
import { ds, setState, state } from '../app';
import { type Series, barChart, cssVar, lineChart } from '../charts';
import { periodAt } from '../offers';
import { OTHER, activeRooms, avgPrice, catColor, contracts, delta, esc, fmt1, eurOf, firstDay, fmtKwh, lastDay, longDate, nf0, roomColor, roomGroup, roomName, seg, table, tableToggle, measureColor, referenceColor } from '../ui';
import { NO_REFERENCE, PERIOD, vsLabel } from '../glossary';
import { chartMarks, qualityCard, uncertainDays, yoyGapNote } from './quality';
import { html } from '../trusted';
import { lazyCard } from '../lazy';
import { tenant, tenantNote } from '../tenant';
import { ENERGY_ONLY, costScope, linkyMonths, pmaxMonths, twelveMonths } from '../synthese';

function kpi(label: string, from: string, to: string, records: DayRecord[], cls = '') {
  const now = total(records, from, to);
  const before = total(records, minusYears(from), minusYears(to));
  const hasBefore = records.some((r) => r.day <= minusYears(to));
  const eur = eurOf(records, from, to);
  return `<article class="kpi${cls}">
    <h3>${esc(label)}</h3>
    <p class="kpi-value">${fmtKwh(now)}</p>
    <p class="kpi-sub">${eur ? `${eur} · ` : ''}${hasBefore ? delta(now, before, vsLabel(from, to)) + yoyGapNote(records, from, to) : `<span class="delta neutral">${NO_REFERENCE}</span>`}</p>
  </article>`;
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
 * « Consommation en détail », any period, usage, granularity, by usage or by room, the values),
 * « meter » (Compteur: Linky share, maximum power and load shedding, load curve, other usages),
 * « twelve » (the 12-month tile, Historique), « invoice » (Outils → Une facture) and « quality »
 * (État des données). Accueil (verdict, tiles, budget, alerts…) is views/home.ts.
 */
export type OverviewPart = 'explore' | 'meter' | 'twelve' | 'invoice' | 'quality';

export function renderOverview(view: HTMLElement, records: DayRecord[], part: OverviewPart = 'explore') {
  const last = lastDay();
  if (part !== 'explore') {
    const body =
      part === 'meter'
        ? `${linkyCard()}${curveCard()}${breakdownCard()}`
        : part === 'twelve'
          ? `<section class="kpis kpis-one">${kpi(PERIOD['12m'], addDays(minusYears(last), 1), last, records)}</section>`
          : part === 'invoice'
            ? '<div id="invoice-zone"></div>'
            : qualityCard(true) || '<section class="card"><p class="hint">Tous les mois sont complets : aucun jour estimé ni perdu.</p></section>';
    view.innerHTML = html(body);
    if (part === 'meter') {
      drawLinky();
      drawCurve();
    }
    if (part === 'meter') drawBreakdown();
    // S-2.3: reconcile with an invoice (lazy module)
    if (part === 'invoice') void lazyCard(() => import('./invoice'), (m) => m.fillInvoice(), { zone: 'invoice-zone', what: 'Facture' });
    return;
  }
  const [from, to] = periodRange();
  const split = state.split;
  const byCat = totalsBy(records, from, to, (r) => r.cat);
  const periodTotal = [...byCat.values()].reduce((a, b) => a + b, 0);
  const periodOptions: [string, string][] = [
    ['30d', '30 jours'],
    ['12m', '12 mois'],
    ...ds!.meta.years
      .slice()
      .reverse()
      .map((y) => [String(y), String(y)] as [string, string]),
    ['all', 'Tout'],
  ];
  const shares = (['heating', 'water_heater'] as Category[])
    .filter((c) => byCat.get(c))
    .map((c) => ({ c, v: byCat.get(c)!, p: (byCat.get(c)! / periodTotal) * 100 }));
  const periodEur = eurOf(records, from, to);
  view.innerHTML = html`
  <section class="card" id="explore-card">
    <div class="card-head">
      <h2>Consommation en détail <small class="muted">kWh</small></h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Période</span><select data-set="period">${periodOptions
          .map(([v, l]) => `<option value="${v}" ${state.period === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
        ${seg('cat', state.cat, [['all', 'Tout'], ['heating', 'Chauffage'], ['water_heater', 'Chauffe-eau']], 'Usage')}
        ${seg('gran', state.gran, [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'An']], 'Granularité')}
        ${seg('split', split, [['category', 'Par usage'], ['room', 'Par pièce']], 'Détail')}
      </div>
    </div>
    <p class="period-total"><strong>${fmtKwh(periodTotal)}</strong> ${periodEur ? `· ${periodEur} ${ENERGY_ONLY} ` : ''}du ${longDate(from)} au ${longDate(to)}${estimatedNote(records, from, to)}</p>
    ${
      shares.length > 1
        ? `<div class="share" aria-hidden="true">${shares
            .map((s) => `<span style="flex:${s.p};background:${catColor(s.c)}"></span>`)
            .join('')}</div><p class="share-legend">${shares
            .map((s) => `<span><i style="background:${catColor(s.c)}"></i>${CATEGORY_LABEL[s.c]} ${nf0.format(s.p)} % · ${fmtKwh(s.v)}</span>`)
            .join('')}</p>`
        : ''
    }
    <div class="chart" id="main-chart" role="img" aria-label="Consommation par période"></div>
    <div id="main-table"></div>
    ${periodEur ? `<p class="hint muted cost-scope">${esc(costScope(state.cat))}</p>` : ''}
  </section>`;

  const set = aggregate(records, from, to, state.gran, split === 'category' ? (r) => r.cat : (r) => roomGroup(r.room));
  const order =
    split === 'category'
      ? (['heating', 'water_heater'] as string[]).filter((k) => set.groups.has(k))
      : [...activeRooms().map((r) => r.id), OTHER].filter((k) => set.groups.has(k));
  const ser: Series[] = order.map((k) => ({
    name: split === 'category' ? CATEGORY_LABEL[k as Category] : roomName(k),
    color: split === 'category' ? catColor(k as Category) : roomColor(k),
    data: set.groups.get(k)!.map((v) => Math.round(v * 10) / 10),
  }));
  const labels = set.keys.map((k) => bucketLabel(k, state.gran));
  // #297: partial buckets hatched, buckets with estimated or lost days paler, both explained in the tooltip
  const marks = chartMarks(records, set.keys, from, to);
  barChart(document.getElementById('main-chart')!, { labels, series: ser, stacked: true, price: avgPrice(records), zoom: labels.length > 60, ...marks });
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
  return n ? ` <a class="muted" href="#etat" title="Jours estimés à partir du total mensuel ou perdus chez Intuis : voir « État des données ».">· ${n} jour${n > 1 ? 's' : ''} estimé${n > 1 ? 's' : ''} ou manquant${n > 1 ? 's' : ''}</a>` : '';
}

// ------------------------------------------------------------------ Compteur cards
function linkyCard() {
  if (tenant().on) return tenantNote('Les cartes Linky (part du logement, puissance, courbe de charge) sont masquées'); // S-12.6
  if (!ds!.linky.size) return '';
  return `<section class="card">
    <div class="card-head"><h2>Part dans la consommation du logement <small class="muted">compteur Linky</small></h2></div>
    <p class="hint muted" id="linky-summary"></p>
    <div class="chart" id="linky-chart" role="img" aria-label="Chauffage, chauffe-eau et autres usages par mois"></div>
    ${ds!.pmax.size ? '<h3>Puissance maximale appelée <small class="muted">kVA, par mois</small></h3><p class="hint muted" id="pmax-summary"></p><div class="chart" id="pmax-chart" role="img" aria-label="Puissance maximale par mois et puissance souscrite"></div>' : ''}
    ${ds!.pmax.size && ds!.meta.has_roomstate ? '<div id="offload-zone" hidden></div>' : ''}
  </section>`;
}

/** S-13.6: load shedding per room next to the Linky peak, lazily imported ./offload module. */
function drawOffload() {
  const el = document.getElementById('offload-zone');
  if (!el) return;
  void lazyCard(() => import('./offload'), (m) => m.fillOffload(el), { zone: el, what: 'Délestage' });
}

/** Linky 30-min load curve: placeholder filled by the lazily imported ./linky module. */
function curveCard() {
  const years = (ds!.meta as { linky_curve_years?: number[] }).linky_curve_years;
  return years?.length && !tenant().on ? '<section class="card" id="curve-card" hidden></section>' : '';
}

function drawCurve() {
  const card = document.getElementById('curve-card');
  if (!card) return;
  void lazyCard(() => import('./linky'), (m) => card.isConnected && m.renderCurveCard(card), { zone: card, what: 'Courbe de charge' });
}

/** S-4.12 / S-1.17: breakdown of the Linky "other usages", lazily imported ./breakdown module. */
function breakdownCard() {
  return ds!.linky.size && !tenant().on ? '<section class="card" id="breakdown-card" hidden></section>' : '';
}

function drawBreakdown() {
  const card = document.getElementById('breakdown-card');
  if (!card) return;
  void lazyCard(() => import('./breakdown'), (m) => card.isConnected && m.renderBreakdownCard(card), { zone: card, what: 'Autres usages en détail' });
}

function drawLinky() {
  const el = document.getElementById('linky-chart');
  if (!el) return;
  // #290: the same 365 days as the main chart and the « 12 derniers mois » tile (not 13 months).
  const [from, last] = twelveMonths(lastDay());
  const { keys, heat, water, home } = linkyMonths(ds!.records, ds!.linky, from, last);
  const other = keys.map((k) => Math.max(0, (home.get(k) ?? 0) - (heat.get(k) ?? 0) - (water.get(k) ?? 0)));
  const sum = (m: Map<string, number>) => keys.reduce((s, k) => s + (m.get(k) ?? 0), 0);
  const tot = sum(home);
  if (tot > 0) {
    document.getElementById('linky-summary')!.innerHTML = html`Du ${longDate(from)} au ${longDate(last)} : chauffage <strong>${nf0.format((sum(heat) / tot) * 100)} %</strong>, chauffe-eau <strong>${nf0.format((sum(water) / tot) * 100)} %</strong>, autres usages <strong>${nf0.format(Math.max(0, 1 - (sum(heat) + sum(water)) / tot) * 100)} %</strong> de ${fmtKwh(tot)} relevés par le compteur.`;
  }
  drawPmax();
  drawOffload();
  barChart(el, {
    labels: keys.map((k) => bucketLabel(k, 'month')),
    series: [
      { name: 'Chauffage', color: catColor('heating'), data: keys.map((k) => Math.round(heat.get(k) ?? 0)) },
      { name: 'Chauffe-eau', color: catColor('water_heater'), data: keys.map((k) => Math.round(water.get(k) ?? 0)) },
      { name: 'Autres usages', color: cssVar('--usage-other'), data: other.map(Math.round) },
    ],
    stacked: true,
    price: avgPrice(),
  });
}

function drawPmax() {
  const el = document.getElementById('pmax-chart');
  if (!el) return;
  // #290: the chart and its sentence cover the same 12 months (365 days) as the rest of the screen.
  const months = pmaxMonths(ds!.pmax, ...twelveMonths(lastDay()));
  const keys = [...months.keys()];
  const subscribed = keys.map((k) => periodAt(contracts(), `${k}-15`)?.kva ?? null);
  lineChart(el, {
    labels: keys.map((k) => bucketLabel(k, 'month')),
    series: [
      { name: 'Puissance max atteinte', color: measureColor(), data: keys.map((k) => Math.round(months.get(k)!.max * 100) / 100) },
      { name: 'Puissance souscrite', color: referenceColor(), data: subscribed },
    ],
    price: null,
    unit: 'kVA',
  });
  const last12 = [...months.values()];
  const peak = last12.reduce((a, b) => (b.max > a.max ? b : a), last12[0]);
  const kva = periodAt(contracts(), lastDay())?.kva;
  if (peak && kva) {
    const margin = kva - peak.max;
    document.getElementById('pmax-summary')!.innerHTML = html`Sur 12 mois, pic de <strong>${fmt1(peak.max)} kVA</strong> le ${longDate(peak.day)}, pour ${kva} kVA souscrits. ${
      margin > 3.5
        ? 'Marge confortable : une puissance inférieure pourrait suffire (abonnement moins cher), à confirmer sur un hiver très froid.'
        : margin < 0.5
          ? 'Vous êtes au plus près de votre puissance : risque de disjonction lors des pics.'
          : 'Puissance adaptée à vos pics.'
    }`;
  }
}

/** Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'period') return false;
  setState({ period: t.value });
  return true;
}
