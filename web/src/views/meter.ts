// #308 / #301: the Compteur tab (maquette docs/design/maquettes/compteur.html), everything that
// comes from the Linky meter. One period for the tab and its detail pages (Mois · Saison ·
// 12 mois · Année, the control of Accueil), written under the control; every card says what it
// counts (« Compté : … ») and the room filters, which do not apply to the meter, are named.
// Main page: « Part des usages », « Puissance maximale » (subscribed vs used, peaks, load
// shedding), then the detail pages: « Journée type », « Veille », « Autres usages en détail »,
// « Heures pleines / creuses ». Figures in meter.ts (pure, tested).
import { CATEGORY_LABEL, type DayRecord, bucketLabel } from '../aggregate';
import { tariffSplit } from '../analysis';
import { ds, state } from '../app';
import { barChart, cssVar } from '../charts';
import { type LegendItem, alert, countedNote, gauge, howDetails, legend, list, seg } from '../components';
import { HOME_PERIODS, type HomeRange, homeRange, scopeTitle } from '../home';
import { lazyCard } from '../lazy';
import {
  coverage,
  coveredText,
  filterNote,
  kva as fmtKva,
  meterPeriod,
  offPeakShare,
  peakOf,
  periodShort,
  powerBuckets,
  powerVerdict,
  usageBuckets,
  usageShare,
} from '../meter';
import { periodAt } from '../offers';
import { term } from '../plain';
import type { MeterPage, Route } from '../router';
import { tenant, tenantNote } from '../tenant';
import { html } from '../trusted';
import { activeRooms, avgPrice, catColor, contracts, esc, fmtKwh, lastDay, longDate, nf0, series, tariffNames } from '../ui';
import * as analyse from './analyse';

const hasCurve = () => !!((ds!.meta as { linky_curve_years?: number[] }).linky_curve_years ?? []).length;
const hasTariffs = () => !!ds!.meta.has_tariffs;
const counted = countedNote;
const head = (id: string, title: string, sub: string) =>
  `<div class="card-head"><h2 id="${id}">${esc(title)}</h2><span class="card-period">${esc(sub)}</span></div>`;

/** The period of the tab, as a range of days ending on the last day of the data. */
export function meterRange(): HomeRange {
  return homeRange(meterPeriod(state.meter), lastDay());
}

function periodBar(r: HomeRange, what = 'tout le logement, relevé par le compteur Linky'): string {
  const all = activeRooms().length;
  const note = filterNote({
    cat: state.cat,
    catLabel: state.cat === 'all' ? '' : CATEGORY_LABEL[state.cat],
    rooms: state.rooms ? state.rooms.length : all,
    allRooms: all,
  });
  return `<div class="periodbar">${seg('meter', r.period, HOME_PERIODS, 'Période')}<p class="scope" aria-live="polite">${esc(scopeTitle(r))} · ${esc(what)}${
    note ? `<br>${esc(note)}` : ''
  }</p></div>`;
}

/** Entry point of the tab and of its detail pages (`route.page === 'compteur-detail'`). */
export function renderMeter(view: HTMLElement, route: Route) {
  const sub = route.page === 'compteur-detail' ? route.sub : null;
  const title = sub ? '' : '<h2 class="page-title" id="page-title" tabindex="-1">Compteur <small class="muted">Linky</small></h2>';
  if (tenant().on) {
    view.innerHTML = html(`${title}${tenantNote('Les cartes du compteur (part des usages, puissance, courbe de charge) sont masquées')}`); // S-12.6
    return;
  }
  const r = meterRange();
  if (!ds!.linky.size && sub !== 'heures-creuses') {
    view.innerHTML = html(`${title}${alert('info', 'Compteur Linky à activer', 'Activez le compteur Linky pour voir la part du chauffage, la puissance et la veille.', '<p><a href="#parametres-sources">Sources de données</a></p>')}${
      hasTariffs() && !sub ? list([{ title: 'Heures pleines / creuses', sub: 'radiateurs et chauffe-eau', href: '#compteur-heures-creuses' }]) : ''
    }`);
    return;
  }
  if (!sub) return renderMain(view, title, r);
  view.innerHTML = html(`${periodBar(r, sub === 'heures-creuses' ? 'radiateurs et chauffe-eau, relevés par tarif' : undefined)}<div id="meter-detail"></div>`);
  renderDetail(document.getElementById('meter-detail')!, sub, r);
}

