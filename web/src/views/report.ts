// Printable annual report ("Rapport annuel").
import { type Category, type DayRecord, MONTHS_SHORT, minusYears, monthlyByYear, pctChange } from '../aggregate';
import { djuBetween, fitSeason, roomDeltas, signaturePoints } from '../analysis';
import { ds, setState, state } from '../app';
import { barChart } from '../charts';
import { CO2_DEFAULT, CO2_SOURCE, co2Factor, fmtCo2, fmtFactor } from '../money';
import {
  activeRooms,
  avgPrice,
  costOf,
  delta,
  drawWaterfall,
  esc,
  fmtEur,
  fmtKwh,
  lastDay,
  longDate,
  nf0,
  pct,
  table,
  yearColor,
} from '../ui';
import { html } from '../trusted';
import { lazyAction, lazyCard } from '../lazy';

export function renderReport(view: HTMLElement) {
  const years = ds!.meta.years;
  const year = state.reportYear ?? years[years.length - 1];
  const all = ds!.records;
  const last = lastDay();
  const end = `${year}-12-31` < last ? `${year}-12-31` : last;
  const from = `${year}-01-01`;
  const yr = all.filter((r) => r.day >= from && r.day <= end);
  const prev = all.filter((r) => r.day >= `${year - 1}-01-01` && r.day <= minusYears(end));
  const sum = (rs: DayRecord[], cat?: Category) => rs.reduce((s, r) => s + (!cat || r.cat === cat ? r.kwh : 0), 0);
  const tot = sum(yr);
  const cost = costOf(all, from, end, true);
  const w = ds!.weather ? djuBetween(ds!.weather, from, end) : null;
  const wPrev = ds!.weather ? djuBetween(ds!.weather, `${year - 1}-01-01`, minusYears(end)) : null;
  const deltas = roomDeltas(all, from, end);
  const roomsSorted = activeRooms()
    .filter((r) => deltas.has(r.id))
    .sort((a, b) => deltas.get(b.id)!.now - deltas.get(a.id)!.now);
  const peak = yr.reduce(
    (best, r) => {
      const v = (best.map.get(r.day) ?? 0) + r.kwh;
      best.map.set(r.day, v);
      if (v > best.v) (best.v = v), (best.d = r.day);
      return best;
    },
    { map: new Map<string, number>(), v: 0, d: '' },
  );
  const sigSeason = ds!.weather ? signaturePoints(all, ds!.weather) : null;
  const fit = sigSeason?.get(`${year - 1}-${year}`) ? fitSeason(sigSeason.get(`${year - 1}-${year}`)!) : null;
  view.innerHTML = html`
  <section class="card report">
    <div class="card-head no-print">
      <h2>Rapport annuel</h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Année</span><select data-set="reportYear">${years
          .slice()
          .reverse()
          .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
          .join('')}</select></label>
        <button type="button" class="primary small" id="print">Imprimer / PDF</button>
        <button type="button" class="small" id="report-anon" data-year-anon="${year}">Rapport anonymisé</button>
        <button type="button" class="link" data-view="overview">Fermer</button>
      </div>
    </div>
    <h1 class="report-title">${esc(ds!.meta.home.name)} — bilan énergie ${year}${end < `${year}-12-31` ? ` <small>(au ${longDate(end)})</small>` : ''}</h1>
    <div class="kpis">
      <article class="kpi"><h3>Consommation</h3><p class="kpi-value">${fmtKwh(tot)}</p><p class="kpi-sub">${delta(tot, sum(prev))}</p></article>
      ${cost !== null ? `<article class="kpi"><h3>Coût estimé (abonnement inclus)</h3><p class="kpi-value">${fmtEur(cost)}</p><p class="kpi-sub">${fmtEur(cost / 12)} par mois en moyenne</p></article>` : ''}
      <article class="kpi"><h3>Chauffage / chauffe-eau</h3><p class="kpi-value">${nf0.format((sum(yr, 'heating') / Math.max(tot, 1)) * 100)} % / ${nf0.format((sum(yr, 'water_heater') / Math.max(tot, 1)) * 100)} %</p><p class="kpi-sub">${fmtKwh(sum(yr, 'heating'))} · ${fmtKwh(sum(yr, 'water_heater'))}</p></article>
      ${w && wPrev ? `<article class="kpi"><h3>Rigueur de l'hiver (DJU)</h3><p class="kpi-value">${nf0.format(w.dju)}</p><p class="kpi-sub">${delta(w.dju, wPrev.dju).replace('vs N-1', 'de froid vs N-1')}</p></article>` : ''}
    </div>
    <h3>Faits marquants</h3>
    <ul class="facts">
      <li>Empreinte carbone : <strong>≈ ${fmtCo2(tot * co2Factor())}</strong> (${fmtKwh(tot)} × ${fmtFactor(co2Factor())}, ${co2Factor() === CO2_DEFAULT ? esc(CO2_SOURCE) : 'facteur choisi par le foyer'}).</li>
      ${peak.d ? `<li>Jour le plus consommateur : <strong>${longDate(peak.d)}</strong> (${fmtKwh(peak.v)}).</li>` : ''}
      ${roomsSorted[0] ? `<li>Pièce la plus consommatrice : <strong>${esc(roomsSorted[0].name)}</strong> (${fmtKwh(deltas.get(roomsSorted[0].id)!.now)}).</li>` : ''}
      ${w && wPrev && sum(prev) > 0 ? `<li>À climat égal, le chauffage a évolué de <strong>${pct(((sum(yr, 'heating') / Math.max(w.dju, 1)) / (sum(prev, 'heating') / Math.max(wPrev.dju, 1)) - 1) * 100)}</strong> par degré-jour par rapport à ${year - 1}.</li>` : ''}
      ${fit ? `<li>Signature de la saison ${year - 1}–${year} : <strong>${(-fit.slope).toFixed(2).replace('.', ',')} kWh</strong> de plus par jour pour chaque degré en moins dehors.</li>` : ''}
      ${[...ds!.estimated].some((k) => k.slice(-10).startsWith(String(year))) ? `<li class="muted">Certains jours de ${year} ont été reconstitués à partir des totaux mensuels du serveur (jours estimés).</li>` : ''}
    </ul>
    <h3>Mois par mois</h3>
    <div class="chart" id="report-chart" role="img" aria-label="Consommation mensuelle comparée à l'année précédente"></div>
    <h3>Par pièce</h3>
    <div class="chart" id="report-waterfall" role="img" aria-label="Évolution par pièce"></div>
    ${table(
      ['Pièce', `${year} kWh`, `${year - 1} kWh`, 'Évolution'],
      roomsSorted.map((r) => {
        const d = deltas.get(r.id)!;
        const pc = pctChange(d.now, d.before);
        return [esc(r.name), d.now, d.before, pc === null ? '—' : pct(pc)];
      }),
    )}
    <div id="report-extras"></div>
    <p class="hint muted">Rapport généré le ${longDate(new Date().toISOString().slice(0, 10))} par l'application Historique énergie. Données Intuis${ds!.weather ? ', météo ' + (ds!.meta.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo') : ''}${ds!.linky.size ? ', compteur Linky' : ''}.</p>
  </section>
  <section class="card no-print" id="questions-card" aria-busy="true"><h2>Questions types</h2></section>`;
  const m = monthlyByYear(all);
  barChart(document.getElementById('report-chart')!, {
    labels: MONTHS_SHORT,
    series: [year - 1, year]
      .filter((y) => m.has(y))
      .map((y) => ({ name: String(y), color: yearColor(y), data: m.get(y)!.map((v) => (v === null ? null : Math.round(v))) })),
    stacked: false,
    price: avgPrice(),
  });
  drawWaterfall(document.getElementById('report-waterfall')!, deltas, year);
  // S-6.3: offer comparator and maximum power, lazy module (entry chunk budget)
  void lazyCard(() => import('./annual-share'), (m) => m.renderReportExtras(document.getElementById('report-extras'), year), { zone: 'report-extras', what: 'Comparateur d’offres' });
  // S-5.9: canned questions answered by code, loaded on demand
  void lazyCard(() => import('./questions'), (m) => m.mountQuestions(document.getElementById('questions-card')), { zone: 'questions-card', what: 'Questions types' });
}

// ------------------------------------------------------------------ events
/** Print button. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
  if (btn.id === 'report-anon') {
    // S-6.4: anonymised report for a third party, lazy module
    void lazyAction(btn, () => import('./annual-share'), (m) => m.renderAnonymised(document.getElementById('view')!, m.anonDefault(Number(btn.dataset.yearAnon))), 'Rapport anonymisé');
    return true;
  }
  if (btn.id !== 'print') return false;
  window.print();
  return true;
}

/** Year selector. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set !== 'reportYear') return false;
  setState({ reportYear: Number(t.value) });
  return true;
}
