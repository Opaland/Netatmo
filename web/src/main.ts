import {
  CATEGORY_LABEL,
  type Category,
  type DayRecord,
  type Granularity,
  MONTHS_LONG,
  MONTHS_SHORT,
  SEASON_MONTHS,
  addDays,
  aggregate,
  applyFilter,
  bucketLabel,
  cumulativeByYear,
  minusYears,
  monthlyBySeason,
  monthlyByYear,
  pctChange,
  toCsv,
  total,
  totalsBy,
} from './aggregate';
import {
  NO_PRICES,
  type Prices,
  dayProfile,
  djuBetween,
  energyCost,
  fitSeason,
  hasPrices,
  monthlyDju,
  offPeakColumn,
  projectYear,
  roomDeltas,
  signaturePoints,
  subscriptionCost,
  tariffSplit,
  verdict,
  weekHourGrid,
  type Hourly,
} from './analysis';
import {
  type Series,
  barChart,
  calendarChart,
  cssVar,
  disposeAll,
  escapeHtml as esc,
  fmtKwh,
  gridHeatmap,
  hbarChart,
  lineChart,
  scatterChart,
  waterfallChart,
} from './charts';
import { WrongPassphrase } from './crypto';
import { type Dataset, NoData, type Source, forgetKeys, load, loadHourly, recallKey, rememberKey, unlock } from './data';
import { renderMarkdown } from './markdown';
import './style.css';

// ------------------------------------------------------------------ state
type View = 'overview' | 'compare' | 'rooms' | 'analyse' | 'report';
type CatFilter = 'all' | Category;

interface State {
  view: View;
  cat: CatFilter;
  rooms: string[] | null;
  period: string; // '12m' | 'all' | 'YYYY'
  gran: Granularity;
  split: 'category' | 'room';
  compareYears: number[];
  compareMode: 'monthly' | 'cumul' | 'season';
  roomsYear: number | null;
  focusRoom: string | null;
  prices: Prices;
  climate: boolean;
  analyseYear: number | null;
  tempRoom: string | null;
  reportYear: number | null;
  showTables: boolean;
}

const DEFAULT: State = {
  view: 'overview',
  cat: 'all',
  rooms: null,
  period: '12m',
  gran: 'month',
  split: 'category',
  compareYears: [],
  compareMode: 'monthly',
  roomsYear: null,
  focusRoom: null,
  prices: NO_PRICES,
  climate: false,
  analyseYear: null,
  tempRoom: null,
  reportYear: null,
  showTables: false,
};

const LS_KEY = 'intuis-history:state';
function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    // v1.0 stored a single price per kWh
    if (typeof saved.price === 'number' && !saved.prices) saved.prices = { ...NO_PRICES, base: saved.price };
    delete saved.price;
    return { ...DEFAULT, ...saved, prices: { ...NO_PRICES, ...(saved.prices ?? {}) } };
  } catch {
    return { ...DEFAULT };
  }
}
let state = loadState();
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  render();
}

let ds: Dataset | null = null;
const app = document.getElementById('app')!;

// ------------------------------------------------------------------ helpers
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** Signed, rounded percentage without "-0". */
const pct = (p: number) => {
  const r = Math.round(p);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf0.format(Math.abs(r))} %`;
};
const fmtEur = (v: number) => `${nf0.format(v)} €`;
/** Energy cost of these records in [from, to], subscription prorated when asked. */
function costOf(records: DayRecord[], from: string, to: string, withSub = false): number | null {
  if (!hasPrices(state.prices)) return null;
  const sub = withSub ? subscriptionCost(from, to, state.prices) : 0;
  return energyCost(records.filter((r) => r.day >= from && r.day <= to), ds!.tariffs, state.prices) + sub;
}
const eurOf = (records: DayRecord[], from: string, to: string) => {
  const c = costOf(records, from, to);
  return c === null ? '' : fmtEur(c);
};
/** Average €/kWh over the last 12 months, for chart tooltips. */
function avgPrice(): number | null {
  const last = lastDay();
  const from = addDays(minusYears(last), 1);
  const recs = ds!.records.filter((r) => r.day >= from);
  const kwh = recs.reduce((s, r) => s + r.kwh, 0);
  const c = costOf(recs, from, last);
  return c === null || !kwh ? null : c / kwh;
}
const SERIES_SLOTS = 8;
const series = (i: number) => cssVar(`--series-${(i % SERIES_SLOTS) + 1}`);
const catColor = (c: Category) => cssVar(c === 'water_heater' ? '--cat-water' : '--cat-heating');

let roomsWithData = new Set<string>();
function activeRooms() {
  return ds!.meta.rooms.filter((r) => r.category !== 'ignore' && roomsWithData.has(r.id));
}
/**
 * Colour follows the room (its position in the house), never its rank.
 * Water-heater rooms wear the water colour; heating rooms take slots 3–8 (blue and
 * orange stay reserved for the two usages). Past six heating rooms → "Autres pièces".
 */
const ROOM_SLOTS = [2, 3, 4, 5, 6, 7];
function roomSlot(id: string): number | null {
  const heating = activeRooms().filter((r) => r.category === 'heating');
  const i = heating.findIndex((r) => r.id === id);
  return i >= 0 && i < ROOM_SLOTS.length ? ROOM_SLOTS[i] : null;
}
function roomColor(id: string) {
  const room = activeRooms().find((r) => r.id === id);
  if (room?.category === 'water_heater') return catColor('water_heater');
  const slot = roomSlot(id);
  return slot === null ? cssVar('--text-muted') : series(slot);
}
const OTHER = '__other__';
const roomGroup = (id: string) =>
  activeRooms().find((r) => r.id === id)?.category === 'water_heater' || roomSlot(id) !== null ? id : OTHER;
function yearColor(y: number) {
  const years = ds!.meta.years;
  return series(years.indexOf(y) >= 0 ? years.length - 1 - years.indexOf(y) : 0);
}
const roomName = (id: string) => (id === OTHER ? 'Autres pièces' : (ds!.meta.rooms.find((r) => r.id === id)?.name ?? id));

function filtered(): DayRecord[] {
  const cats = new Set<Category>(state.cat === 'all' ? ['heating', 'water_heater'] : [state.cat]);
  return applyFilter(ds!.records, { cats, rooms: state.rooms ? new Set(state.rooms) : null });
}

function lastDay(): string {
  return ds!.meta.last_day ?? new Date().toISOString().slice(0, 10);
}
function firstDay(): string {
  return ds!.meta.first_day ?? lastDay();
}

function longDate(day: string) {
  return `${Number(day.slice(8, 10))} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

