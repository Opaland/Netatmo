// Compare ("Comparer"): years side by side, annual totals and the EDF offer comparator.
import {
  type DayRecord,
  MONTHS_SHORT,
  SEASON_MONTHS,
  addDays,
  seasonOf,
  cumulativeByYear,
  minusYears,
  monthlyBySeason,
  monthlyByYear,
  pctChange,
  total,
} from '../aggregate';
import { compareOffers, daySplits, djuBetween, monthlyDju, offPeakShares } from '../analysis';
import { ds, setState, state } from '../app';
import { type Series, barChart, chartCaption, cssVar, lineChart } from '../charts';
import { SEASON_DEFINITION, dayLong, monthLong, monthShort, seasonLabel, signedPct } from '../glossary';
import { routeKey } from '../router';
import { uncertainDays } from '../checks';
import { cutDays } from './quality';
import { WITH_SUBSCRIPTION } from '../synthese';
import { bucketMarks, monthKeys, shortDate, yoyCaveat, yoyWindow } from '../periods';
import { periodAt } from '../offers';
import {
  avgPrice,
  contracts,
  costAvailable,
  costOf,
  esc,
  firstDay,
  fmtEur,
  fmtKwh,
  lastDay,
  longDate,
  offCol,
  pct,
  seasonStyle,
  seg,
  table,
  tableToggle,
  yearColor,
} from '../ui';
import { html } from '../trusted';
import { alertHtml, legend, tile } from '../components';
import { lazyCard } from '../lazy';
import { tenant, tenantNote } from '../tenant';

/**
 * #308: « history » (Historique: years or seasons compared, annual totals), « offers » (Outils →
 * Quelle offre ?) or « ev » (Outils → Une voiture électrique).
 */
/**
 * #337: « Pourquoi ce mois ? » — each of the last 12 months that has the same month a year
 * earlier opens « Expliquer un mois » on it (#outils-expliquer-AAAA-MM).
 */
export function explainLinks(records: DayRecord[], last: string): string {
  const have = new Set(records.map((r) => r.day.slice(0, 7)));
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1 - i, 1));
    const ym = d.toISOString().slice(0, 7);
    if (have.has(ym) && have.has(`${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`)) months.push(ym);
  }
  if (!months.length) return '';
  return `<p class="hint explain-links" id="explain-links">Pourquoi un mois a changé ? ${months
    .map((m) => `<a class="link" href="#${routeKey({ page: 'outil', tool: 'expliquer', month: m })}"><span class="sr-only">Expliquer </span>${esc(monthShort(m))}<span class="sr-only"> (${esc(monthLong(m))})</span></a>`)
    .join(' · ')}</p>`;
}

