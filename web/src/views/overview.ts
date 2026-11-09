// Overview ("Synthèse"): verdict, KPIs, Linky share and the main consumption chart.
import {
  CATEGORY_LABEL,
  type Category,
  type DayRecord,
  MONTHS_LONG,
  addDays,
  aggregate,
  bucketLabel,
  minusYears,
  total,
  totalsBy,
} from '../aggregate';
import { projectYear, verdict } from '../analysis';
import { ds, setState, state } from '../app';
import { type Series, barChart, cssVar, lineChart } from '../charts';
import { periodAt } from '../offers';
import {
  OTHER,
  activeRooms,
  avgPrice,
  catColor,
  contracts,
  delta,
  esc,
  eurOf,
  firstDay,
  fmtEur,
  fmtKwh,
  lastDay,
  longDate,
  nf0,
  pct,
  roomColor,
  roomGroup,
  roomName,
  seg,
  series,
  table,
  tableToggle,
} from '../ui';
import { qualityCard, uncertainBuckets, uncertainDays } from './quality';

function kpi(label: string, from: string, to: string, records: DayRecord[]) {
  const now = total(records, from, to);
  const before = total(records, minusYears(from), minusYears(to));
  const hasBefore = records.some((r) => r.day <= minusYears(to));
  return `<article class="kpi">
    <h3>${esc(label)}</h3>
    <p class="kpi-value">${fmtKwh(now)}</p>
    <p class="kpi-sub">${eurOf(records, from, to) ? `${eurOf(records, from, to)} · ` : ''}${hasBefore ? delta(now, before) : '<span class="delta neutral">pas de référence N-1</span>'}</p>
  </article>`;
}

function periodRange(): [string, string] {
  const last = lastDay();
  if (state.period === 'all') return [firstDay(), last];
  if (state.period === '12m') return [addDays(minusYears(last), 1), last];
  if (state.period === '30d') return [addDays(last, -29), last];
  return [`${state.period}-01-01`, `${state.period}-12-31` < last ? `${state.period}-12-31` : last];
}