function delta(now: number, before: number) {
  const p = pctChange(now, before);
  if (p === null) return `<span class="delta neutral">pas de référence N-1</span>`;
  const r = Math.round(p);
  const cls = r === 0 ? 'neutral' : r > 0 ? 'up' : 'down';
  const arrow = r === 0 ? '=' : r > 0 ? '▲' : '▼';
  return `<span class="delta ${cls}"><span aria-hidden="true">${arrow}</span> ${pct(p)} vs N-1</span>`;
}

function seg<T extends string>(name: string, value: T, options: [T, string][], label: string) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options
    .map(
      ([v, l]) =>
        `<button type="button" role="radio" aria-checked="${v === value}" data-set="${name}" data-value="${v}">${esc(l)}</button>`,
    )
    .join('')}</div>`;
}

function table(head: string[], rows: (string | number)[][], numericFrom = 1) {
  return `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="num"' : ''}>${typeof c === 'number' ? nf0.format(c) : c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function tableToggle(content: string) {
  return `<details class="table-details" ${state.showTables ? 'open' : ''}><summary>Voir les valeurs</summary>${content}</details>`;
}

// ------------------------------------------------------------------ unlock screen
function renderLock(message = '', hasRealData = true) {
  disposeAll(app);
  app.innerHTML = `
  <main class="lock">
    <div class="lock-card">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>Historique énergie</h1>
      <p class="muted">Radiateurs et chauffe-eau Intuitiv / Intuis — vos données restent chiffrées, elles ne sont déchiffrées que sur cet appareil.</p>
      ${
        hasRealData
          ? `<form id="unlock">
        <label for="pass">Phrase de passe</label>
        <input id="pass" type="password" autocomplete="current-password" required autofocus>
        <label class="check"><input id="remember" type="checkbox" checked> Rester connecté sur cet appareil</label>
        <button class="primary" type="submit">Déverrouiller</button>
      </form>`
          : `<p class="notice">Aucune donnée n'a encore été collectée. Suivez le guide d'installation du README, ou essayez la démo.</p>`
      }
      <p class="error" role="alert">${esc(message)}</p>
      <button class="link" id="demo" type="button">Essayer avec des données de démonstration</button>
    </div>
  </main>`;
  const form = document.getElementById('unlock') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = (document.getElementById('pass') as HTMLInputElement).value;
    const remember = (document.getElementById('remember') as HTMLInputElement).checked;
    await open('data', pass, remember);
  });
  document.getElementById('demo')!.addEventListener('click', () => open('demo', 'demo', false));
}

async function open(source: Source, pass: string, remember: boolean) {
  const btn = app.querySelector<HTMLButtonElement>('button.primary, #demo');
  if (btn) btn.disabled = true;
  app.querySelector('.error')!.textContent = 'Déchiffrement…';
  try {
    const key = await unlock(source, pass);
    if (remember) await rememberKey(source, key);
    ds = await load(source, key);
    initDefaults();
    render();
  } catch (err) {
    renderLock(err instanceof WrongPassphrase ? 'Phrase de passe incorrecte.' : `Erreur : ${(err as Error).message}`);
  }
}

function initDefaults() {
  roomsWithData = new Set(ds!.records.map((r) => r.room));
  hourly = null;
  const years = ds!.meta.years;
  const valid = new Set(activeRooms().map((r) => r.id));
  const patch: Partial<State> = {};
  if (!state.compareYears.length || state.compareYears.some((y) => !years.includes(y))) patch.compareYears = years.slice(-3);
  if (!state.roomsYear || !years.includes(state.roomsYear)) patch.roomsYear = years[years.length - 1];
  if (state.rooms) patch.rooms = state.rooms.filter((r) => valid.has(r)).length ? state.rooms.filter((r) => valid.has(r)) : null;
  if (/^\d{4}$/.test(state.period) && !years.includes(Number(state.period))) patch.period = '12m';
  const lastYear = years[years.length - 1];
  if (!state.analyseYear || !years.includes(state.analyseYear)) patch.analyseYear = lastYear;
  if (!state.reportYear || !years.includes(state.reportYear)) patch.reportYear = years.length > 1 ? years[years.length - 2] : lastYear;
  if (!ds!.weather) patch.climate = false;
  state = { ...state, ...patch };
}

