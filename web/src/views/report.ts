// Printable annual report ("Rapport annuel").
import { type Category, type DayRecord, MONTHS_SHORT, monthlyByYear, pctChange } from '../aggregate';
import { djuBetween, fitSeason, roomDeltas, signaturePoints } from '../analysis';
import { ds, setState, state } from '../app';
import { barChart } from '../charts';
import { uncertainDays } from '../checks';
import { WITH_SUBSCRIPTION } from '../synthese';
import { bucketMarks, monthKeys, monthsCovered, shortDate, windowSuffix, yoyCaveat, yoyWindow } from '../periods';
import { CO2_DEFAULT, CO2_SOURCE, co2Factor, fmtCo2, fmtFactor } from '../money';
import {
  activeRooms,
  avgPrice,
  costOf,
  delta,
  drawWaterfall,
  esc,
  firstDay,
  fmtEur,
  fmtKwh,
  lastDay,
  longDate,
  nf0,
  pct,
  table,
  yearColor,
} from '../ui';
import { localDay } from '../glossary';
import { html } from '../trusted';
import { lazyAction, lazyCard } from '../lazy';

export function renderReport(view: HTMLElement) {
  const years = ds!.meta.years;
  const year = state.reportYear ?? years[years.length - 1];
  const all = ds!.records;
  const last = lastDay();
  const end = `${year}-12-31` < last ? `${year}-12-31` : last;
  const from = `${year}-01-01`;
  // #246, #297: what the data really covers (first year started late, year still running)
  const first = firstDay();
  const covFrom = first > from ? first : from;
  const months = monthsCovered(covFrom, end);
  const fullYear = covFrom === from && end === `${year}-12-31`;
  const uncertain = uncertainDays(all, ds!.estimated, first, last);
  // Year over year on the same window in both years (#297)
  const win = yoyWindow(year, first, last);
  const cmpFrom = win?.from ?? from;
  const cmpTo = win?.to ?? end;
  const caveat = yoyCaveat(win, uncertain, { toDate: false });
  const yr = all.filter((r) => r.day >= from && r.day <= end);
  const cmp = all.filter((r) => r.day >= cmpFrom && r.day <= cmpTo);
  const prev = win ? all.filter((r) => r.day >= win.prevFrom && r.day <= win.prevTo) : [];
  const sum = (rs: DayRecord[], cat?: Category) => rs.reduce((s, r) => s + (!cat || r.cat === cat ? r.kwh : 0), 0);
  const tot = sum(yr);
  // the subscription is counted on the covered days only (not before the collection started)
  const cost = costOf(all, covFrom, end, true);
  const w = ds!.weather ? djuBetween(ds!.weather, cmpFrom, cmpTo) : null;
  const wPrev = ds!.weather && win ? djuBetween(ds!.weather, win.prevFrom, win.prevTo) : null;
  const deltas = roomDeltas(all, cmpFrom, cmpTo);
  const ranked = roomDeltas(all, from, end);
  const roomsSorted = activeRooms()
    .filter((r) => deltas.has(r.id))
    .sort((a, b) => (ranked.get(b.id)?.now ?? 0) - (ranked.get(a.id)?.now ?? 0));
  const caveatHtml = caveat ? `<br><small class="muted">${esc(caveat)}</small>` : '';
  const nf1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
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
        <button type="button" class="btn secondary" id="report-anon" data-year-anon="${year}">Rapport anonymisé</button>
        
      </div>
    </div>
    <h2 class="report-title">${esc(ds!.meta.home.name)} — bilan énergie ${year}${end < `${year}-12-31` ? ` <small>(au ${longDate(end)})</small>` : ''}</h2>
    <div class="kpis">
      <article class="kpi"><h3>Consommation</h3><p class="kpi-value">${fmtKwh(tot)}</p><p class="kpi-sub">${win ? delta(sum(cmp), sum(prev), `vs ${year - 1}${fullYear ? '' : ' à date'}`) : delta(tot, 0)}${caveatHtml}</p></article>
      ${
        cost !== null && months > 0
          ? `<article class="kpi"><h3>Coût estimé (${WITH_SUBSCRIPTION})</h3><p class="kpi-value">${fmtEur(cost)}</p><p class="kpi-sub">${fmtEur(cost / months)} par mois en moyenne${
              fullYear ? '' : ` <small class="muted">sur ${nf1(months)} mois (du ${shortDate(covFrom)} au ${shortDate(end)})</small>`
            }</p></article>`
          : ''
      }
      <article class="kpi"><h3>Chauffage / chauffe-eau</h3><p class="kpi-value">${nf0.format((sum(yr, 'heating') / Math.max(tot, 1)) * 100)} % / ${nf0.format((sum(yr, 'water_heater') / Math.max(tot, 1)) * 100)} %</p><p class="kpi-sub">${fmtKwh(sum(yr, 'heating'))} · ${fmtKwh(sum(yr, 'water_heater'))}</p></article>
      ${w && wPrev ? `<article class="kpi"><h3>Rigueur de l'hiver (DJU)</h3><p class="kpi-value">${nf0.format(w.dju)}</p><p class="kpi-sub">${delta(w.dju, wPrev.dju, "de froid vs l'hiver précédent")}</p></article>` : ''}
    </div>
    <h3>Faits marquants</h3>
    <ul class="facts">
      <li>Empreinte carbone : <strong>≈ ${fmtCo2(tot * co2Factor())}</strong> (${fmtKwh(tot)} × ${fmtFactor(co2Factor())}, ${co2Factor() === CO2_DEFAULT ? esc(CO2_SOURCE) : 'facteur choisi par le foyer'}).</li>
      ${peak.d ? `<li>Jour le plus consommateur : <strong>${longDate(peak.d)}</strong> (${fmtKwh(peak.v)}).</li>` : ''}
      ${roomsSorted[0] ? `<li>Pièce la plus consommatrice : <strong>${esc(roomsSorted[0].name)}</strong> (${fmtKwh(ranked.get(roomsSorted[0].id)?.now ?? 0)}).</li>` : ''}
      ${w && wPrev && sum(prev) > 0 ? `<li>À climat égal, le chauffage a évolué de <strong>${pct(((sum(cmp, 'heating') / Math.max(w.dju, 1)) / (sum(prev, 'heating') / Math.max(wPrev.dju, 1)) - 1) * 100)}</strong> par degré-jour par rapport à ${year - 1}${caveat ? ` (${esc(caveat)})` : ''}.</li>` : ''}
      ${fit ? `<li>Signature de la saison ${year - 1}–${year} : <strong>${(-fit.slope).toFixed(2).replace('.', ',')} kWh</strong> de plus par jour pour chaque degré en moins dehors.</li>` : ''}
      ${[...ds!.estimated].some((k) => k.slice(-10).startsWith(String(year))) ? `<li class="muted">Certains jours de ${year} ont été reconstitués à partir des totaux mensuels du serveur (jours estimés).</li>` : ''}
    </ul>
    <h3>Mois par mois</h3>
    <div class="chart" id="report-chart" role="img" aria-label="Consommation mensuelle comparée à l'année précédente"></div>
    <h3>Par pièce</h3>
    <div class="chart" id="report-waterfall" role="img" aria-label="Évolution par pièce"></div>
    ${win?.label ? `<p class="hint muted">Comparaison sur la même période des deux années : ${esc(win.label)}.${caveat.includes('jour') ? ` ${esc(caveat)}.` : ''}</p>` : caveat ? `<p class="hint muted">${esc(caveat)} : l'évolution en est faussée.</p>` : ''}
    ${table(
      ['Pièce', `${year} kWh`, `${year - 1} kWh`, 'Évolution'],
      roomsSorted.map((r) => {
        const d = deltas.get(r.id)!;
        const pc = pctChange(d.now, d.before);
        return [esc(r.name), d.now, d.before, pc === null ? '—' : pct(pc)];
      }),
    )}
    <div id="report-extras"></div>
    <p class="hint muted">Rapport généré le ${longDate(localDay())} par l'application Historique énergie. Données Intuis${ds!.weather ? ', météo ' + (ds!.meta.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo') : ''}${ds!.linky.size ? ', compteur Linky' : ''}.</p>
  </section>`;
  const m = monthlyByYear(all);
  barChart(document.getElementById('report-chart')!, {
    labels: MONTHS_SHORT,
    series: [year - 1, year]
      .filter((y) => m.has(y))
      .map((y) => {
        // #297: partial months and months with estimated or lost days, hatched with a note
        const marks = bucketMarks(monthKeys(y), 'month', first, last, uncertain);
        return {
          name: String(y),
          color: yearColor(y),
          data: m.get(y)!.map((v) => (v === null ? null : Math.round(v))),
          raw: m.get(y)!,
          notes: marks.map((k) => k.note),
          marks: marks.map((k) => k.partial || k.uncertain > 0),
        };
      }),
    stacked: false,
    price: avgPrice(),
  });
  drawWaterfall(document.getElementById('report-waterfall')!, deltas, year, windowSuffix(win));
  // S-6.3: offer comparator and maximum power, lazy module (entry chunk budget)
  void lazyCard(() => import('./annual-share'), (m) => m.renderReportExtras(document.getElementById('report-extras'), year), { zone: 'report-extras', what: 'Comparateur d’offres' });
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