export function renderCompare(view: HTMLElement, records: DayRecord[], part: 'history' | 'offers' | 'ev' = 'history') {
  if (part === 'offers') {
    view.innerHTML = html(comparatorCard() || '<section class="card"><p class="hint muted">Comparateur disponible avec les tarifs réglementés et les jours Tempo (prochaine collecte).</p></section>');
    drawComparator();
    return;
  }
  if (part === 'ev') {
    if (tenant().on) {
      view.innerHTML = html(tenantNote('La simulation de recharge est masquée'));
      return;
    }
    view.innerHTML = html(ds!.offers.size && ds!.tempo.rows.length ? '' : '<section class="card"><p class="hint muted">Simulation disponible avec les tarifs réglementés et les jours Tempo (prochaine collecte).</p></section>');
    // S-2.14: electric-vehicle charging simulator, lazy module
    void lazyCard(() => import('./ev'), (m) => m.mountEv(view), { zone: view, what: 'Voiture électrique' });
    return;
  }
  const years = ds!.meta.years;
  const last = lastDay();
  const lastYear = Number(last.slice(0, 4));
  // #297: first day of these records (a room or a first year can start late), lost or estimated days
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? firstDay());
  const uncertain = uncertainDays(records, ds!.estimated, first, last);
  const firstYear = Number(first.slice(0, 4));
  const mode = state.compareMode;

  // #298: seasons (Sept → Aug) keyed by the year they start, the current one included
  const curSeason = Number(seasonOf(last).slice(0, 4));
  const bySeason = monthlyBySeason(records);
  const seasons = [...new Set([...bySeason.keys()].map((k) => Number(k.slice(0, 4))))].filter((y) => y <= curSeason).sort();
  // maquette « Historique »: the two last complete winters and the one running
  const pickedSeasons = (state.compareSeasons ?? seasons.filter((y) => y >= curSeason - 2)).filter((y) => seasons.includes(y));
  // « Cette année / l'an dernier »: two years; « Toutes les années »: the year chips
  const selected = mode === 'monthly' ? years.filter((y) => y >= lastYear - 1) : state.compareYears.filter((y) => years.includes(y)).sort();

  // Year-over-year: the same window in both years (to date, and from the first data day
  // when the previous year started late), with its caveats (#297).
  const rows = years
    .slice()
    .reverse()
    .map((y) => {
      const full = total(records, `${y}-01-01`, `${y}-12-31`);
      const win = yoyWindow(y, first, last);
      const heat = total(
        records.filter((r) => r.cat === 'heating'),
        `${y}-01-01`,
        `${y}-12-31`,
      );
      const isCurrent = y === lastYear;
      const d = win ? pctChange(total(records, win.from, win.to), total(records, win.prevFrom, win.prevTo)) : null;
      const caveat = yoyCaveat(win, uncertain, { cuts: cutDays() });
      const end = isCurrent ? last : `${y}-12-31`;
      const since = y === firstYear && first > `${y}-01-01` ? ` <small class="muted">depuis le ${shortDate(first)}</small>` : '';
      const cost = costOf(records, `${y}-01-01`, end, true);
      const w = ds!.weather ? djuBetween(ds!.weather, `${y}-01-01`, end) : null;
      return [
        `<span class="swatch" style="background:${yearColor(y)}"></span>${y}${isCurrent ? ` <small class="muted">en cours, au ${shortDate(last)}</small>` : since}`,
        full,
        heat,
        full - heat,
        ...(cost !== null ? [fmtEur(cost)] : []),
        ...(w ? [w.days > 300 || isCurrent ? Math.round(w.dju) : '—', w.dju > 50 ? (heat / w.dju).toFixed(2).replace('.', ',') : '—'] : []),
        d === null ? '—' : `${pct(d)}${caveat ? caveat.split(' · ').map((c) => `<br><small class="muted">${esc(c)}</small>`).join('') : ''}`,
      ];
    });

  const climateOk = !!ds!.weather;
  const corrected = state.climate && climateOk && mode !== 'cumul';
  const title = mode === 'season' ? 'Hiver contre hiver' : mode === 'monthly' ? "Cette année contre l'an dernier" : 'Toutes les années';
  const sub =
    mode === 'season'
      ? 'kWh par mois, hivers complets de septembre à août'
      : mode === 'monthly'
        ? `kWh par mois, ${lastYear - 1} et ${lastYear} (au ${shortDate(last)})`
        : 'kWh cumulés depuis le 1er janvier';
  view.innerHTML = html`
  <section class="card" id="cmp-card">
    <div class="card-head"><h2>${title}</h2></div>
    <p class="card-sub">${sub}</p>
    ${seg('compareMode', mode, [['season', 'Hiver / hiver précédent'], ['monthly', "Cette année / l'an dernier"], ['cumul', 'Toutes les années']], 'Comparer')}
    ${
      climateOk && mode !== 'cumul'
        ? `<label class="switch"><span><b>À climat égal</b><br><small class="muted">corrige l'écart de froid entre les ${mode === 'season' ? 'hivers' : 'années'}</small></span><input type="checkbox" role="switch" data-toggle="climate" aria-label="À climat égal"${state.climate ? ' checked' : ''}></label>`
        : ''
    }
    ${mode === 'season' ? seasonTiles(records, pickedSeasons, curSeason, !!corrected) : ''}
    <div class="chart tall" id="cmp-chart" role="img" aria-label="${
      mode === 'season' ? 'Hivers, kWh par mois de septembre à août' : mode === 'cumul' ? 'Années, kWh cumulés depuis le 1er janvier' : 'Cette année et l’an dernier, kWh par mois'
    }"></div>
    <div id="cmp-legend"></div>
    ${
      mode === 'monthly'
        ? ''
        : `<details class="table-details" id="cmp-choose"${chipsOpen ? ' open' : ''}><summary>${mode === 'season' ? 'Choisir les hivers' : 'Choisir les années'}</summary>${
      mode === 'season'
        ? `<div class="chips" role="group" aria-label="Hivers affichés">${seasons
            .map(
              (y) =>
                `<button type="button" class="chip" data-season="${y}" aria-pressed="${pickedSeasons.includes(y)}"><span class="swatch" style="background:${seasonStyle(y, curSeason).color}"></span>${seasonLabel(y)}${y === curSeason ? ' <small>en cours</small>' : ''}</button>`,
            )
            .join('')}</div>`
        : mode === 'cumul'
          ? `<div class="chips" role="group" aria-label="Années">${years
              .map(
                (y) =>
                  `<button type="button" class="chip" data-year="${y}" aria-pressed="${selected.includes(y)}"><span class="swatch" style="background:${yearColor(y)}"></span>${y}</button>`,
              )
              .join('')}</div>`
          : ''
    }</details>`
    }
    <div id="cmp-table"></div>
    ${explainLinks(records, last)}
    <details class="table-details"><summary>Comment c'est calculé</summary><p class="hint muted">${
      mode === 'season'
        ? `Saison de chauffe : ${SEASON_DEFINITION}, pour comparer des hivers entiers. L'hiver en cours (pointillé) s'arrête au ${longDate(last)}.`
        : mode === 'cumul'
          ? `Total cumulé depuis le 1er janvier. L'année en cours s'arrête au ${longDate(last)}. Une courbe interrompue signale des jours estimés ou perdus (le cumul reprend ensuite).`
          : "Consommation de chaque mois. Les barres hachurées sont des mois incomplets (mois en cours, début de la collecte) ou avec des jours estimés ou perdus : le détail est dans l'infobulle."
    }${
      corrected
        ? " <strong>À climat égal</strong> : le chauffage de chaque mois est ramené aux <span class=\"term\">degrés-jours</span> d'un mois moyen (le chauffe-eau n'est pas corrigé)."
        : ''
    }</p></details>
  </section>
  <section class="card">
    <h2>Totaux annuels</h2>
    ${table(
      [
        'Année',
        'Total kWh',
        'Chauffage',
        'Chauffe-eau',
        ...(costAvailable() ? [`Coût (${WITH_SUBSCRIPTION})`] : []),
        ...(ds!.weather ? ['DJU', 'kWh chauffage / DJU'] : []),
        'Évolution',
      ],
      rows,
    )}
    ${ds!.weather ? '<p class="hint muted">DJU : degrés-jours unifiés (base 18 °C). Plus il fait froid, plus il y en a. Le ratio kWh / DJU compare l\'efficacité du chauffage d\'une année à l\'autre, indépendamment de la météo.</p>' : ''}
    <p class="hint muted">L'évolution de l'année en cours est calculée à date : du 1er janvier au ${dayLong(last, false)} des deux années. Quand l'année précédente a commencé en cours d'année (début de la collecte), l'évolution porte sur la même période des deux années. Les jours estimés ou perdus de chaque année sont signalés : ils faussent l'évolution.</p>
  </section>`;

  const el = document.getElementById('cmp-chart')!;
  let ser: Series[] = [];
  let labels: string[] = [];
  const climateMonthly = () => {
    // heating × (DJU of an average month / DJU of that month) + the rest unchanged
    const heat = monthlyByYear(records.filter((r) => r.cat === 'heating'));
    const other = monthlyByYear(records.filter((r) => r.cat !== 'heating'));
    const { byYear, normal } = monthlyDju(ds!.weather!);
    const out = new Map<number, (number | null)[]>();
    for (const y of new Set([...heat.keys(), ...other.keys()])) {
      out.set(
        y,
        new Array(12).fill(0).map((_, m) => {
          const h = heat.get(y)?.[m] ?? null;
          const o = other.get(y)?.[m] ?? null;
          if (h === null && o === null) return null;
          const dj = byYear.get(y)?.[m] ?? 0;
          // the month still running is compared with the same share of an average month
          const share = y === lastYear && m === Number(last.slice(5, 7)) - 1 ? Number(last.slice(8, 10)) / new Date(Date.UTC(y, m + 1, 0)).getUTCDate() : 1;
          const nm = normal[m] * share;
          const hc = h === null ? 0 : dj > 5 && nm > 5 ? (h * nm) / dj : h;
          return hc + (o ?? 0);
        }),
      );
    }
    return out;
  };
  // #297: partial months (first data month, current month) and months with estimated or lost days
  const marksOf = (keys: string[]) => bucketMarks(keys, 'month', first, last, uncertain);
  if (mode === 'monthly') {
    const m = corrected ? climateMonthly() : monthlyByYear(records);
    labels = MONTHS_SHORT;
    ser = selected.map((y) => {
      const marks = marksOf(monthKeys(y));
      const raw = m.get(y) ?? [];
      return {
        name: String(y),
        color: y === lastYear ? cssVar('--year-0') : cssVar('--year-1'),
        data: raw.map((v) => (v === null ? null : Math.round(v))),
        raw,
        notes: marks.map((k) => k.note),
        marks: marks.map((k) => k.partial || k.uncertain > 0),
      };
    });
    barChart(el, { labels, series: ser, stacked: false, price: avgPrice() });
  } else if (mode === 'cumul') {
    // #297: estimated or lost days break the line (the total goes on after them)
    const c = cumulativeByYear(records, last, uncertain);
    labels = Array.from({ length: 366 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)); // leap year: 366 labels, 29 Feb repeats 28 Feb in other years (#245)
      return `${d.getUTCDate() === 1 ? '1er' : d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
    });
    ser = selected.map((y) => ({
      name: String(y),
      color: yearColor(y),
      data: (c.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))),
      measure: 'last' as const,
      width: y === lastYear ? 3 : 2,
    }));
    lineChart(el, { labels, series: ser, price: avgPrice(), emphasize: String(lastYear) });
  } else {
    let s = bySeason;
    if (corrected) {
      // re-key the corrected calendar months into Sept → Aug seasons
      const cm = climateMonthly();
      s = new Map();
      for (const [y, months] of cm) {
        months.forEach((v, m) => {
          if (v === null) return;
          const key = m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
          if (!s.has(key)) s.set(key, new Array(12).fill(null));
          s.get(key)![SEASON_MONTHS.indexOf(m)] = v;
        });
      }
    }
    labels = SEASON_MONTHS.map((m) => MONTHS_SHORT[m]);
    ser = pickedSeasons
      .filter((y) => s.has(`${y}-${y + 1}`))
      .map((y) => {
        const k = `${y}-${y + 1}`;
        const marks = marksOf(SEASON_MONTHS.map((m) => `${m >= 8 ? y : y + 1}-${String(m + 1).padStart(2, '0')}`));
        const st = seasonStyle(y, curSeason);
        const raw = s.get(k)!;
        return {
          name: `${seasonLabel(y)}${y === curSeason ? ' (en cours)' : ''}`,
          color: st.color,
          dashed: st.dashed,
          width: st.width,
          data: raw.map((v) => (v === null ? null : Math.round(v))),
          raw,
          lastLabel: y === curSeason ? shortDate(last) : undefined,
          notes: marks.map((m) => m.note),
        };
      });
    lineChart(el, { labels, series: ser, price: avgPrice(), endLabels: false, legend: false });
  }
  // #304: the legend as HTML under the chart, readable at 200 % (dashed: the season running)
  if (mode === 'season') {
    document.getElementById('cmp-legend')!.innerHTML = html(
      legend(ser.map((x) => ({ label: x.dashed ? `${x.name.replace(' (en cours)', '')} en cours (au ${shortDate(last)})` : `Hiver ${x.name}`, color: x.color, kind: x.dashed ? 'line' : 'swatch' }))),
    );
  }
  const step = mode === 'cumul' ? 7 : 1;
  document.getElementById('cmp-table')!.innerHTML = html(tableToggle(
    table(
      ['', ...ser.map((s) => s.name)],
      labels.filter((_, i) => i % step === 0).map((l, j) => [esc(l), ...ser.map((s) => s.data[j * step] ?? '—')]),
    ),
  ));
}