// ------------------------------------------------------------------ shell
const ICONS = {
  overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  compare: '<path d="M3 17l5-5 4 3 8-8"/><path d="M3 21h18"/>',
  rooms: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  analyse: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 13l2-3 2 2 2-4"/>',
  report: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  menu: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
};
const icon = (name: keyof typeof ICONS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

function render() {
  if (!ds) return;
  disposeAll(app);
  const { meta } = ds;
  const tabs: [View, string][] = [
    ['overview', 'Synthèse'],
    ['compare', 'Comparer'],
    ['rooms', 'Pièces'],
    ['analyse', 'Analyse'],
  ];
  const roomsCount = state.rooms ? state.rooms.length : activeRooms().length;
  app.innerHTML = `
  <header class="top">
    <div class="title">
      <h1>${esc(meta.home.name)}${ds.source === 'demo' ? ' <span class="badge">démo</span>' : ''}</h1>
      <p class="muted">Données jusqu'au ${meta.last_day ? longDate(meta.last_day) : '—'}</p>
    </div>
    <nav class="tabs" aria-label="Vues">
      ${tabs.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${state.view === v ? 'page' : 'false'}">${icon(v)}<span>${l}</span></button>`).join('')}
    </nav>
    <details class="menu">
      <summary aria-label="Menu">${icon('menu')}</summary>
      <div class="menu-panel">
        ${pricesForm()}
        <button type="button" data-view="report">${icon('report')} Rapport annuel imprimable</button>
        <button type="button" id="export">Exporter en CSV (filtres appliqués)</button>
        <button type="button" id="lock">${ds.source === 'demo' ? 'Quitter la démo' : 'Verrouiller'}</button>
      </div>
    </details>
  </header>
  <section class="filters" aria-label="Filtres">
    ${seg('cat', state.cat, [['all', 'Tout'], ['heating', 'Chauffage'], ['water_heater', 'Chauffe-eau']], 'Catégorie')}
    <details class="rooms-picker">
      <summary>Pièces <span class="count">${roomsCount}/${activeRooms().length}</span></summary>
      <div class="rooms-panel">
        <div class="rooms-actions"><button type="button" data-rooms="all">Toutes</button><button type="button" data-rooms="none">Aucune</button></div>
        ${activeRooms()
          .map(
            (r) => `<label class="check"><input type="checkbox" data-room="${esc(r.id)}" ${!state.rooms || state.rooms.includes(r.id) ? 'checked' : ''}>
            <span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)} <small class="muted">${CATEGORY_LABEL[r.category]}</small></label>`,
          )
          .join('')}
      </div>
    </details>
  </section>
  <main id="view"></main>`;
  const view = document.getElementById('view')!;
  const records = filtered();
  if (!records.length) {
    view.innerHTML = `<p class="empty">Aucune donnée pour cette sélection.</p>`;
  } else if (state.view === 'overview') renderOverview(view, records);
  else if (state.view === 'compare') renderCompare(view, records);
  else if (state.view === 'analyse') renderAnalyse(view, records);
  else if (state.view === 'report') renderReport(view);
  else renderRooms(view, records);
  document.body.classList.toggle('is-report', state.view === 'report');
}

// ------------------------------------------------------------------ overview
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

function renderOverview(view: HTMLElement, records: DayRecord[]) {
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
        ? `<div class="share" aria-label="Répartition">${shares
            .map((s) => `<span style="flex:${s.p};background:${catColor(s.c)}"></span>`)
            .join('')}</div><p class="share-legend">${shares
            .map((s) => `<span><i style="background:${catColor(s.c)}"></i>${CATEGORY_LABEL[s.c]} ${nf0.format(s.p)} % · ${fmtKwh(s.v)}</span>`)
            .join('')}</p>`
        : ''
    }
    <div class="chart" id="main-chart" role="img" aria-label="Consommation par période"></div>
    <div id="main-table"></div>
  </section>`;
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
  barChart(document.getElementById('main-chart')!, { labels, series: ser, stacked: true, price: avgPrice(), zoom: labels.length > 60 });
  document.getElementById('main-table')!.innerHTML = tableToggle(
    table(
      ['Période', ...ser.map((s) => s.name), 'Total'],
      labels
        .map((l, i) => [esc(l), ...ser.map((s) => s.data[i] ?? 0), ser.reduce((a, s) => a + (s.data[i] ?? 0), 0)])
        .reverse(),
    ),
  );
}