// ------------------------------------------------------------------ main page
function renderMain(view: HTMLElement, title: string, r: HomeRange) {
  view.innerHTML = html(`${title}${periodBar(r)}${shareCard(r)}${powerCard(r)}${rows(r)}`);
  drawShare(r);
  drawPower(r);
  const veille = view.querySelector<HTMLElement>('a[href="#compteur-veille"] .s');
  if (veille && hasCurve()) void lazyCard(() => import('./linky'), (m) => veille.isConnected && m.standbyRow(veille, r), { zone: null, what: 'Veille' });
}

const gran = (r: HomeRange): 'day' | 'month' => (r.period === 'month' ? 'day' : 'month');

function shareCard(r: HomeRange): string {
  const b = usageBuckets(ds!.records, ds!.linky, r.from, r.to, gran(r));
  const s = usageShare(b);
  const cov = coverage(ds!.linky.keys(), r.from, r.to);
  const body =
    s && cov
      ? `<div class="share" role="img" aria-label="${esc(`Chauffage ${s.pct[0]} %, eau chaude ${s.pct[1]} %, autres usages ${s.pct[2]} %`)}">${[
          [s.pct[0], '--usage-heating'],
          [s.pct[1], '--usage-water'],
          [s.pct[2], '--usage-other'],
        ]
          .filter(([p]) => (p as number) > 0)
          .map(([p, c]) => `<span style="flex:${p};background:var(${c})"></span>`)
          .join('')}</div>
    ${legend([
      { label: `Chauffage ${s.pct[0]} %`, color: '--usage-heating' },
      { label: `Eau chaude ${s.pct[1]} %`, color: '--usage-water' },
      { label: `Autres ${s.pct[2]} %`, color: '--usage-other' },
    ])}
    <p class="meter-total"><strong class="num">${esc(fmtKwh(s.total))}</strong> relevés par le compteur, dont chauffage ${esc(fmtKwh(s.heat))}, eau chaude ${esc(fmtKwh(s.water))} et autres usages ${esc(fmtKwh(s.other))}.</p>
    <div class="chart" id="linky-chart" role="img" aria-label="Chauffage, eau chaude et autres usages par ${gran(r) === 'day' ? 'jour' : 'mois'}"></div>
    ${counted(`tout le logement, ${esc(coveredText(cov))}. Chauffage : les radiateurs ; eau chaude : le chauffe-eau ; autres usages : le reste du compteur.`)}`
      : `<p class="hint muted">Pas de relevé du compteur sur la période.</p>`;
  return `<section class="card" id="share-card" aria-labelledby="share-title">${head('share-title', 'Part des usages', periodShort(r.period, r.to))}${body}</section>`;
}

function drawShare(r: HomeRange) {
  const el = document.getElementById('linky-chart');
  if (!el) return;
  const b = usageBuckets(ds!.records, ds!.linky, r.from, r.to, gran(r));
  barChart(el, {
    labels: b.keys.map((k) => bucketLabel(k, gran(r))),
    series: [
      { name: 'Chauffage', color: catColor('heating'), data: b.heat.map(Math.round) },
      { name: 'Eau chaude', color: catColor('water_heater'), data: b.water.map(Math.round) },
      { name: 'Autres usages', color: cssVar('--usage-other'), data: b.other.map(Math.round) },
    ],
    stacked: true,
    price: avgPrice(),
    legend: false,
  });
}

function powerCard(r: HomeRange): string {
  const sub = periodShort(r.period, r.to);
  const start = `<section class="card" id="power-card" aria-labelledby="power-title">${head('power-title', 'Puissance maximale', sub)}`;
  if (!ds!.pmax.size) return `${start}<p class="hint muted">Le compteur ne transmet pas encore sa puissance maximale.</p></section>`;
  const peak = peakOf(ds!.pmax, r.from, r.to);
  const cov = coverage(ds!.pmax.keys(), r.from, r.to);
  if (!peak || !cov) return `${start}<p class="hint muted">Pas de puissance relevée sur la période.</p></section>`;
  const kva = periodAt(contracts(), r.to)?.kva ?? null;
  const v = kva ? powerVerdict(peak.max, kva) : null;
  const fig = `<p class="meter-big"><span class="big num">${esc(fmtKva(peak.max))}</span> <span class="muted">${kva ? `pour ${kva} ${term('kva')} souscrits` : 'au plus fort'}</span></p>`;
  const g =
    kva && v
      ? gauge({
          label: `Puissance la plus haute : ${fmtKva(peak.max)}, soit ${nf0.format(v.used)} % des ${kva} kVA souscrits`,
          value: peak.max,
          max: Math.max(kva, peak.max),
          color: v.level === 'tight' ? '--state-warn' : '--accent',
          scale: ['0', `utilisés : ${nf0.format(v.used)} %`, `souscrits : ${kva} kVA`],
        })
      : '';
  return `${start}${fig}${g}
    <p id="power-verdict">${v ? `${esc(v.text)} ` : ''}Au plus fort le ${esc(longDate(peak.day))}.</p>
    <p id="offload-line" hidden></p>
    <div class="chart" id="pmax-chart" role="img" aria-label="Puissance la plus haute par ${gran(r) === 'day' ? 'jour' : 'mois'}${kva ? ' et puissance souscrite' : ''}"></div>
    ${ds!.meta.has_roomstate ? howDetails('Voir les valeurs', '<div id="offload-zone" hidden></div>') : ''}
    ${counted(`la puissance la plus haute appelée chaque jour, relevée par le compteur, ${esc(coveredText(cov))}${kva ? ` ; souscrite : ${kva} kVA, votre contrat au ${esc(longDate(r.to))}` : ''}.`)}
  </section>`;
}