/** The winter / year chips stay unfolded once used (a chip redraws the card). */
let chipsOpen = false;

/**
 * Maquette « Historique »: the two last complete winters side by side and their change. At
 * equal climate, the older winter is shown as it would have been with the cold of the newer one
 * (its heating × degree-days ratio; the water heater is not corrected), so that the tiles and the
 * sentence give the same change; the raw kWh are written under it.
 */
function seasonTiles(records: DayRecord[], picked: number[], current: number, climate: boolean): string {
  const done = picked.filter((y) => y < current).slice(-2);
  if (done.length < 2) return '';
  const [b, a] = done;
  const span = (y: number) => [`${y}-09-01`, `${y + 1}-08-31`] as const;
  const sum = (y: number, heat?: boolean) => total(heat ? records.filter((r) => r.cat === 'heating') : records, ...span(y));
  const [ta, tb] = [sum(a), sum(b)];
  if (!ta || !tb) return '';
  const raw = pctChange(ta, tb);
  let tbEq: number | null = null;
  let colder = '';
  if (climate && ds!.weather) {
    const da = djuBetween(ds!.weather, ...span(a)).dju;
    const db = djuBetween(ds!.weather, ...span(b)).dju;
    if (da > 50 && db > 50) {
      const hb = sum(b, true);
      tbEq = (hb * da) / db + (tb - hb);
      colder =
        db > da * 1.02
          ? `L'hiver ${seasonLabel(b)} était plus froid.`
          : da > db * 1.02
            ? `L'hiver ${seasonLabel(a)} était plus froid.`
            : 'Les deux hivers ont eu à peu près le même froid.';
    }
  }
  const eq = tbEq !== null ? pctChange(ta, tbEq) : null;
  const money = (y: number) => {
    const c = costOf(records, ...span(y));
    return c !== null ? `${esc(fmtEur(c))} <small class="muted">hors abonnement</small>` : undefined;
  };
  const tiles =
    tbEq !== null
      ? tile({ label: seasonLabel(a), value: fmtKwh(ta), sub: `<small class="muted">mesuré, hiver de référence</small>` }) +
        tile({ label: seasonLabel(b), value: fmtKwh(tbEq), sub: `<small class="muted">à climat égal (mesuré : ${esc(fmtKwh(tb))})</small>` })
      : tile({ label: seasonLabel(a), value: fmtKwh(ta), sub: money(a) }) + tile({ label: seasonLabel(b), value: fmtKwh(tb), sub: money(b) });
  const vs = `vs l'hiver ${seasonLabel(b)}`;
  const sentence =
    eq !== null && raw !== null
      ? `<b>${signedPct(eq)} ${esc(vs)}, à climat égal</b> (${signedPct(raw)} mesuré). ${colder}`
      : raw !== null
        ? `<b>${signedPct(raw)} ${esc(vs)}</b>.`
        : '';
  // #348: the shared tiles of Accueil (#311): side by side when there is room, an amount never cut
  return `<div class="kpis season-tiles">${tiles}</div><p>${sentence}</p>`;
}