// ------------------------------------------------------------------ compare
function renderCompare(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const last = lastDay();
  const lastYear = Number(last.slice(0, 4));
  const selected = state.compareYears.filter((y) => years.includes(y)).sort();

  // Year-to-date comparisons use the same calendar window in every year.
  const ytdEnd = last.slice(5);
  const rows = years
    .slice()
    .reverse()
    .map((y) => {
      const full = total(records, `${y}-01-01`, `${y}-12-31`);
      const ytd = total(records, `${y}-01-01`, `${y}-${ytdEnd}`);
      const prevYtd = total(records, `${y - 1}-01-01`, `${y - 1}-${ytdEnd}`);
      const prevFull = total(records, `${y - 1}-01-01`, `${y - 1}-12-31`);
      const heat = total(
        records.filter((r) => r.cat === 'heating'),
        `${y}-01-01`,
        `${y}-12-31`,
      );
      const isCurrent = y === lastYear;
      const d = isCurrent ? pctChange(ytd, prevYtd) : pctChange(full, prevFull);
      const end = isCurrent ? last : `${y}-12-31`;
      const cost = costOf(records, `${y}-01-01`, end, true);
      const w = ds!.weather ? djuBetween(ds!.weather, `${y}-01-01`, end) : null;
      return [
        `<span class="swatch" style="background:${yearColor(y)}"></span>${y}${isCurrent ? ' <small class="muted">en cours</small>' : ''}`,
        full,
        heat,
        full - heat,
        ...(cost !== null ? [fmtEur(cost)] : []),
        ...(w ? [w.days > 300 || isCurrent ? Math.round(w.dju) : '—', w.dju > 50 ? (heat / w.dju).toFixed(2).replace('.', ',') : '—'] : []),
        d === null ? '—' : `${pct(d)}${isCurrent ? ' <small class="muted">à date</small>' : ''}`,
      ];
    });

  view.innerHTML = `
  <section class="card">
    <div class="card-head">
      <h2>Comparer les années <small class="muted">kWh</small></h2>
      <div class="controls">
        ${seg('compareMode', state.compareMode, [['monthly', 'Mois par mois'], ['cumul', 'Cumul annuel'], ['season', 'Saison de chauffe']], 'Mode')}
        ${
          ds!.weather && state.compareMode !== 'cumul'
            ? `<label class="toggle"><input type="checkbox" data-toggle="climate" ${state.climate ? 'checked' : ''}> À climat égal</label>`
            : ''
        }
      </div>
    </div>
    <div class="chips" role="group" aria-label="Années">${years
      .map(
        (y) =>
          `<button type="button" class="chip" data-year="${y}" aria-pressed="${selected.includes(y)}"><span class="swatch" style="background:${yearColor(y)}"></span>${y}</button>`,
      )
      .join('')}</div>
    <p class="hint muted">${
      state.compareMode === 'season'
        ? 'Saison de chauffe : de septembre à août, pour comparer des hivers entiers.'
        : state.compareMode === 'cumul'
          ? `Total cumulé depuis le 1er janvier. L'année en cours s'arrête au ${longDate(last)}.`
          : 'Consommation de chaque mois, année par année.'
    }${
      state.climate && ds!.weather && state.compareMode !== 'cumul'
        ? ' <strong>À climat égal</strong> : le chauffage de chaque mois est ramené aux degrés-jours d\'un mois moyen (le chauffe-eau n\'est pas corrigé).'
        : ''
    }</p>
    <div class="chart tall" id="cmp-chart" role="img" aria-label="Comparaison des années"></div>
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
        ...(hasPrices(state.prices) ? ['Coût'] : []),
        ...(ds!.weather ? ['DJU', 'kWh chauffage / DJU'] : []),
        'Évolution',
      ],
      rows,
    )}
    ${ds!.weather ? '<p class="hint muted">DJU : degrés-jours unifiés (base 18 °C). Plus il fait froid, plus il y en a. Le ratio kWh / DJU compare l\'efficacité du chauffage d\'une année à l\'autre, indépendamment de la météo.</p>' : ''}
    <p class="hint muted">L'évolution de l'année en cours est calculée à date : du 1er janvier au ${Number(last.slice(8, 10))} ${MONTHS_LONG[Number(last.slice(5, 7)) - 1]} des deux années.</p>
  </section>`;

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
  if (state.compareMode === 'monthly') {
    const m = corrected ? climateMonthly() : monthlyByYear(records);
    labels = MONTHS_SHORT;
    ser = selected.map((y) => ({ name: String(y), color: yearColor(y), data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) }));
    barChart(el, { labels, series: ser, stacked: false, price: avgPrice() });
  } else if (state.compareMode === 'cumul') {
    const c = cumulativeByYear(records, last);
    labels = Array.from({ length: 366 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)); // leap year: 366 labels
      return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
    });
    ser = selected.map((y) => ({ name: String(y), color: yearColor(y), data: (c.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) }));
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
    const seasons = [...s.keys()].sort().filter((k) => selected.some((y) => k.endsWith(String(y))));
    ser = seasons.map((k) => {
      let acc = 0;
      return {
        name: k.replace('-', '–'),
        color: yearColor(Number(k.slice(5))),
        data: s.get(k)!.map((v) => (v === null ? null : Math.round((acc += v)))),
      };
    });
    lineChart(el, { labels, series: ser, price: avgPrice() });
  }
  const step = state.compareMode === 'cumul' ? 7 : 1;
  document.getElementById('cmp-table')!.innerHTML = tableToggle(
    table(
      ['', ...ser.map((s) => s.name)],
      labels.filter((_, i) => i % step === 0).map((l, j) => [esc(l), ...ser.map((s) => s.data[j * step] ?? '—')]),
    ),
  );
}

