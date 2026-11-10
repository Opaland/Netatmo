// #311 / #302: Accueil, rebuilt after docs/design/maquettes/accueil.html. One period for the
// whole screen (Mois · Saison · 12 mois · Année) and the line that says what is counted; the
// verdict in euros with its gauge (spent, expected at this date, hatched projection); three
// tiles, each with its named reference; the annual budget; the alerts grouped; « Ce qui a
// compté »; consumption with the outdoor temperature; the summary of the AI analysis.
// What does not answer « où en suis-je ? » lives elsewhere and is reached by a link:
// « Consommation en détail » (day, week, room, table) in Historique, Linky in Compteur,
// invoice and analysis in Outils, budget inputs and CO₂ in ⚙ Objectifs.
import { type DayRecord, addDays, minusYears, pctChange, total } from '../aggregate';
import { type Verdict, projectYear, verdict } from '../analysis';
import { activeRooms, ds, state } from '../app';
import { barChart, cssVar } from '../charts';
import { comparison, gauge, howDetails, legend, list, seg, tile } from '../components';
import { CATEGORY, NO_REFERENCE, PERIOD, TEMP, dayShort, monthLong, rangeLabel, signedPct, vsLabel } from '../glossary';
import {
  HOME_PERIODS,
  type HomeRange,
  changeText,
  countedLine,
  countedRows,
  expectedLabel,
  homePeriod,
  homeRange,
  moneyVerdict,
  monthTick,
  monthlyOutdoor,
  periodPhrase,
  restOfPeriod,
  scopeTitle,
  verdictHeadline,
} from '../home';
import { lazyCard } from '../lazy';
import { routeKey } from '../router';
import { projectedCost } from '../synthese';
import { html } from '../trusted';
import { avgPrice, costAvailable, costOf, esc, firstDay, fmtEur, fmtKwh, lastDay, table, tableToggle } from '../ui';
import { chartMarks, yoyGapNote } from './quality';
import { comparableRecords, offlineEstimate, offlineLine, offlineNow, offlineRun, stoppedIn } from './offline-rooms';
import { offlineText } from '../room-offline';

const ord = (day: string) => (Number(day.slice(8, 10)) === 1 ? '1er' : String(Number(day.slice(8, 10))));
const END_LABEL = { month: 'fin du mois', season: 'fin de saison', year: "fin d'année", '12m': '' } as const;

/** Euros when prices are known, else kWh (every amount of the screen). */
function money(records: DayRecord[], from: string, to: string): { value: number; unit: '€' | 'kWh'; kwh: number } {
  const kwh = total(records, from, to);
  const eur = costAvailable() ? costOf(records, from, to) : null;
  return eur === null ? { value: kwh, unit: 'kWh', kwh } : { value: eur, unit: '€', kwh };
}
const fmtMoney = (v: number, unit: '€' | 'kWh') => (unit === '€' ? fmtEur(v) : fmtKwh(v));

/** Change vs the same days a year earlier, in euros when both are priced, else in kWh. */
function yoy(all: DayRecord[], from: string, to: string): number | null {
  if (!all.some((r) => r.day <= minusYears(to))) return null;
  const records = comparableRecords(all, from, to).records; // #346: a room no longer measured is not « en baisse »
  const now = money(records, from, to);
  const before = money(records, minusYears(from), minusYears(to));
  return now.unit === before.unit ? pctChange(now.value, before.value) : pctChange(now.kwh, before.kwh);
}

