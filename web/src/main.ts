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
import { type Series, barChart, cssVar, disposeAll, escapeHtml as esc, fmtKwh, hbarChart, lineChart } from './charts';
import { WrongPassphrase } from './crypto';
import { type Dataset, NoData, type Source, forgetKeys, load, recallKey, rememberKey, unlock } from './data';
import './style.css';

// ------------------------------------------------------------------ state
type View = 'overview' | 'compare' | 'rooms';
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
  price: number | null;
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
  price: null,
  showTables: false,
};

const LS_KEY = 'intuis-history:state';
function loadState(): State {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') };
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
const eur = (kwh: number) => (state.price ? `${nf0.format(kwh * state.price)} €` : '');
const SERIES_SLOTS = 8;
const series = (i: number) => cssVar(`--series-${(i % SERIES_SLOTS) + 1}`);
const catColor = (c: Category) => cssVar(c === 'water_heater' ? '--cat-water' : '--cat-heating');

function activeRooms() {
  return ds!.meta.rooms.filter((r) => r.category !== 'ignore');
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
  const years = ds!.meta.years;
  const valid = new Set(activeRooms().map((r) => r.id));
  const patch: Partial<State> = {};
  if (!state.compareYears.length || state.compareYears.some((y) => !years.includes(y))) patch.compareYears = years.slice(-3);
  if (!state.roomsYear || !years.includes(state.roomsYear)) patch.roomsYear = years[years.length - 1];
  if (state.rooms) patch.rooms = state.rooms.filter((r) => valid.has(r)).length ? state.rooms.filter((r) => valid.has(r)) : null;
  if (/^\d{4}$/.test(state.period) && !years.includes(Number(state.period))) patch.period = '12m';
  state = { ...state, ...patch };
}

// ------------------------------------------------------------------ shell
const ICONS = {
  overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  compare: '<path d="M3 17l5-5 4 3 8-8"/><path d="M3 21h18"/>',
  rooms: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
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
        <label>Prix du kWh (€)<input id="price" type="number" inputmode="decimal" step="0.0001" min="0" placeholder="ex. 0,2516" value="${state.price ?? ''}"></label>
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
  else renderRooms(view, records);
}

// ------------------------------------------------------------------ overview
function kpi(label: string, from: string, to: string, records: DayRecord[]) {
  const now = total(records, from, to);
  const before = total(records, minusYears(from), minusYears(to));
  const hasBefore = records.some((r) => r.day <= minusYears(to));
  return `<article class="kpi">
    <h3>${esc(label)}</h3>
    <p class="kpi-value">${fmtKwh(now)}</p>
    <p class="kpi-sub">${eur(now) ? `${eur(now)} · ` : ''}${hasBefore ? delta(now, before) : '<span class="delta neutral">pas de référence N-1</span>'}</p>
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
  <section class="kpis">
    ${kpi(`${MONTHS_LONG[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)} (au ${Number(last.slice(8, 10))})`, monthStart, last, records)}
    ${kpi(`Depuis le 1er janvier ${last.slice(0, 4)}`, yearStart, last, records)}
    ${kpi('12 derniers mois', addDays(minusYears(last), 1), last, records)}
  </section>
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
    <p class="period-total"><strong>${fmtKwh(periodTotal)}</strong> ${eur(periodTotal) ? `· ${eur(periodTotal)} ` : ''}du ${longDate(from)} au ${longDate(to)}</p>
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
  barChart(document.getElementById('main-chart')!, { labels, series: ser, stacked: true, price: state.price, zoom: labels.length > 60 });
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
      return [
        `<span class="swatch" style="background:${yearColor(y)}"></span>${y}${isCurrent ? ' <small class="muted">en cours</small>' : ''}`,
        full,
        heat,
        full - heat,
        ...(state.price ? [`${nf0.format(full * state.price)} €`] : []),
        d === null ? '—' : `${pct(d)}${isCurrent ? ' <small class="muted">à date</small>' : ''}`,
      ];
    });

  view.innerHTML = `
  <section class="card">
    <div class="card-head">
      <h2>Comparer les années <small class="muted">kWh</small></h2>
      <div class="controls">
        ${seg('compareMode', state.compareMode, [['monthly', 'Mois par mois'], ['cumul', 'Cumul annuel'], ['season', 'Saison de chauffe']], 'Mode')}
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
    }</p>
    <div class="chart tall" id="cmp-chart" role="img" aria-label="Comparaison des années"></div>
    <div id="cmp-table"></div>
  </section>
  <section class="card">
    <h2>Totaux annuels</h2>
    ${table(['Année', 'Total kWh', 'Chauffage', 'Chauffe-eau', ...(state.price ? ['Coût'] : []), 'Évolution'], rows)}
    <p class="hint muted">L'évolution de l'année en cours est calculée à date : du 1er janvier au ${Number(last.slice(8, 10))} ${MONTHS_LONG[Number(last.slice(5, 7)) - 1]} des deux années.</p>
  </section>`;

  const el = document.getElementById('cmp-chart')!;
  let ser: Series[] = [];
  let labels: string[] = [];
  if (state.compareMode === 'monthly') {
    const m = monthlyByYear(records);
    labels = MONTHS_SHORT;
    ser = selected.map((y) => ({ name: String(y), color: yearColor(y), data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) }));
    barChart(el, { labels, series: ser, stacked: false, price: state.price });
  } else if (state.compareMode === 'cumul') {
    const c = cumulativeByYear(records, last);
    labels = Array.from({ length: 366 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)); // leap year: 366 labels
      return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
    });
    ser = selected.map((y) => ({ name: String(y), color: yearColor(y), data: (c.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) }));
    lineChart(el, { labels, series: ser, price: state.price, emphasize: String(lastYear) });
  } else {
    const s = monthlyBySeason(records);
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
    lineChart(el, { labels, series: ser, price: state.price });
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
      ['Pièce', 'kWh', 'Part', `${year - 1}`, 'Évolution'],
      sorted.map((r) => {
        const v = now.get(r.id) ?? 0;
        const b = before.get(r.id) ?? 0;
        const d = pctChange(v, b);
        return [
          `<button type="button" class="link" data-focus="${esc(r.id)}"><span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)}</button> <small class="muted">${CATEGORY_LABEL[r.category]}</small>`,
          v,
          sum ? `${nf0.format((v / sum) * 100)} %` : '—',
          b,
          d === null ? '—' : pct(d),
        ];
      }),
    )}
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
    price: state.price,
    onClick: (i) => setState({ focusRoom: sorted[i].id }),
  });
  if (focus) {
    const m = monthlyByYear(records.filter((r) => r.room === focus));
    const shown = years.filter((y) => y >= year - 2 && y <= year);
    barChart(document.getElementById('room-detail')!, {
      labels: MONTHS_SHORT,
      series: shown.map((y) => ({ name: String(y), color: yearColor(y), data: (m.get(y) ?? []).map((v) => (v === null ? null : Math.round(v))) })),
      stacked: false,
      price: state.price,
    });
  }
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
  if (t.id === 'price') {
    const v = parseFloat(t.value.replace(',', '.'));
    return setState({ price: Number.isFinite(v) && v > 0 ? v : null });
  }
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
