// Compare ("Comparer"): years side by side, annual totals and the EDF offer comparator.
import {
  type DayRecord,
  MONTHS_LONG,
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
import { type Series, barChart, lineChart } from '../charts';
import { uncertainDays } from '../checks';
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
  lastDay,
  longDate,
  offCol,
  pct,
  seg,
  series,
  table,
  tableToggle,
  yearColor,
} from '../ui';
import { html } from '../trusted';
import { lazyCard } from '../lazy';
import { tenant, tenantNote } from '../tenant';

export function renderCompare(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const last = lastDay();
  const lastYear = Number(last.slice(0, 4));
  const selected = state.compareYears.filter((y) => years.includes(y)).sort();
  // #297: first day of these records (a room or a first year can start late), lost or estimated days
  const first = records.reduce((a, r) => (r.day < a ? r.day : a), records[0]?.day ?? firstDay());
  const uncertain = uncertainDays(records, ds!.estimated, first, last);
  const firstYear = Number(first.slice(0, 4));

  // #298: seasons (Sept → Aug) have their own chips, keyed by the year they start, current one included
  const season = state.compareMode === 'season';
  const curSeason = Number(seasonOf(last).slice(0, 4));
  const seasons = [...new Set([...monthlyBySeason(records).keys()].map((k) => Number(k.slice(0, 4))))].filter((y) => y <= curSeason).sort();
  const pickedSeasons = (state.compareSeasons ?? seasons.slice(-3)).filter((y) => seasons.includes(y));

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
      const caveat = yoyCaveat(win, uncertain);
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
        d === null ? "—" : `${pct(d)}${caveat ? caveat.split(" · ").map((c) => `<br><small class="muted">${esc(c)}</small>`).join("") : ""}`,
      ];
    });

  view.innerHTML = html`
  <section class="card">
    <div class="card-head">
      <h2>Comparer les ${season ? 'saisons' : 'années'} <small class="muted">${state.compareMode === 'monthly' ? 'kWh par mois' : state.compareMode === 'cumul' ? 'kWh cumulés depuis le 1er janvier' : 'kWh cumulés depuis septembre'}</small></h2>
      <div class="controls">
        ${seg('compareMode', state.compareMode, [['monthly', 'Mois par mois'], ['cumul', 'Cumul annuel'], ['season', 'Saison de chauffe']], 'Mode')}
        ${
          ds!.weather && state.compareMode !== 'cumul'
            ? `<label class="toggle"><input type="checkbox" data-toggle="climate" ${state.climate ? 'checked' : ''}> À climat égal</label>`
            : ''
        }
      </div>
    </div>
    ${
      season
        ? `<div class="chips" role="group" aria-label="Saisons">${seasons
            .map(
              (y) =>
                `<button type="button" class="chip" data-season="${y}" aria-pressed="${pickedSeasons.includes(y)}"><span class="swatch" style="background:${yearColor(y)}"></span>${y}–${y + 1}${y === curSeason ? ' <small>en cours</small>' : ''}</button>`,
            )
            .join('')}</div>`
        : `<div class="chips" role="group" aria-label="Années">${years
            .map(
              (y) =>
                `<button type="button" class="chip" data-year="${y}" aria-pressed="${selected.includes(y)}"><span class="swatch" style="background:${yearColor(y)}"></span>${y}</button>`,
            )
            .join('')}</div>`
    }
    <p class="hint muted">${
      state.compareMode === 'season'
        ? `Saison de chauffe : de septembre à août, pour comparer des hivers entiers ; chaque courbe cumule depuis le 1er septembre. La saison en cours (trait épais) s'arrête au ${longDate(last)}.`
        : state.compareMode === 'cumul'
          ? `Total cumulé depuis le 1er janvier. L'année en cours s'arrête au ${longDate(last)}. Une courbe interrompue signale des jours estimés ou perdus (le cumul reprend ensuite).`
          : 'Consommation de chaque mois, année par année. Les barres hachurées sont des mois incomplets (mois en cours, début de la collecte) ou avec des jours estimés ou perdus : le détail est dans l\'infobulle.'
    }${
      state.climate && ds!.weather && state.compareMode !== 'cumul'
        ? ' <strong>À climat égal</strong> : le chauffage de chaque mois est ramené aux degrés-jours d\'un mois moyen (le chauffe-eau n\'est pas corrigé).'
        : ''
    }</p>
    <div class="chart tall" id="cmp-chart" role="img" aria-label="${
      season ? 'Saisons de chauffe, kWh cumulés depuis septembre' : state.compareMode === 'cumul' ? 'Années, kWh cumulés depuis le 1er janvier' : 'Années, kWh par mois'
    }"></div>
    <div id="cmp-table"></div>
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
    <p class="hint muted">L'évolution de l'année en cours est calculée à date : du 1er janvier au ${Number(last.slice(8, 10))} ${MONTHS_LONG[Number(last.slice(5, 7)) - 1]} des deux années. Quand l'année précédente a commencé en cours d'année (début de la collecte), l'évolution porte sur la même période des deux années. Les jours estimés ou perdus de chaque année sont signalés : ils faussent l'évolution.</p>
  </section>`;

  view.insertAdjacentHTML('beforeend', html(comparatorCard()));
  drawComparator();
  // S-2.14: electric-vehicle charging simulator, lazy module
  void lazyCard(() => import('./ev'), (m) => m.mountEv(view), { zone: null, what: 'Voiture électrique' });
  const el = document.getElementById('cmp-chart')!;
  let ser: Series[] = [];
  let labels: string[] = [];
  const corrected = state.climate && ds!.weather && state.compareMode !== 'cumul';
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
          const hc = h === null ? 0 : dj > 5 && normal[m] > 5 ? (h * normal[m]) / dj : h;
          return hc + (o ?? 0);
        }),
      );
    }
    return out;
  };
  // #297: partial months (first data month, current month) and months with estimated or lost days
  const marksOf = (keys: string[]) => bucketMarks(keys, 'month', first, last, uncertain);
  if (state.compareMode === 'monthly') {
    const m = corrected ? climateMonthly() : monthlyByYear(records);
    labels = MONTHS_SHORT;
    ser = selected.map((y) => {
      const marks = marksOf(monthKeys(y));
      const raw = m.get(y) ?? [];
      return {
        name: String(y),
        color: yearColor(y),
        data: raw.map((v) => (v === null ? null : Math.round(v))),
        raw,
        notes: marks.map((k) => k.note),
        marks: marks.map((k) => k.partial || k.uncertain > 0),
      };
    });
    barChart(el, { labels, series: ser, stacked: false, price: avgPrice() });
  } else if (state.compareMode === 'cumul') {
    // #297: estimated or lost days break the line (the total goes on after them)
    const c = cumulativeByYear(records, last, uncertain);
    labels = Array.from({ length: 366 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)); // leap year: 366 labels, 29 Feb repeats 28 Feb in other years (#245)
      return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
    });
    ser = selected.map((y) => ({
      name: String(y),
      color: yearColor(y),
      data: (c.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))),
      measure: 'last' as const,
    }));
    lineChart(el, { labels, series: ser, price: avgPrice(), emphasize: String(lastYear) });
  } else {
    let s = monthlyBySeason(records);
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
        let acc = 0;
        return {
          name: `${y}–${y + 1}${y === curSeason ? ' (en cours)' : ''}`,
          color: yearColor(y),
          data: s.get(k)!.map((v) => (v === null ? null : Math.round((acc += v)))),
          measure: 'last' as const,
          lastLabel: y === curSeason ? shortDate(last) : undefined,
          notes: marks.map((m) => m.note),
        };
      });
    lineChart(el, { labels, series: ser, price: avgPrice(), emphasize: `${curSeason}–${curSeason + 1} (en cours)` });
  }
  const step = state.compareMode === 'cumul' ? 7 : 1;
  document.getElementById('cmp-table')!.innerHTML = html(tableToggle(
    table(
      ['', ...ser.map((s) => s.name)],
      labels.filter((_, i) => i % step === 0).map((l, j) => [esc(l), ...ser.map((s) => s.data[j * step] ?? '—')]),
    ),
  ));
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

function simWarning() {
  if (state.simKva === null || !ds!.pmax.size) return '';
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const over = [...ds!.pmax].filter(([d, v]) => d >= from && v > state.simKva!).length;
  return over
    ? `<p class="stale" role="alert"><span aria-hidden="true">⚠️</span> Sur 12 mois, votre puissance a dépassé ${state.simKva} kVA pendant ${over} jour(s) : avec cet abonnement, le disjoncteur aurait coupé.</p>`
    : `<p class="hint muted">Sur 12 mois, votre pic n'a jamais dépassé ${state.simKva} kVA.</p>`;
}