export function renderHome(view: HTMLElement, records: DayRecord[]) {
  const last = lastDay();
  const r = homeRange(homePeriod(state.home), last);
  const all = activeRooms().length;
  const n = state.rooms ? state.rooms.length : all;
  const narrowed = state.cat !== 'all' || n !== all;
  const scope = `${scopeTitle(r)} · ${countedLine({ cat: state.cat, rooms: n, allRooms: all, euros: costAvailable() })}`;
  // #346: the verdict leaves out the rooms offline over the period or a year earlier
  const cmp = comparableRecords(records, r.from, r.to);
  const v = verdict(cmp.records, r.from, r.to, ds!.weather);
  view.innerHTML = html`
  <h2 class="sr-only" id="page-title" tabindex="-1">Accueil</h2>
  <div class="periodbar">${seg('home', r.period, HOME_PERIODS, 'Période')}<p class="scope" aria-live="polite">${esc(scope)}${
    narrowed ? ` <button type="button" class="link" data-filter-reset>Tout compter</button>` : ''
  }</p></div>
  ${verdictBlock(records, r, v, cmp)}
  ${tiles(records, last)}
  <div id="budget-zone"></div>
  <div class="alerts" id="alerts">${offlineAlerts()}<div id="grid-zone"></div><div id="cold-alert-zone"></div></div>
  ${countedCard(records, r)}
  ${chartCard(records, r)}
  ${ds!.insights ? '<section class="card insight" id="insight-card" aria-busy="true"><h2>Analyse du mois</h2></section>' : ''}`;
  drawChart(records, r);
  // the annual budget (gauge, set in ⚙ Objectifs) and the new regulated tariff (an alert), on demand (S-7.10)
  void lazyCard(() => import('./budget'), (m) => m.fillHome(), { zone: 'budget-zone', what: 'Budget et nouveau tarif' });
  // S-12.5: prolonged cold in a room followed, among the alerts
  void lazyCard(() => import('./coldalert'), (m) => m.mountColdBanner(document.getElementById('cold-alert-zone')), { zone: 'cold-alert-zone', what: 'Alerte froid prolongé' });
  // S-5.7: the AI analysis in two sentences; the whole text, its archive and what was sent in Outils
  if (ds!.insights) void lazyCard(() => import('./insight'), (m) => m.mountInsight(document.getElementById('insight-card'), true), { zone: 'insight-card', what: 'Analyse IA' });
}

// ------------------------------------------------------------------ verdict and gauge
/** Spent, expected and projected at the end of the period, in the unit of the screen. */
function projection(records: DayRecord[], r: HomeRange, v: Verdict | null, spent: ReturnType<typeof money>): number | null {
  if (r.period === '12m') return null;
  const price = spent.unit === '€' ? (spent.kwh > 0 ? spent.value / spent.kwh : avgPrice(records)) : null;
  if (r.period === 'year') {
    const p = projectYear(records, r.to);
    if (!p) return null;
    return spent.unit === '€' ? projectedCost(spent.value, p.ytd, p.projected, price) : p.projected;
  }
  const rest = restOfPeriod(records, r.to, r.end, firstDay(), v ? v.actual / v.expected : 1);
  if (rest === null) return null;
  return spent.value + (spent.unit === '€' ? (price === null ? 0 : rest * price) : rest);
}

/** #337: « Pourquoi ? » under the verdict, to the explanation of the month shown. */
function explainLink(r: HomeRange): string {
  const ym = r.to.slice(0, 7);
  const before = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
  // #346: a radiator switched off for a stove: the fall comes from it, said in the link (#311: inline, the screen holds in three)
  const stove = [...stoppedIn(r.from, r.to), ...stoppedIn(minusYears(r.from), minusYears(r.to))].filter((x, k, a) => a.findIndex((y) => y.id === x.id) === k);
  const text = stove.length ? 'Pourquoi ? (poêle)' : 'Pourquoi ?'; // #311: short, the stove is named in the label and on the page
  return ` <a class="link verdict-link" href="#${routeKey({ page: 'outil', tool: 'expliquer', month: ym })}" aria-label="${esc(`Pourquoi ? L’écart de ${monthLong(ym)} avec ${monthLong(before)} expliqué${stove.length ? `, dont le poêle (${stove.map((x) => x.name).join(', ')})` : ''}`)}">${esc(text)}</a>`;
}