// ------------------------------------------------------------------ EDF offer comparator
// #256: the comparator card and its chart both need it; the year chips do not change it.
let lastComparison: { deps: unknown[]; value: ReturnType<typeof computeComparison> } | null = null;
function comparison() {
  const deps = [ds, state.simKva, contracts()];
  if (!lastComparison || deps.some((d, i) => d !== lastComparison!.deps[i])) lastComparison = { deps, value: computeComparison() };
  return lastComparison.value;
}

function computeComparison() {
  const off = offCol();
  const linky = ds!.linky.size ? ds!.linky : null;
  const splits = daySplits(ds!.records, ds!.tariffs, off, offPeakShares(ds!.tariffs, off), linky);
  const kvaAt = (d: string) => state.simKva ?? periodAt(contracts(), d)?.kva ?? 9;
  const base = ds!.offers.get('edf-trv-base') ?? [];
  const hphc = ds!.offers.get('edf-trv-hphc') ?? [];
  const years = [...new Set(splits.map((s) => Number(s.day.slice(0, 4))))].sort();
  const perYear = years.map((y) => ({
    y,
    r: compareOffers(splits.filter((s) => s.day.startsWith(String(y))), kvaAt, base, hphc, ds!.tempo.rows, ds!.tempo.days),
  }));
  const all = compareOffers(splits, kvaAt, base, hphc, ds!.tempo.rows, ds!.tempo.days);
  return { perYear, all, scope: linky ? 'logement' : 'chauffage' };
}