// ------------------------------------------------------------------ rooms
function renderRooms(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const year = state.roomsYear ?? years[years.length - 1];
  const last = lastDay();
  const isCurrent = year === Number(last.slice(0, 4));
  const end = isCurrent ? last : `${year}-12-31`;
  const now = totalsBy(records, `${year}-01-01`, end, (r) => r.room);
  const before = totalsBy(records, `${year - 1}-01-01`, minusYears(end), (r) => r.room);
  const sum = [...now.values()].reduce((a, b) => a + b, 0);
  const rooms = activeRooms().filter((r) => now.has(r.id) || before.has(r.id));
  const sorted = rooms.slice().sort((a, b) => (now.get(b.id) ?? 0) - (now.get(a.id) ?? 0));
  const focus = state.focusRoom && rooms.some((r) => r.id === state.focusRoom) ? state.focusRoom : null;
  const hasTemps = activeRooms().some((r) => ds!.temps.has(r.id));

  view.innerHTML = `
  <section class="card">
    <div class="card-head">
      <h2>Par pièce <small class="muted">kWh</small></h2>
      <div class="controls">
        <label class="select"><span class="sr-only">Année</span><select data-set="roomsYear">${years
          .slice()
          .reverse()
          .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
          .join('')}</select></label>
      </div>
    </div>
    <p class="hint muted">${isCurrent ? `Du 1er janvier au ${longDate(last)}, comparé à la même période de ${year - 1}.` : `Année ${year} complète, comparée à ${year - 1}.`} Touchez une pièce pour voir son détail.</p>
    <div class="chart" id="rooms-chart" style="height:${Math.max(220, sorted.length * 52 + 40)}px" role="img" aria-label="Consommation par pièce"></div>
    ${table(
      ['Pièce', 'kWh', 'Part', `${year - 1}`, 'Évolution', ...(hasTemps ? ['Temp. moy.', 'Consigne moy.'] : [])],
      sorted.map((r) => {
        const v = now.get(r.id) ?? 0;
        const b = before.get(r.id) ?? 0;
        const d = pctChange(v, b);
        const tm = winterTemps(r.id, year);
        return [
          `<button type="button" class="link" data-focus="${esc(r.id)}"><span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)}</button> <small class="muted">${CATEGORY_LABEL[r.category]}</small>`,
          v,
          sum ? `${nf0.format((v / sum) * 100)} %` : '—',
          b,
          d === null ? '—' : pct(d),
          ...(hasTemps ? [tm ? `${tm[0].toFixed(1).replace('.', ',')} °C` : '—', tm?.[1] != null ? `${tm[1].toFixed(1).replace('.', ',')} °C` : '—'] : []),
        ];
      }),
    )}
    ${hasTemps ? '<p class="hint muted">Températures : moyennes des jours chauffés de l\'année (novembre à mars).</p>' : ''}
  </section>
  <section class="card">
    <h2>Qu'est-ce qui a changé ? <small class="muted">${year - 1} → ${year}${isCurrent ? ', à date' : ''}</small></h2>
    <p class="hint muted">Chaque barre montre de combien une pièce a fait monter (rouge) ou baisser (vert) le total.</p>
    <div class="chart" id="rooms-waterfall" role="img" aria-label="Évolution par pièce"></div>
  </section>
  ${
    focus
      ? `<section class="card">
    <div class="card-head"><h2>${esc(roomName(focus))} — mois par mois</h2><button type="button" class="link" data-focus="">Fermer</button></div>
    <div class="chart" id="room-detail" role="img" aria-label="Détail mensuel de la pièce"></div>
  </section>`
      : ''
  }`;

  hbarChart(document.getElementById('rooms-chart')!, {
    labels: sorted.map((r) => r.name),
    series: [
      {
        name: String(year),
        color: cssVar('--text-secondary'),
        data: sorted.map((r) => Math.round(now.get(r.id) ?? 0)),
        colors: sorted.map((r) => roomColor(r.id)),
      },
      { name: `${year - 1} (même période)`, color: cssVar('--ghost'), data: sorted.map((r) => Math.round(before.get(r.id) ?? 0)) },
    ],
    price: avgPrice(),
    onClick: (i) => setState({ focusRoom: sorted[i].id }),
  });
  drawWaterfall(document.getElementById('rooms-waterfall')!, roomDeltas(records, `${year}-01-01`, end), year);
  if (focus) {
    const m = monthlyByYear(records.filter((r) => r.room === focus));
    const shown = years.filter((y) => y >= year - 2 && y <= year);
    barChart(document.getElementById('room-detail')!, {
      labels: MONTHS_SHORT,
      series: shown.map((y) => ({ name: String(y), color: yearColor(y), data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) })),
      stacked: false,
      price: avgPrice(),
    });
  }
}

// ------------------------------------------------------------------ prices (menu)
function tariffNames(): [string, string] {
  const water = activeRooms().filter((r) => r.category === 'water_heater').map((r) => r.id);
  const off = offPeakColumn(ds!.tariffs, water);
  if (off === 2) return ['Heures pleines', 'Heures creuses'];
  if (off === 1) return ['Heures creuses', 'Heures pleines'];
  return ['Tarif 1', 'Tarif 2'];
}
function pricesForm() {
  const p = state.prices;
  const [n1, n2] = tariffNames();
  const input = (key: keyof Prices, label: string, ph: string) =>
    `<label>${esc(label)}<input data-price="${key}" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="${ph}" value="${p[key] ?? ''}"></label>`;
  return `<fieldset class="prices"><legend>Prix (€)</legend>
    ${input('base', ds!.meta.has_tariffs ? 'Prix unique / avant HP-HC (€/kWh)' : 'Prix du kWh (€/kWh)', 'ex. 0,2516')}
    ${ds!.meta.has_tariffs ? input('t1', `${n1} (€/kWh)`, 'ex. 0,27') + input('t2', `${n2} (€/kWh)`, 'ex. 0,20') : ''}
    ${input('sub', 'Abonnement (€/mois)', 'ex. 15,65')}
  </fieldset>`;
}