function drawPower(r: HomeRange) {
  const el = document.getElementById('pmax-chart');
  if (!el) return;
  const kva = periodAt(contracts(), r.to)?.kva ?? null;
  const b = powerBuckets(ds!.pmax, r.from, r.to, gran(r));
  barChart(el, {
    labels: b.keys.map((k) => bucketLabel(k, gran(r))),
    series: [{ name: 'Puissance la plus haute', color: cssVar('--accent'), data: b.max.map((x) => Math.round(x * 10) / 10) }],
    stacked: false,
    price: null,
    unit: 'kVA',
    ...(kva ? { mark: { value: kva, label: `souscrits ${kva} kVA` } } : {}),
  });
  const zone = document.getElementById('offload-zone');
  const line = document.getElementById('offload-line');
  if (!zone || !line) return;
  void lazyCard(
    () => import('./offload'),
    async (m) => {
      const n = await m.fillOffload(zone, r.from, r.to);
      if (n === null || !line.isConnected) return;
      line.innerHTML = html(
        n
          ? `<strong>${n} jour${n > 1 ? 's' : ''} avec au moins un ${term('delestage')}</strong> : un radiateur ou plus coupé un moment pour rester sous ce seuil. Détail par pièce dans « Voir les valeurs ».`
          : `Aucun radiateur coupé pour rester sous ce seuil (${term('delestage')}) sur la période.`,
      );
      line.hidden = false;
    },
    { zone, what: 'Délestage' },
  );
}

function rows(r: HomeRange): string {
  const hp = hasTariffs() ? offPeakShare(tariffSplit(ds!.records.filter((x) => x.day >= r.from && x.day <= r.to), ds!.tariffs), offPeakCol()) : null;
  return list(
    [
      { title: 'Journée type', sub: hasCurve() ? 'courbe par demi-heure, semaine et week-end' : 'radiateurs et chauffe-eau, heure par heure', href: '#compteur-journee' },
      ...(hasCurve() ? [{ title: 'Veille', sub: 'ce que le logement consomme en permanence', href: '#compteur-veille' }] : []),
      { title: 'Autres usages en détail', sub: 'prises mesurées, appareils saisis, veille', href: '#compteur-autres' },
      ...(hasTariffs() ? [{ title: 'Heures pleines / creuses', sub: hp ? `${nf0.format(hp.pct)} % en heures creuses` : 'radiateurs et chauffe-eau', href: '#compteur-heures-creuses' }] : []),
    ],
    'Détails du compteur',
  );
}

/** Off-peak column of the tariff readings, null when the names are unknown (« Tarif 1 / 2 »). */
function offPeakCol(): 1 | 2 | null {
  const [n1] = tariffNames();
  return n1 === 'Heures creuses' ? 1 : n1 === 'Heures pleines' ? 2 : null;
}