/** #314: one-line summary of the comparator for its row in Outils (last full year, else the latest). */
export function offersLine(): string {
  if (tenant().on || !ds!.offers.size || !ds!.tempo.rows.length) return '';
  const rows = comparison().perYear.filter((p) => p.r.hphc.days > 0);
  const p = [...rows].reverse().find((x) => x.r.hphc.days >= 360) ?? rows[rows.length - 1];
  if (!p) return '';
  const eur = (k: 'base' | 'hphc' | 'tempo') => fmtEur(p.r[k].energy + p.r[k].subscription);
  return `${p.y}${p.r.hphc.days < 360 ? ` (${p.r.hphc.days} j)` : ''} : Base ${eur('base')} · Heures creuses ${eur('hphc')} · Tempo ${eur('tempo')}`;
}

function simWarning() {
  if (state.simKva === null || !ds!.pmax.size) return '';
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const over = [...ds!.pmax].filter(([d, v]) => d >= from && v > state.simKva!).length;
  return over
    ? alertHtml('bad', `Sur 12 mois, votre puissance a dépassé ${state.simKva} kVA pendant ${over} jour(s) : avec cet abonnement, le disjoncteur aurait coupé.`)
    : `<p class="hint muted">Sur 12 mois, votre pic n'a jamais dépassé ${state.simKva} kVA.</p>`;
}