function estimatedNote(records: DayRecord[], from: string, to: string) {
  if (!ds!.estimated.size) return '';
  const n = new Set(records.filter((r) => r.day >= from && r.day <= to && ds!.estimated.has(`${r.room}|${r.day}`)).map((r) => r.day)).size;
  return n ? ` <span class="muted" title="Jours dont le détail a été perdu par le serveur : reconstitués à partir du total mensuel.">· ${n} jour${n > 1 ? 's' : ''} estimé${n > 1 ? 's' : ''}</span>` : '';
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

// ------------------------------------------------------------------ analyse
let hourly: Hourly | null = null;
let hourlyLoading = false;

function seasonColor(season: string, seasons: string[]) {
  // most recent season = slot 1, then 2, 3… (identity follows the season)
  const i = seasons.length - 1 - seasons.indexOf(season);
  return series(i);
}

function renderAnalyse(view: HTMLElement, records: DayRecord[]) {
  const years = ds!.meta.years;
  const year = state.analyseYear ?? years[years.length - 1];
  const last = lastDay();
  const tempRooms = activeRooms().filter((r) => ds!.temps.has(r.id));
  const tempRoom = tempRooms.find((r) => r.id === state.tempRoom)?.id ?? tempRooms[0]?.id ?? null;
  const split = tariffSplit(records.filter((r) => r.day >= addDays(minusYears(last), 1)), ds!.tariffs);
  const [n1, n2] = tariffNames();
  view.innerHTML = `
  ${
    ds!.insights
      ? `<section class="card insight"><div class="card-head"><h2>Analyse du mois <small class="muted">rédigée par l'IA</small></h2></div>
      <div class="md">${renderMarkdown(ds!.insights.markdown)}</div>
      <p class="hint muted">Générée le ${esc(ds!.insights.generated.slice(0, 10))} (${esc(ds!.insights.model)}) à partir des chiffres calculés par l'application${
        ds!.insights.verified === false ? ' — <strong>attention : certains nombres du texte n\'ont pas pu être vérifiés</strong>' : ''
      }. Les chiffres font foi : l'IA ne fait que les commenter.</p>
      ${ds!.insights.facts ? `<details class="table-details"><summary>Voir exactement ce qui a été envoyé à l'IA</summary><pre class="facts-json">${esc(JSON.stringify(ds!.insights.facts, null, 2))}</pre></details>` : ''}</section>`
      : ''
  }
  ${
    ds!.weather
      ? `<section class="card">
    <div class="card-head"><h2>Signature énergétique <small class="muted">chauffage</small></h2></div>
    <p class="hint muted">Chaque point est un jour : consommation de chauffage selon la température extérieure moyenne${ds!.meta.weather_source === 'netatmo' ? ' (station Netatmo)' : ' (Open-Meteo)'}. La droite résume la saison : plus elle est <strong>pentue</strong>, plus la maison consomme par degré de froid ; là où elle touche zéro, c'est la température à partir de laquelle vous ne chauffez plus.</p>
    <div class="chart tall" id="sig-chart" role="img" aria-label="Signature énergétique"></div>
    <div id="sig-table"></div>
  </section>`
      : `<section class="card"><h2>Signature énergétique</h2><p class="hint muted">Disponible dès que la collecte a récupéré la météo (prochaine collecte).</p></section>`
  }
  <section class="card">
    <div class="card-head"><h2>Calendrier <small class="muted">kWh par jour</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Année</span><select data-set="analyseYear">${years
        .slice()
        .reverse()
        .map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`)
        .join('')}</select></label></div>
    </div>
    <div class="chart" id="cal-chart" style="height:190px" role="img" aria-label="Calendrier de consommation"></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Profil horaire <small class="muted">kWh moyens, 90 derniers jours</small></h2></div>
    <div id="hourly-zone"><p class="hint muted">${(ds!.meta.hourly_years ?? []).length ? 'Chargement des données horaires…' : 'Les données horaires arriveront avec la prochaine collecte complète.'}</p></div>
  </section>
  ${
    ds!.meta.has_tariffs && split[1] + split[2] > 0
      ? `<section class="card"><h2>Heures pleines / heures creuses <small class="muted">12 derniers mois</small></h2>
      <div class="share" aria-label="Répartition par tarif"><span style="flex:${split[1]};background:${series(0)}"></span><span style="flex:${split[2]};background:${series(2)}"></span>${split[0] + split[3] > 0 ? `<span style="flex:${split[0] + split[3]};background:${cssVar('--ghost')}"></span>` : ''}</div>
      <p class="share-legend"><span><i style="background:${series(0)}"></i>${n1} ${fmtKwh(split[1])}</span><span><i style="background:${series(2)}"></i>${n2} ${fmtKwh(split[2])}</span>${split[0] + split[3] > 0 ? `<span><i style="background:${cssVar('--ghost')}"></i>Sans détail ${fmtKwh(split[0] + split[3])}</span>` : ''}</p>
      <p class="hint muted">Détection automatique : la colonne où le chauffe-eau consomme le plus est considérée comme les heures creuses.</p></section>`
      : ''
  }
  ${
    tempRoom
      ? `<section class="card"><div class="card-head"><h2>Températures <small class="muted">°C, moyenne par jour</small></h2>
      <div class="controls"><label class="select"><span class="sr-only">Pièce</span><select data-set="tempRoom">${tempRooms
        .map((r) => `<option value="${esc(r.id)}" ${r.id === tempRoom ? 'selected' : ''}>${esc(r.name)}</option>`)
        .join('')}</select></label></div></div>
      <div class="chart" id="temp-chart" role="img" aria-label="Températures de la pièce"></div></section>`
      : ''
  }`;

  // signature
  if (ds!.weather) {
    const sig = signaturePoints(records, ds!.weather);
    const seasons = [...sig.keys()].sort().slice(-3);
    const rows: (string | number)[][] = [];
    scatterChart(document.getElementById('sig-chart')!, {
      xName: 'Température extérieure moyenne (°C)',
      yName: 'kWh / jour',
      series: seasons.map((s) => {
        const pts = sig.get(s)!;
        const fit = fitSeason(pts);
        if (fit) {
          rows.push([
            esc(s.replace('-', '–')),
            `${(-fit.slope).toFixed(2).replace('.', ',')} kWh/°C`,
            fit.balance !== null ? `${fit.balance.toFixed(1).replace('.', ',')} °C` : '—',
            fit.r2.toFixed(2).replace('.', ','),
          ]);
        }
        const xs = pts.map((p) => p[0]);
        return {
          name: s.replace('-', '–'),
          color: seasonColor(s, seasons),
          points: pts,
          fit: fit ? { slope: fit.slope, intercept: fit.intercept, from: Math.min(...xs), to: Math.min(15, fit.balance ?? 15) } : null,
        };
      }),
    });
    document.getElementById('sig-table')!.innerHTML = rows.length
      ? table(['Saison', 'Pente (kWh par °C en moins)', 'Plus de chauffe au-dessus de', 'Fiabilité (R²)'], rows.reverse())
      : '';
  }
  // calendar
  const perDay = new Map<string, number>();
  for (const r of records) if (r.day.startsWith(String(year))) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.kwh);
  const values = [...perDay.values()];
  const sorted = values.slice().sort((a, b) => a - b);
  calendarChart(document.getElementById('cal-chart')!, {
    year,
    data: [...perDay.entries()].map(([d, v]) => [d, Math.round(v * 10) / 10]),
    max: sorted[Math.floor(sorted.length * 0.97)] ?? 1, // ignore the few extreme days
  });
  // temperatures
  if (tempRoom) {
    const from = addDays(minusYears(last), 1);
    const days: string[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
    const t = ds!.temps.get(tempRoom)!;
    lineChart(document.getElementById('temp-chart')!, {
      labels: days.map((d) => bucketLabel(d, 'day')),
      series: [
        { name: 'Mesurée', color: series(0), data: days.map((d) => t.get(d)?.[0] ?? null) },
        { name: 'Consigne', color: series(3), data: days.map((d) => t.get(d)?.[1] ?? null) },
        ...(ds!.weather ? [{ name: 'Extérieure', color: cssVar('--text-muted'), data: days.map((d) => ds!.weather!.get(d)?.[2] ?? null) }] : []),
      ],
      price: null,
      unit: '°C',
    });
  }
  drawHourly(records);
}

function drawHourly(records: DayRecord[]) {
  const zone = document.getElementById('hourly-zone');
  if (!zone || !(ds!.meta.hourly_years ?? []).length) return;
  if (!hourly) {
    if (!hourlyLoading) {
      hourlyLoading = true;
      loadHourly(ds!)
        .then((h) => {
          hourly = h;
          hourlyLoading = false;
          if (state.view === 'analyse') render();
        })
        .catch(() => {
          hourlyLoading = false;
          zone.innerHTML = '<p class="hint muted">Données horaires indisponibles.</p>';
        });
    }
    return;
  }
  const last = lastDay();
  const from = addDays(last, -89);
  const rooms = new Set(records.map((r) => r.room));
  const grid = weekHourGrid(hourly, rooms, from, last);
  const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
  const dows = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  zone.innerHTML = `<div class="chart" id="hour-grid" style="height:280px" role="img" aria-label="Consommation moyenne par jour de semaine et par heure"></div>
    <div class="chart" id="hour-profile" style="height:240px" role="img" aria-label="Journée type"></div>`;
  gridHeatmap(document.getElementById('hour-grid')!, {
    xLabels: hours,
    yLabels: dows,
    data: grid.flatMap((row, y) => row.map((v, x) => [x, y, Math.round(v * 100) / 100] as [number, number, number])),
    unit: 'kWh',
  });
  const heatRooms = new Set(activeRooms().filter((r) => r.category === 'heating' && rooms.has(r.id)).map((r) => r.id));
  const waterRooms = new Set(activeRooms().filter((r) => r.category === 'water_heater' && rooms.has(r.id)).map((r) => r.id));
  lineChart(document.getElementById('hour-profile')!, {
    labels: hours,
    series: [
      ...(heatRooms.size ? [{ name: 'Chauffage', color: catColor('heating'), data: dayProfile(hourly, heatRooms, from, last).map((v) => Math.round(v * 100) / 100) }] : []),
      ...(waterRooms.size ? [{ name: 'Chauffe-eau', color: catColor('water_heater'), data: dayProfile(hourly, waterRooms, from, last).map((v) => Math.round(v * 100) / 100) }] : []),
    ],
    price: null,
  });
}

// ------------------------------------------------------------------ annual report (printable)
function renderReport(view: HTMLElement) {
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
  view.innerHTML = `
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
    <p class="hint muted">Rapport généré le ${longDate(new Date().toISOString().slice(0, 10))} par l'application Historique énergie. Données Intuis${ds!.weather ? ', météo ' + (ds!.meta.weather_source === 'netatmo' ? 'station Netatmo' : 'Open-Meteo') : ''}${ds!.linky.size ? ', compteur Linky' : ''}.</p>
  </section>`;
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
}

/** Average measured temperature and setpoint over Nov–Mar days of that year. */
function winterTemps(room: string, year: number): [number, number | null] | null {
  const t = ds!.temps.get(room);
  if (!t) return null;
  let s = 0, sp = 0, n = 0, nsp = 0;
  for (const [d, [m, c]] of t) {
    const mo = Number(d.slice(5, 7));
    if (!d.startsWith(String(year)) || (mo > 3 && mo < 11)) continue;
    (s += m), n++;
    if (c !== null) (sp += c), nsp++;
  }
  return n ? [s / n, nsp ? sp / nsp : null] : null;
}

function drawWaterfall(el: HTMLElement, deltas: Map<string, { now: number; before: number }>, year: number) {
  const rooms = activeRooms().filter((r) => deltas.has(r.id));
  const steps = rooms
    .map((r) => ({ name: r.name, delta: deltas.get(r.id)!.now - deltas.get(r.id)!.before }))
    .filter((s) => Math.abs(s.delta) >= 1)
    .sort((a, b) => b.delta - a.delta);
  const start = [...deltas.values()].reduce((s, d) => s + d.before, 0);
  waterfallChart(el, { startLabel: String(year - 1), endLabel: String(year), start, steps });
}

// ------------------------------------------------------------------ events (delegated)
app.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('button, [data-view]');
  if (!btn || !ds) return;
  if (btn.dataset.view) return setState({ view: btn.dataset.view as View });
  if (btn.dataset.set) return setState({ [btn.dataset.set]: btn.dataset.value } as Partial<State>);
  if (btn.dataset.year) {
    const y = Number(btn.dataset.year);
    const cur = new Set(state.compareYears);
    if (cur.has(y)) cur.delete(y);
    else cur.add(y);
    return setState({ compareYears: [...cur].sort() });
  }
  if (btn.dataset.rooms) {
    return setState({ rooms: btn.dataset.rooms === 'all' ? null : [] });
  }
  if (btn.dataset.focus !== undefined) return setState({ focusRoom: btn.dataset.focus || null });
  if (btn.id === 'print') return window.print();
  if (btn.id === 'export') {
    const blob = new Blob(['﻿' + toCsv(filtered(), ds.meta.rooms)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consommation-${lastDay()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  if (btn.id === 'lock') {
    if (ds.source === 'data') await forgetKeys();
    ds = null;
    start();
  }
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (!ds) return;
  if (t.dataset.set === 'period') return setState({ period: t.value });
  if (t.dataset.set === 'roomsYear') return setState({ roomsYear: Number(t.value), focusRoom: null });
  if (t.dataset.price) {
    const v = parseFloat(t.value.replace(',', '.'));
    setState({ prices: { ...state.prices, [t.dataset.price]: Number.isFinite(v) && v > 0 ? v : null } });
    document.querySelector<HTMLDetailsElement>('.menu')?.setAttribute('open', '');
    return;
  }
  if (t.dataset.toggle === 'climate') return setState({ climate: (t as HTMLInputElement).checked });
  if (t.dataset.set === 'analyseYear') return setState({ analyseYear: Number(t.value) });
  if (t.dataset.set === 'reportYear') return setState({ reportYear: Number(t.value) });
  if (t.dataset.set === 'tempRoom') return setState({ tempRoom: t.value });
  if (t instanceof HTMLInputElement && t.dataset.room) {
    const all = activeRooms().map((r) => r.id);
    const cur = new Set(state.rooms ?? all);
    if (t.checked) cur.add(t.dataset.room);
    else cur.delete(t.dataset.room);
    const rooms = all.filter((r) => cur.has(r));
    // keep the picker open across the re-render
    setState({ rooms: rooms.length === all.length ? null : rooms });
    document.querySelector<HTMLDetailsElement>('.rooms-picker')?.setAttribute('open', '');
  }
});

app.addEventListener('toggle', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('table-details')) state.showTables = (t as HTMLDetailsElement).open;
}, true);

// Redraw charts with the right colours when the OS theme flips.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => ds && render());

// ------------------------------------------------------------------ boot
async function start() {
  try {
    const key = await recallKey('data');
    if (key) {
      ds = await load('data', key);
      initDefaults();
      return render();
    }
    // Check whether real data exists to adapt the lock screen.
    const resp = await fetch('data/keyinfo.json', { cache: 'no-cache' });
    renderLock('', resp.ok);
  } catch (err) {
    if (err instanceof WrongPassphrase) await forgetKeys();
    renderLock(err instanceof NoData ? '' : '', !(err instanceof NoData));
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

start();