// ------------------------------------------------------------------ detail pages
function renderDetail(zone: HTMLElement, sub: MeterPage, r: HomeRange) {
  const range = { from: r.from, to: r.to };
  switch (sub) {
    case 'journee': {
      zone.innerHTML = html('<div id="curve-zone"></div><div id="hourly-part"></div>');
      const curve = document.getElementById('curve-zone')!;
      if (hasCurve()) void lazyCard(() => import('./linky'), (m) => curve.isConnected && m.renderTypical(curve, range), { zone: curve, what: 'Journée type' });
      else curve.innerHTML = html('<p class="hint muted">Sans la courbe de charge du compteur (à activer dans ⚙ Sources de données), la journée type montre les radiateurs et le chauffe-eau seulement.</p>');
      analyse.renderAnalyse(document.getElementById('hourly-part')!, ds!.records, 'compteur', null, [r.from, r.to]);
      return;
    }
    case 'veille':
      if (!hasCurve()) {
        zone.innerHTML = html('<section class="card"><p class="hint muted">La veille se calcule avec la courbe de charge du compteur : à activer dans ⚙ Sources de données.</p></section>');
        return;
      }
      void lazyCard(() => import('./linky'), (m) => zone.isConnected && m.renderStandby(zone, range), { zone, what: 'Veille' });
      return;
    case 'autres': {
      zone.innerHTML = html('<section class="card" id="breakdown-card" aria-busy="true"><p class="hint muted">Chargement…</p></section>');
      const card = document.getElementById('breakdown-card')!;
      void lazyCard(
        () => import('./breakdown'),
        (m) => {
          if (!card.isConnected) return;
          card.removeAttribute('aria-busy');
          m.renderBreakdownCard(card, range);
        },
        { zone: card, what: 'Autres usages en détail' },
      );
      return;
    }
    case 'heures-creuses':
      zone.innerHTML = html(offPeakCard(r));
      drawOffPeak(r);
  }
}

function offPeakCard(r: HomeRange): string {
  const recs = ds!.records.filter((x) => x.day >= r.from && x.day <= r.to);
  const split = tariffSplit(recs, ds!.tariffs);
  const [n1, n2] = tariffNames();
  const start = `<section class="card" id="offpeak-card" aria-labelledby="offpeak-title">${head('offpeak-title', 'Heures pleines / creuses', periodShort(r.period, r.to))}`;
  if (!hasTariffs() || split[1] + split[2] <= 0) return `${start}<p class="hint muted">Pas de relevé heures pleines / creuses sur la période.</p></section>`;
  const hp = offPeakShare(split, offPeakCol());
  const items: LegendItem[] = [
    { label: `${n1} ${fmtKwh(split[1])}`, color: series(0) },
    { label: `${n2} ${fmtKwh(split[2])}`, color: series(2) },
    ...(split[0] + split[3] > 0 ? [{ label: `Sans détail ${fmtKwh(split[0] + split[3])}`, color: cssVar('--usage-other') }] : []),
  ];
  const days = coverage(
    recs.filter((x) => ds!.tariffs.get(x.room)?.has(x.day)).map((x) => x.day),
    r.from,
    r.to,
  );
  return `${start}${hp ? `<p class="meter-big"><span class="big num">${nf0.format(hp.pct)} %</span> <span class="muted">en ${term('hc')}</span></p>` : ''}
    <div class="share" role="img" aria-label="${esc(items.map((i) => i.label).join(', '))}"><span style="flex:${split[1]};background:${series(0)}"></span><span style="flex:${split[2]};background:${series(2)}"></span>${
      split[0] + split[3] > 0 ? `<span style="flex:${split[0] + split[3]};background:${cssVar('--usage-other')}"></span>` : ''
    }</div>
    ${legend(items)}
    <div class="chart" id="offpeak-chart" role="img" aria-label="Heures pleines et heures creuses par mois"></div>
    ${counted(
      `les radiateurs et le chauffe-eau seulement (relevés par tarif), pas tout le logement${days ? `, ${esc(coveredText(days))}` : ''}. Le compteur ne transmet que le total de la journée.`,
    )}
    <p class="hint muted">Les heures creuses sont reconnues automatiquement : c'est le tarif où le chauffe-eau consomme le plus.</p>
  </section>`;
}

function drawOffPeak(r: HomeRange) {
  const el = document.getElementById('offpeak-chart');
  if (!el) return;
  const byMonth = new Map<string, DayRecord[]>();
  for (const x of ds!.records) {
    if (x.day < r.from || x.day > r.to) continue;
    const k = x.day.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), x]);
  }
  const keys = [...byMonth.keys()].sort();
  const splits = keys.map((k) => tariffSplit(byMonth.get(k)!, ds!.tariffs));
  const [n1, n2] = tariffNames();
  barChart(el, {
    labels: keys.map((k) => bucketLabel(k, 'month')),
    series: [
      { name: n1, color: series(0), data: splits.map((s) => Math.round(s[1])) },
      { name: n2, color: series(2), data: splits.map((s) => Math.round(s[2])) },
    ],
    stacked: true,
    price: null,
    legend: false,
  });
}