export function renderOverview(view: HTMLElement, records: DayRecord[]) {
  const last = lastDay();
  const monthStart = `${last.slice(0, 8)}01`;
  const yearStart = `${last.slice(0, 4)}-01-01`;
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

  view.innerHTML = `
  ${verdictCard(records, monthStart, last)}
  <section class="kpis">
    ${kpi(`${MONTHS_LONG[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)} (au ${Number(last.slice(8, 10))})`, monthStart, last, records)}
    ${kpi(`Depuis le 1er janvier ${last.slice(0, 4)}`, yearStart, last, records)}
    ${kpi('12 derniers mois', addDays(minusYears(last), 1), last, records)}
    ${projectionTile(records, last)}
  </section>
  ${linkyCard()}
  <section class="card">
    <div class="card-head">
      <h2>Consommation <small class="muted">kWh</small></h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Période</span><select data-set="period">${periodOptions
          .map(([v, l]) => `<option value="${v}" ${state.period === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
        ${seg('gran', state.gran, [['day', 'Jour'], ['week', 'Sem.'], ['month', 'Mois'], ['year', 'An']], 'Granularité')}
        ${seg('split', split, [['category', 'Par usage'], ['room', 'Par pièce']], 'Détail')}
      </div>
    </div>
    <p class="period-total"><strong>${fmtKwh(periodTotal)}</strong> ${eurOf(records, from, to) ? `· ${eurOf(records, from, to)} ` : ''}du ${longDate(from)} au ${longDate(to)}${estimatedNote(records, from, to)}</p>
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
  </section>
  ${qualityCard()}`;
  drawLinky();

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
  const muted = uncertainBuckets(records, set.keys, from, to);
  barChart(document.getElementById('main-chart')!, { labels, series: ser, stacked: true, price: avgPrice(), zoom: labels.length > 60, muted });
  document.getElementById('main-table')!.innerHTML = tableToggle(
    table(
      ['Période', ...ser.map((s) => s.name), 'Total'],
      labels
        .map((l, i) => [esc(l), ...ser.map((s) => s.data[i] ?? 0), ser.reduce((a, s) => a + (s.data[i] ?? 0), 0)])
        .reverse(),
    ),
  );
}

function estimatedNote(records: DayRecord[], from: string, to: string) {
  const n = uncertainDays(records, ds!.estimated, from, to).size;
  return n ? ` <a class="muted" href="#quality" title="Jours estimés à partir du total mensuel ou perdus chez Intuis : voir « Qualité des données ».">· ${n} jour${n > 1 ? 's' : ''} estimé${n > 1 ? 's' : ''} ou manquant${n > 1 ? 's' : ''}</a>` : '';
}

// ------------------------------------------------------------------ overview cards
function verdictCard(records: DayRecord[], from: string, to: string) {
  const v = verdict(records, from, to, ds!.weather);
  if (!v) return '';
  const label = { low: 'Plus économe que d\'habitude', normal: 'Conforme à d\'habitude', high: 'Plus élevé que d\'habitude' }[v.level];
  const iconTxt = { low: '▼', normal: '=', high: '▲' }[v.level];
  const price = avgPrice();
  const money = price ? ` · ${v.actual > v.expected ? '+' : '−'}${fmtEur(Math.abs(v.actual - v.expected) * price)}` : '';
  return `<section class="verdict verdict-${v.level}" aria-live="polite">
    <span class="verdict-icon" aria-hidden="true">${iconTxt}</span>
    <div>
      <p class="verdict-title">${esc(label)}</p>
      <p class="verdict-sub">${MONTHS_LONG[Number(to.slice(5, 7)) - 1]} : ${fmtKwh(v.actual)} pour ${fmtKwh(v.expected)} attendus (${pct(v.pct)}${money})${
        v.climate ? ', à météo comparable' : ''
      }.</p>
    </div>
  </section>`;
}

function projectionTile(records: DayRecord[], last: string) {
  const p = projectYear(records, last);
  if (!p) return '';
  const year = last.slice(0, 4);
  const prev = total(records, `${Number(year) - 1}-01-01`, `${Number(year) - 1}-12-31`);
  const price = avgPrice();
  return `<article class="kpi">
    <h3>Fin ${year} estimée</h3>
    <p class="kpi-value">≈ ${fmtKwh(p.projected)}</p>
    <p class="kpi-sub">${price ? `≈ ${fmtEur(p.projected * price)} · ` : ''}${prev ? delta(p.projected, prev) : ''}</p>
  </article>`;
}

function linkyCard() {
  if (!ds!.linky.size) return '';
  return `<section class="card">
    <div class="card-head"><h2>Part dans la consommation du logement <small class="muted">compteur Linky</small></h2></div>
    <p class="hint muted" id="linky-summary"></p>
    <div class="chart" id="linky-chart" role="img" aria-label="Chauffage, chauffe-eau et autres usages par mois"></div>
    ${ds!.pmax.size ? '<h3>Puissance maximale appelée <small class="muted">kVA, par mois</small></h3><p class="hint muted" id="pmax-summary"></p><div class="chart" id="pmax-chart" role="img" aria-label="Puissance maximale par mois et puissance souscrite"></div>' : ''}
  </section>`;
}

function drawLinky() {
  const el = document.getElementById('linky-chart');
  if (!el) return;
  const last = lastDay();
  const from = `${addDays(minusYears(last), 1).slice(0, 7)}-01`;
  const keys = [...new Set([...ds!.linky.keys()].filter((d) => d >= from && d <= last).map((d) => d.slice(0, 7)))].sort();
  const heat = new Map<string, number>();
  const water = new Map<string, number>();
  const home = new Map<string, number>();
  const linkyDays = new Set(ds!.linky.keys());
  for (const r of ds!.records) {
    if (r.day < from || r.day > last || !linkyDays.has(r.day)) continue; // same days on both sides
    const m = r.day.slice(0, 7);
    const target = r.cat === 'water_heater' ? water : heat;
    target.set(m, (target.get(m) ?? 0) + r.kwh);
  }
  for (const [d, kwh] of ds!.linky) if (d >= from && d <= last) home.set(d.slice(0, 7), (home.get(d.slice(0, 7)) ?? 0) + kwh);
  const other = keys.map((k) => Math.max(0, (home.get(k) ?? 0) - (heat.get(k) ?? 0) - (water.get(k) ?? 0)));
  const sum = (m: Map<string, number>) => keys.reduce((s, k) => s + (m.get(k) ?? 0), 0);
  const tot = sum(home);
  if (tot > 0) {
    document.getElementById('linky-summary')!.innerHTML =
      `Sur 12 mois : chauffage <strong>${nf0.format((sum(heat) / tot) * 100)} %</strong>, chauffe-eau <strong>${nf0.format((sum(water) / tot) * 100)} %</strong>, autres usages <strong>${nf0.format(Math.max(0, 1 - (sum(heat) + sum(water)) / tot) * 100)} %</strong> de ${fmtKwh(tot)} relevés par le compteur.`;
  }
  drawPmax();
  barChart(el, {
    labels: keys.map((k) => bucketLabel(k, 'month')),
    series: [
      { name: 'Chauffage', color: catColor('heating'), data: keys.map((k) => Math.round(heat.get(k) ?? 0)) },
      { name: 'Chauffe-eau', color: catColor('water_heater'), data: keys.map((k) => Math.round(water.get(k) ?? 0)) },
      { name: 'Autres usages', color: cssVar('--ghost'), data: other.map(Math.round) },
    ],
    stacked: true,
    price: avgPrice(),
  });
}

function drawPmax() {
  const el = document.getElementById('pmax-chart');
  if (!el) return;
  const months = new Map<string, { max: number; day: string }>();
  for (const [d, v] of ds!.pmax) {
    const m = d.slice(0, 7);
    if (!months.has(m) || v > months.get(m)!.max) months.set(m, { max: v, day: d });
  }
  const keys = [...months.keys()].sort().slice(-24);
  const subscribed = keys.map((k) => periodAt(contracts(), `${k}-15`)?.kva ?? null);
  lineChart(el, {
    labels: keys.map((k) => bucketLabel(k, 'month')),
    series: [
      { name: 'Puissance max atteinte', color: series(1), data: keys.map((k) => Math.round(months.get(k)!.max * 100) / 100) },
      { name: 'Puissance souscrite', color: cssVar('--text-muted'), data: subscribed },
    ],
    price: null,
    unit: 'kVA',
  });
  const last12 = keys.slice(-12).map((k) => months.get(k)!);
  const peak = last12.reduce((a, b) => (b.max > a.max ? b : a), last12[0]);
  const kva = periodAt(contracts(), lastDay())?.kva;
  if (peak && kva) {
    const margin = kva - peak.max;
    document.getElementById('pmax-summary')!.innerHTML = `Sur 12 mois, pic de <strong>${peak.max.toFixed(1).replace('.', ',')} kVA</strong> le ${longDate(peak.day)}, pour ${kva} kVA souscrits. ${
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