function comparatorCard() {
  if (tenant().on) return tenantNote('Le comparateur d\'offres est masqué'); // S-12.6
  if (!ds!.offers.size || !ds!.tempo.rows.length) return '';
  const { all, scope } = comparison();
  if (!all.hphc.days) return '';
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
    <div class="controls">
      <label class="select">Puissance<select data-set="simKva">
        <option value="" ${state.simKva === null ? 'selected' : ''}>celle de mon contrat</option>
        ${[6, 9, 12, 15, 18].map((k) => `<option value="${k}" ${state.simKva === k ? 'selected' : ''}>simuler ${k} kVA</option>`).join('')}
      </select></label>
    </div>
    ${simWarning()}
    <div class="chart" id="offers-chart" role="img" aria-label="Coût par offre et par année"></div>
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
  const ser: Series[] = [
    { name: 'Base', color: series(4), data: rows.map((p) => cost(p.r, 'base')) },
    { name: 'Heures pleines / creuses', color: series(0), data: rows.map((p) => cost(p.r, 'hphc')) },
    { name: 'Tempo', color: series(2), data: rows.map((p) => cost(p.r, 'tempo')) },
  ];
  barChart(el, { labels: rows.map((p) => `${p.y}${p.r.hphc.days < 360 ? ` (${p.r.hphc.days} j)` : ''}`), series: ser, stacked: false, price: null, unit: '€' });
  document.getElementById('offers-table')!.innerHTML = html(tableToggle(
    table(
      ['Année', 'Base', 'HP / HC', 'Tempo'],
      rows.map((p) => [String(p.y), fmtEur(cost(p.r, 'base')), fmtEur(cost(p.r, 'hphc')), fmtEur(cost(p.r, 'tempo'))]),
    ),
  ));
}

// ------------------------------------------------------------------ events
/** Year chips. Returns true when the click belonged to this view. */
export function handleClick(btn: HTMLElement): boolean {
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