/** The power list of the comparator (« celle de mon contrat », « simuler 9 kVA »…). */
function powerControl(): string {
  return `<div class="controls">
      <label class="select">Puissance<select data-set="simKva">
        <option value="" ${state.simKva === null ? 'selected' : ''}>celle de mon contrat</option>
        ${[6, 9, 12, 15, 18].map((k) => `<option value="${k}" ${state.simKva === k ? 'selected' : ''}>simuler ${k} kVA</option>`).join('')}
      </select></label>
    </div>`;
}

function comparatorCard() {
  if (tenant().on) return tenantNote('Le comparateur d\'offres est masqué'); // S-12.6
  if (!ds!.offers.size || !ds!.tempo.rows.length) return '';
  const { all, scope } = comparison();
  // #353: a simulated power without regulated tariffs on the period: the card stays, with its list
  // (it used to vanish with it, leaving no way back)
  if (!all.hphc.days)
    return state.simKva === null
      ? ''
      : `<section class="card"><h2>Quelle offre EDF aurait coûté le moins ?</h2>${powerControl()}<p class="hint">Aucun tarif réglementé connu à ${state.simKva} kVA sur la période : choisissez une autre puissance.</p></section>`;
  const tot = (k: 'base' | 'hphc' | 'tempo') => all[k].energy + all[k].subscription;
  const best = (['base', 'hphc', 'tempo'] as const).reduce((a, b) => (tot(b) < tot(a) ? b : a));
  const names = { base: 'Base', hphc: 'Heures pleines / creuses', tempo: 'Tempo' };
  const diff = tot('hphc') - tot(best);
  return `<section class="card">
    <h2>Quelle offre EDF aurait coûté le moins ? <small class="muted">tarifs réglementés, ${WITH_SUBSCRIPTION}, ${scope === 'logement' ? 'tout le logement' : 'radiateurs et chauffe-eau'}, ${all.hphc.days} jours</small></h2>
    <p class="period-total">${
      best === 'hphc'
        ? 'Votre option <strong>heures pleines / creuses</strong> a été la moins chère.'
        : `En <strong>${names[best]}</strong>, vous auriez payé <strong>${fmtEur(diff)}</strong> de moins qu'en heures pleines / creuses sur la période.`
    }</p>
    ${powerControl()}
    ${simWarning()}
    <div class="chart" id="offers-chart" role="img" aria-label="Écart de coût de Base et de Tempo avec votre offre heures pleines / creuses, par année"></div>
    <div id="offers-table"></div>
    <p class="hint muted">Recalcul jour par jour aux tarifs réglementés en vigueur (CRE, open data), abonnement compris, avec la puissance de votre contrat. Périmètre : ${
      scope === 'logement'
        ? 'tout le logement (compteur Linky) ; les heures creuses des autres usages sont supposées réparties sur la journée (8 h sur 24)'
        : 'radiateurs et chauffe-eau seulement (ajoutez le Linky pour tout le logement)'
    }. Tempo : couleur réelle de chaque jour, <strong>sans changer vos habitudes</strong> (en pratique on décale ou réduit sa consommation les jours rouges). L'EJP, fermé aux nouveaux clients depuis 1998, n'est pas publié en open data.</p>
  </section>`;
}

function drawComparator() {
  const el = document.getElementById('offers-chart');
  if (!el) return;
  const { perYear } = comparison();
  const rows = perYear.filter((p) => p.r.hphc.days > 0);
  const cost = (r: (typeof rows)[number]['r'], k: 'base' | 'hphc' | 'tempo') => Math.round(r[k].energy + r[k].subscription);
  // #306: the gap to the current offer (heures pleines / creuses) is the question; grouped bars
  // of 1 800 € hid a 15 € gap. Neutral colours: no offer wears a usage or room colour (#300).
  const days = rows.map((p) => (p.r.hphc.days < 360 ? `${p.r.hphc.days} jours de données` : null));
  const gap = (k: 'base' | 'tempo') => rows.map((p) => cost(p.r, k) - cost(p.r, 'hphc'));
  const ser: Series[] = [
    { name: 'Base', color: cssVar('--series-reference'), data: gap('base'), notes: days, measure: 'sum' },
    { name: 'Tempo', color: cssVar('--series-measure'), data: gap('tempo'), notes: days, measure: 'sum' },
  ];
  barChart(el, {
    labels: rows.map((p) => String(p.y)),
    series: ser,
    stacked: false,
    price: null,
    unit: '€',
    partial: rows.map((p) => p.r.hphc.days < 360),
    mark: { value: 0, label: '' },
  });
  chartCaption(el, 'Écart avec votre offre heures pleines / creuses (ligne 0) : sous zéro, l’offre aurait coûté moins cher ; au-dessus, plus cher. Barres hachurées : année incomplète.');
  document.getElementById('offers-table')!.innerHTML = html(tableToggle(
    table(
      ['Année', 'Base', 'Heures pleines / creuses', 'Tempo'],
      rows.map((p) => [String(p.y), fmtEur(cost(p.r, 'base')), fmtEur(cost(p.r, 'hphc')), fmtEur(cost(p.r, 'tempo'))]),
    ),
  ));
}

// ------------------------------------------------------------------ events
/** Year chips. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
  if (btn.dataset.season || btn.dataset.year) chipsOpen = true;
  if (btn.dataset.season) {
    // #298: season chips, the current season included
    const y = Number(btn.dataset.season);
    const shown = [...btn.parentElement!.querySelectorAll<HTMLElement>('[data-season][aria-pressed=true]')].map((b) => Number(b.dataset.season));
    const cur = new Set(shown);
    if (cur.has(y)) cur.delete(y);
    else cur.add(y);
    setState({ compareSeasons: [...cur].sort() });
    return true;
  }
  if (!btn.dataset.year) return false;
  const y = Number(btn.dataset.year);
  const cur = new Set(state.compareYears);
  if (cur.has(y)) cur.delete(y);
  else cur.add(y);
  setState({ compareYears: [...cur].sort() });
  return true;
}

/** Simulated power and climate toggle. Returns true when the change belonged to this view. */
export function handleChange(t: HTMLInputElement | HTMLSelectElement): boolean {
  if (t.dataset.set === 'simKva') {
    setState({ simKva: t.value ? Number(t.value) : null });
    return true;
  }
  if (t.dataset.toggle === 'climate') {
    setState({ climate: (t as HTMLInputElement).checked });
    return true;
  }
  return false;
}