/** #346: the rooms left out of the verdict, said under it. */
function leftNote(left: string[]): string {
  return left.length ? `<p class="verdict-sub muted">Sans ${esc(left.join(', '))} (hors ligne).</p>` : '';
}

function verdictBlock(records: DayRecord[], r: HomeRange, v: Verdict | null, cmp: { records: DayRecord[]; left: string[] }): string {
  const spent = money(records, r.from, r.to);
  const what = `${spent.unit === '€' ? `<b class="num">${esc(fmtEur(spent.value))}</b> (${esc(fmtKwh(spent.kwh))})` : `<b class="num">${esc(fmtKwh(spent.kwh))}</b>`} ${spent.unit === '€' ? 'dépensés' : 'consommés'} ${esc(periodPhrase(r))}`;
  const end = projection(records, r, v, spent);
  if (!v) {
    return `<section class="verdict" aria-labelledby="verdict-title">
    <span class="verdict-icon" aria-hidden="true">·</span>
    <div><h2 class="verdict-title" id="verdict-title">${esc(spent.unit === '€' ? fmtEur(spent.value) : fmtKwh(spent.kwh))} ${esc(periodPhrase(r))}</h2>
    <p class="verdict-sub">${what}. Pas encore d'année précédente sur ces dates : la comparaison viendra avec un an de données.</p>${leftNote(cmp.left)}</div>
  </section>`;
  }
  const compared = cmp.left.length ? money(cmp.records, r.from, r.to) : spent;
  const m = moneyVerdict(v, compared.unit === '€' ? compared.value : null);
  const icon = Math.round(m.gap) <= -1 ? '▼' : Math.round(m.gap) >= 1 ? '▲' : '=';
  const ref = v.climate ? 'à météo comparable' : 'd’après les années passées';
  const max = Math.max(m.actual, m.expected, end ?? 0) || 1;
  const endTxt = end !== null && END_LABEL[r.period] ? `${END_LABEL[r.period]} ≈ ${fmtMoney(end, m.unit)}` : '';
  const g = gauge({
    label: `${scopeTitle(r)} : ${fmtMoney(m.actual, m.unit)} ${m.unit === '€' ? 'dépensés' : 'consommés'}, ${fmtMoney(m.expected, m.unit)} attendus à cette date${
      endTxt ? `, environ ${fmtMoney(end!, m.unit)} prévus à la ${END_LABEL[r.period]}` : ''
    }`,
    value: m.actual,
    max: max * 1.04,
    expected: m.expected,
    projected: end,
    color: '--accent',
    scale: [`0 ${m.unit}`, `attendu au ${dayShort(r.to)} : ${fmtMoney(m.expected, m.unit)}`, ...(endTxt ? [endTxt] : [])],
  });
  return `<section class="verdict verdict-${m.level}" aria-labelledby="verdict-title">
    <span class="verdict-icon" aria-hidden="true">${icon}</span>
    <div>
      <h2 class="verdict-title" id="verdict-title">${esc(verdictHeadline(m))}</h2>
      <p class="verdict-sub">${what}, pour ${esc(fmtMoney(m.expected, m.unit))} attendus ${esc(ref)} (${esc(signedPct(m.pct))}).${explainLink(r)}</p>
      ${g}
      ${howDetails(
        'Comment c’est calculé',
        `<p class="hint">Attendu = consommation des mêmes dates des années passées (jusqu'à quatre)${
          v.climate ? ', le chauffage corrigé des degrés-jours (le froid réellement constaté)' : ''
        }, ${m.unit === '€' ? 'au prix payé sur la période' : 'en kWh (prix non renseignés)'}. ${
          endTxt ? `La projection ajoute le reste de la période comme les années passées, au rythme constaté ; elle suppose un hiver normal. ` : ''
        }${m.unit === '€' ? 'Prix du contrat en vigueur chaque jour, hors abonnement.' : ''}</p>`,
      )}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ tiles (#302: each reference named)
function tiles(records: DayRecord[], last: string): string {
  const monthFrom = `${last.slice(0, 8)}01`;
  const yearFrom = `${last.slice(0, 4)}-01-01`;
  const year = Number(last.slice(0, 4));
  const mo = money(records, monthFrom, last);
  const yr = money(records, yearFrom, last);
  const mv = verdict(comparableRecords(records, monthFrom, last).records, monthFrom, last, ds!.weather);
  const versus = (from: string, to: string) => {
    const p = yoy(records, from, to);
    return p === null ? `<span class="delta neutral">${NO_REFERENCE}</span>` : comparison(p, vsLabel(from, to)) + yoyGapNote(records, from, to);
  };
  // the year-end projection: real cost so far + the kWh still to come (#291)
  const p = projectYear(records, last);
  const price = yr.unit === '€' ? (yr.kwh > 0 ? yr.value / yr.kwh : avgPrice(records)) : null;
  const end = p ? (yr.unit === '€' ? projectedCost(yr.value, p.ytd, p.projected, price) : p.projected) : null;
  const prev = money(records, `${year - 1}-01-01`, `${year - 1}-12-31`);
  const prevFull = firstDay() <= `${year - 1}-01-01` && prev.value > 0;
  const endSub =
    end === null
      ? ''
      : prevFull
        ? comparison(prev.unit === yr.unit ? pctChange(end, prev.value) : pctChange(p!.projected, prev.kwh), `vs ${year - 1} entière`)
        : '';
  return `<section class="kpis home-tiles">
    ${tile({
      label: `${PERIOD.month}, au ${ord(last)}`,
      value: fmtMoney(mo.value, mo.unit),
      sub: `${versus(monthFrom, last)}${mv ? `<br>${comparison(mv.pct, expectedLabel(mv.climate))}` : ''}`,
    })}
    ${tile({ label: PERIOD.ytd, value: fmtMoney(yr.value, yr.unit), sub: versus(yearFrom, last) })}
    ${
      end === null
        ? ''
        : tile({ label: PERIOD.projection, value: `≈ ${fmtMoney(end, yr.unit)}`, sub: `${endSub}<span class="budget-line" id="budget-line"></span>`, id: 'year-end' })
    }
  </section>`;
}

// ------------------------------------------------------------------ what counted
function countedCard(records: DayRecord[], r: HomeRange): string {
  const byRoom = new Map<string, DayRecord[]>();
  for (const x of records) {
    let a = byRoom.get(x.room);
    if (!a) byRoom.set(x.room, (a = []));
    a.push(x);
  }
  const rooms = activeRooms().filter((x) => byRoom.has(x.id));
  if (!rooms.length) return '';
  const euros = costAvailable();
  const price = avgPrice(records) ?? 0;
  // #346: a room offline counts with its share estimated from the meter, never as 0 or a fall
  const measuredOf = (id: string, f: string, t: string) => (euros ? (costOf(byRoom.get(id)!, f, t) ?? 0) : total(byRoom.get(id)!, f, t));
  const valueOf = (id: string, f: string, t: string) => measuredOf(id, f, t) + (offlineEstimate(id, f, t) ?? 0) * (euros ? price : 1);
  const rows = countedRows(
    rooms.map((x) => x.id),
    valueOf,
    r.from,
    r.to,
  );
  // a room out of reach is said, never dropped; one switched off on purpose is said under the verdict
  const silent = rooms.filter((x) => offlineRun(x.id, r.from, r.to) && !offlineRun(x.id, r.from, r.to)!.stopped && !rows.some((y) => y.id === x.id));
  if (!rows.length && !silent.length) return '';
  const vs = vsLabel(r.from, r.to);
  const off = (id: string) => offlineRun(id, r.from, r.to) ?? offlineRun(id, minusYears(r.from), minusYears(r.to));
  const cat = new Map(rooms.map((x) => [x.id, x]));
  return `<section class="card" id="counted-card" aria-labelledby="counted-title">
    <div class="card-head"><h2 id="counted-title">Ce qui a compté</h2><span class="sub muted">${esc(periodPhrase(r))} · part du total</span></div>
    ${list(
      [
        ...rows.slice(0, 3).map((x) => {
          const room = cat.get(x.id)!;
          const water = room.category === 'water_heater';
          const run = off(x.id);
          const est = run ? offlineEstimate(x.id, r.from, r.to) : null; // « ≈ » before the value: estimated
          return {
            title: room.name,
            sub: run ? offlineText(run, run.from.slice(0, 4) !== r.to.slice(0, 4)) : changeText(x.change, vs), // #311: short, one line
            value: `${est !== null ? '≈ ' : ''}${euros ? fmtEur(x.value) : fmtKwh(x.value)}`,
            color: water ? '--usage-water' : '--usage-heating',
            share: x.share,
            href: `#${routeKey({ page: 'piece', room: x.id })}`,
          };
        }),
        ...silent.map((x) => ({
          title: x.name,
          sub: offlineLine(x.id, r.from, r.to),
          value: '—',
          color: x.category === 'water_heater' ? '--usage-water' : '--usage-heating',
          href: `#${routeKey({ page: 'piece', room: x.id })}`,
        })),
      ],
      'Pièces qui ont le plus compté',
    )}
    <p class="card-foot"><a class="link" href="#pieces">Toutes les pièces${rows.length > 3 ? ` (${rows.length})` : ''}</a></p>
  </section>`;
}

// ------------------------------------------------------------------ rooms offline (#346)
/** One alert per room offline for 48 h or more: its days are missing, not 0. */
function offlineAlerts(): string {
  // #311: one compact line per room (the estimate is in « Ce qui a compté », the steps on the room page)
  return offlineNow()
    .map(
      (o) => `<div class="alert warn" role="note"><span class="ico" aria-hidden="true">!</span><div><p><b>${esc(`${o.name} hors ligne depuis le ${dayShort(o.run.from, o.run.from.slice(0, 4) !== lastDay().slice(0, 4))}`)}</b> <a class="link" href="#${routeKey({ page: 'piece', room: o.id })}">Que faire ?</a></p></div></div>`,
    )
    .join('');
}

// ------------------------------------------------------------------ consumption and cold
interface ChartData {
  months: string[];
  heat: (number | null)[];
  water: (number | null)[];
  temp: (number | null)[];
}
function chartData(records: DayRecord[], r: HomeRange): ChartData {
  const last = r.to;
  const idx = new Map(r.months.map((k, i) => [k, i]));
  const heat = r.months.map((k) => (`${k}-01` > last ? null : 0)) as (number | null)[];
  const water = heat.slice();
  for (const x of records) {
    if (x.day < r.chartFrom || x.day > last) continue;
    const i = idx.get(x.day.slice(0, 7));
    if (i === undefined) continue;
    if (x.cat === 'water_heater') water[i] = (water[i] ?? 0) + x.kwh;
    else heat[i] = (heat[i] ?? 0) + x.kwh;
  }
  const round = (a: (number | null)[]) => a.map((v) => (v === null ? null : Math.round(v)));
  return { months: r.months, heat: round(heat), water: round(water), temp: monthlyOutdoor(ds!.weather, r.months, last) };
}

const chartWindow = (r: HomeRange) =>
  r.period === 'season' ? `saison ${r.chartFrom.slice(0, 4)}–${r.chartTo.slice(0, 4)}, de septembre à août` : r.period === 'year' ? `année ${r.to.slice(0, 4)}` : PERIOD['12m'].toLowerCase();

function chartCard(records: DayRecord[], r: HomeRange): string {
  const to = r.chartTo < r.to ? r.chartTo : r.to;
  const sum = money(records, r.chartFrom, to);
  const heat = total(records.filter((x) => x.cat !== 'water_heater'), r.chartFrom, to);
  const water = sum.kwh - heat;
  const d = chartData(records, r);
  const current = r.to.slice(0, 7);
  const partial = d.months.includes(current) && addDays(r.to, 1).slice(0, 7) === current;
  const days = Number(r.to.slice(8, 10));
  const hp = sum.kwh ? Math.round((heat / sum.kwh) * 100) : 0;
  const hasTemp = d.temp.some((t) => t !== null);
  const heading = r.period === 'month' ? `${chartWindow(r)}, pour situer le mois` : chartWindow(r);
  const rows = d.months
    .map((k, i) => (d.heat[i] === null ? null : [esc(monthTick(k, 0)), d.heat[i] ?? 0, d.water[i] ?? 0, (d.heat[i] ?? 0) + (d.water[i] ?? 0), d.temp[i] === null ? '—' : String(d.temp[i]).replace('.', ',')]))
    .filter((x): x is (string | number)[] => x !== null)
    .reverse();
  return `<section class="card" id="consumption-card" aria-labelledby="consumption-title">
    <div class="card-head"><h2 id="consumption-title">Consommation et froid</h2><span class="sub muted">${esc(heading)}</span></div>
    <p class="period-total"><strong>${esc(fmtMoney(sum.value, sum.unit))}</strong>${sum.unit === '€' ? ` · ${esc(fmtKwh(sum.kwh))}` : ''} ${esc(rangeLabel(r.chartFrom, to))}</p>
    ${heat > 0 && water > 0 ? `<div class="share" aria-hidden="true"><span style="flex:${hp};background:var(--usage-heating)"></span><span style="flex:${100 - hp};background:var(--usage-water)"></span></div>` : ''}
    ${legend([
      ...(heat > 0 ? [{ label: water > 0 ? `${CATEGORY.heating} ${hp} %` : CATEGORY.heating, color: '--usage-heating' }] : []),
      ...(water > 0 ? [{ label: heat > 0 ? `${CATEGORY.water} ${100 - hp} %` : CATEGORY.water, color: '--usage-water' }] : []),
      ...(partial ? [{ label: `Mois en cours (${days} j)`, color: '--text-muted', kind: 'hatch' as const }] : []),
      ...(hasTemp ? [{ label: TEMP.outdoor, color: '--text', kind: 'line' as const }] : []),
    ])}
    <div class="chart home-chart" id="home-chart" role="img" aria-label="Consommation par mois et ${esc(TEMP.outdoor.toLowerCase())}"></div>
    ${tableToggle(table(['Mois', `${CATEGORY.heating} (kWh)`, `${CATEGORY.water} (kWh)`, 'Total (kWh)', `${TEMP.outdoor} (°C)`], rows))}
    <p class="card-foot"><a class="link" href="#historique">Par jour, par semaine ou par pièce : Historique</a></p>
  </section>`;
}

function drawChart(records: DayRecord[], r: HomeRange) {
  const el = document.getElementById('home-chart');
  if (!el) return;
  const d = chartData(records, r);
  const marks = chartMarks(records, d.months, r.chartFrom, r.chartTo, 'month');
  const hasTemp = d.temp.some((t) => t !== null);
  barChart(el, {
    labels: d.months.map(monthTick),
    series: [
      ...(d.heat.some((v) => v) ? [{ name: CATEGORY.heating, color: cssVar('--usage-heating'), data: d.heat }] : []),
      ...(d.water.some((v) => v) ? [{ name: CATEGORY.water, color: cssVar('--usage-water'), data: d.water }] : []),
    ],
    stacked: true,
    price: avgPrice(records),
    ...marks,
    legend: false,
    line: hasTemp ? { name: TEMP.outdoor, color: cssVar('--text'), data: d.temp, unit: '°C' } : undefined,
  });
}
