// Shell: header, tabs, menu and filters; view router; delegated events; boot.
// Each view lives in src/views/, shared helpers in src/ui.ts, state in src/app.ts.
import { CATEGORY_LABEL, toCsv } from './aggregate';
import { type State, type View, activeRooms, app, ds, onDatasetOpened, onLock, setDataset, setRenderer, setState, state } from './app';
import { disposeAll } from './charts';
import { BadEnvelope, WrongPassphrase } from './crypto';
import { type Dataset, NoData, clearDataCaches, forgetKeys, load, recallKey } from './data';
import { lazyAction, lazyCard } from './lazy';
import { clearMemo } from './memo';
import { framedHtml, isFramed } from './frame';
import { prefetchForOffline, unavailable, updateNetStatus } from './offline';
import { IdleLock, LOCK_CHOICES, REMEMBER_DAYS, idleSince } from './session';
import { isIos, keyLoss, lossMessage, readMark, writeMark } from './storage';
import { type SwipeDir, onSwipe, step } from './swipe';
import { esc, filtered, keepMenuOpen, lastDay, longDate, roomColor, seg } from './ui';
import * as analyse from './views/analyse';
import * as compare from './views/compare';
import * as household from './views/household';
import { renderLoading, renderLock, showApp } from './views/lock';
import * as overview from './views/overview';
import { pinSelect, pinnedTiles } from './views/pinned';
import { toggleTerm } from './plain';
import * as prices from './views/prices';
import * as report from './views/report';
import * as rooms from './views/rooms';
import * as settings from './views/settings';
import { html } from './trusted';
import './style.css';

// ------------------------------------------------------------------ shell
const ICONS = {
  overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  compare: '<path d="M3 17l5-5 4 3 8-8"/><path d="M3 21h18"/>',
  rooms: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  comfort: '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/><path d="M11.5 9v8"/>',
  analyse: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 13l2-3 2 2 2-4"/>',
  report: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
};
const icon = (name: keyof typeof ICONS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const TABS: [View, string][] = [
  ['overview', 'Synthèse'],
  ['compare', 'Comparer'],
  ['rooms', 'Pièces'],
  ['analyse', 'Analyse'],
  ['comfort', 'Confort'],
];

let slide: SwipeDir | null = null;
/** #256: set while a menu setting that only the view uses is applied (prices, lock delay, pinned room). */
let viewOnly = false;

/** Selector finding the focused control again after a re-render: its id, else its data-* attributes. */
function focusSelector(el: Element | null): string | null {
  if (!el || el === document.body || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const data = [...el.attributes].filter((a) => a.name.startsWith('data-'));
  if (!data.length) return null;
  return `${el.tagName.toLowerCase()}${data.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('')}`;
}

function render() {
  if (!ds) return;
  const view = document.getElementById('view');
  if (viewOnly && view) {
    // The header, the menu and the filters stay as they are: the focus and the field being
    // typed in are kept, and Tab goes on to the next field of the menu.
    viewOnly = false;
    disposeAll(view);
    return renderView(view);
  }
  viewOnly = false;
  const focus = focusSelector(document.activeElement);
  disposeAll(app);
  const { meta } = ds;
  const tabs = TABS;
  const roomsCount = state.rooms ? state.rooms.length : activeRooms().length;
  app.innerHTML = html`
  <header class="top" data-swipe="${state.view === 'overview' ? 'period' : 'tab'}">
    <div class="title">
      <h1>${esc(meta.home.name)}${ds.source === 'demo' ? ' <span class="badge">démo</span>' : ''}</h1>
      <p class="muted">Données jusqu'au ${meta.last_day ? longDate(meta.last_day) : '—'}</p>
    </div>
    <nav class="tabs" aria-label="Vues" data-swipe="tab">
      ${tabs.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${state.view === v ? 'page' : 'false'}">${icon(v)}<span>${l}</span></button>`).join('')}
    </nav>
    <details class="menu">
      <summary aria-label="Menu">${icon('menu')}</summary>
      <div class="menu-panel">
        ${prices.pricesForm()}
        <button type="button" data-view="report">${icon('report')} Rapport annuel imprimable</button>
        <button type="button" data-view="settings">${icon('settings')} Paramètres et connexions</button>
        ${household.householdMenu()}
        <label class="check"><input type="checkbox" data-toggle="simple" ${state.simple ? 'checked' : ''}> Mode simple (grands caractères, phrases courtes)</label>
        ${pinSelect()}
        <label class="lock-after">Verrouiller sans activité
          <select data-lock-after>${LOCK_CHOICES.map((m) => `<option value="${m}" ${m === state.lockAfter ? 'selected' : ''}>${m ? (m < 60 ? `après ${m} min` : `après ${m / 60} h`) : 'jamais sur cet appareil'}</option>`).join('')}</select>
        </label>
        <button type="button" id="export">Exporter en CSV (filtres appliqués)</button>
        <button type="button" data-export-long="csv" title="Format long documenté (docs/export-long.md), tout l'historique, préparé sur cet appareil">Export long (CSV)</button>
        <button type="button" data-export-long="json" title="Même contenu en JSON, conforme au schéma docs/export-long.schema.json">Export long (JSON)</button>
        <button type="button" data-research title="Horaire, pièces pseudonymisées, dates décalées, licence au choix (docs/export-recherche.md)">Export recherche (anonymisé)</button>
        <button type="button" id="backup" title="Tous les fichiers chiffrés en un seul, toujours chiffrés : à garder hors de GitHub">Télécharger une sauvegarde chiffrée</button>
        <button type="button" id="lock">${ds.source === 'demo' ? 'Quitter la démo' : 'Verrouiller'}</button>
      </div>
    </details>
  </header>
  ${staleBanner()}
  <p class="offline" id="net-status" role="status" hidden></p>
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
  renderView(document.getElementById('view')!);
  // #256: give the focus back to the control that had it (after the handler reopened its menu).
  if (focus) {
    queueMicrotask(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      app.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
    });
  }
}

function renderView(view: HTMLElement) {
  const records = filtered();
  if (!records.length && state.view !== 'settings' && state.view !== 'comfort') {
    view.innerHTML = html`<p class="empty">Aucune donnée pour cette sélection.</p>`;
  } else if (state.view === 'overview') overview.renderOverview(view, records);
  else if (state.view === 'compare') compare.renderCompare(view, records);
  else if (state.view === 'analyse') analyse.renderAnalyse(view, records);
  else if (state.view === 'comfort') renderComfort(view);
  else if (state.view === 'report') report.renderReport(view);
  else if (state.view === 'settings') settings.renderSettings(view);
  else rooms.renderRooms(view, records);
  // S-7.8: the pinned room comes first among the key figures of the simple mode.
  if (state.simple && state.view === 'overview') view.querySelector('.kpis')?.insertAdjacentHTML('afterbegin', html(pinnedTiles()));
  if (slide) view.classList.add(`slide-${slide}`);
  slide = null;
  void updateNetStatus(ds);
  document.body.classList.toggle('is-report', state.view === 'report' || state.view === 'settings');
  document.body.classList.toggle('is-comfort', state.view === 'comfort');
  document.body.classList.toggle('is-simple', state.simple && state.view === 'overview');
}
setRenderer(render);

// Comfort (S-11, S-3.8) is loaded on demand: its code stays out of the entry chunk.
let comfort: typeof import('./views/comfort') | null = null;
function renderComfort(view: HTMLElement) {
  if (comfort) return comfort.renderComfort(view);
  view.innerHTML = html('<p class="empty">Chargement…</p>');
  void lazyCard(
    () => import('./views/comfort'),
    (m) => {
      comfort = m;
      if (state.view === 'comfort') render();
    },
    { zone: view, what: 'Vue Confort' },
  );
}

/** S-1.5: warn when the archive stopped moving (collection broken or Intuis late). */
function staleBanner() {
  const last = ds!.meta.last_day;
  if (!last || ds!.source === 'demo') return '';
  const days = Math.floor((Date.now() - Date.parse(`${last}T12:00:00Z`)) / 86400000);
  if (days <= 3) return '';
  return `<p class="stale" role="alert"><span aria-hidden="true">⚠️</span> Données arrêtées au ${longDate(last)} (il y a ${days} jours) : la collecte est peut-être en panne. Une alerte est ouverte dans les issues GitHub du dépôt ; vous pouvez aussi la relancer depuis Paramètres.</p>`;
}

// ------------------------------------------------------------------ events (delegated)
/** View-specific handlers: each returns true when the event was its own. */
const comfortClick = (btn: HTMLElement) => comfort?.handleClick(btn) ?? false;
const comfortChange = (t: HTMLInputElement | HTMLSelectElement) => comfort?.handleChange(t) ?? false;
const clickHandlers = [compare.handleClick, rooms.handleClick, report.handleClick, settings.handleClick, prices.handleClick, comfortClick, household.handleClick];
const changeHandlers = [overview.handleChange, rooms.handleChange, prices.handleChange, compare.handleChange, analyse.handleChange, report.handleChange, comfortChange, household.handleChange];

app.addEventListener('keydown', (e) => settings.handleKeydown(e));

app.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('button, [data-view]');
  if (!btn || !ds) return;
  if (btn.dataset.view) return setState({ view: btn.dataset.view as View });
  if (btn.dataset.set) return setState({ [btn.dataset.set]: btn.dataset.value } as Partial<State>);
  if (btn.dataset.rooms) {
    return setState({ rooms: btn.dataset.rooms === 'all' ? null : [] });
  }
  // S-7.13: a glossary term of the simple mode shows its definition (and reads it aloud).
  if (btn.dataset.term) {
    const def = toggleTerm(btn);
    if (def) announce(def);
    return;
  }
  if (clickHandlers.some((h) => h(btn))) return;
  // S-9.7: long export, built locally from the decrypted data (lazy module)
  // S-6.6: anonymised research dataset (lazy dialog)
  if (btn.dataset.research !== undefined) return void lazyAction(btn, () => import('./views/research'), (m) => m.openResearch(), 'Export recherche');
  if (btn.dataset.exportLong) {
    const d = ds;
    return void lazyAction(btn, () => import('./export'), (m) => m.downloadLong(d, btn.dataset.exportLong as 'csv' | 'json'), 'Export long');
  }
  if (btn.id === 'export') {
    const blob = new Blob(['﻿' + toCsv(filtered(), ds.meta.rooms)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consommation-${lastDay()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  if (btn.id === 'backup') {
    // S-1.15: lazy module, the envelopes are copied as served (never decrypted).
    const label = btn.textContent;
    btn.textContent = 'Sauvegarde en cours…';
    try {
      const { downloadBackup } = await import('./backup');
      const n = await downloadBackup(ds.source, ds.meta);
      btn.textContent = `Sauvegarde téléchargée (${n} fichiers)`;
    } catch (err) {
      btn.textContent = `Sauvegarde impossible : ${err instanceof Error ? err.message : err}`;
    }
    setTimeout(() => (btn.textContent = label), 4000);
  }
  if (btn.id === 'lock') await lockApp();
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (!ds) return;
  // #256: a price, the lock delay or the pinned room leave the menu as it is (only the view is redrawn).
  viewOnly = !!t.closest('.menu') && (t.dataset.price !== undefined || t.dataset.lockAfter !== undefined || t.dataset.pin !== undefined);
  try {
    onChange(t);
  } finally {
    viewOnly = false;
  }
});

function onChange(t: HTMLInputElement | HTMLSelectElement) {
  if (changeHandlers.some((h) => h(t))) return;
  if (t.dataset.lockAfter !== undefined) {
    setState({ lockAfter: Number(t.value) });
    idle.configure(state.lockAfter);
    return keepMenuOpen();
  }
  if (t.dataset.pin !== undefined) {
    setState({ pinnedRoom: t.value || null });
    return keepMenuOpen();
  }
  if (t.dataset.toggle === 'simple') return setState({ simple: (t as HTMLInputElement).checked, view: 'overview' });
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
}

app.addEventListener('toggle', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('table-details')) state.showTables = (t as HTMLDetailsElement).open;
}, true);

// Redraw charts with the right colours (and patterns) when the OS theme or contrast flips.
for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(forced-colors: active)']) {
  window.matchMedia(q).addEventListener('change', () => ds && render());
}

// S-7.6: Escape closes an open menu or room picker and gives the focus back to its button.
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open =
    (e.target as HTMLElement).closest<HTMLDetailsElement>('details[open]') ??
    app.querySelector<HTMLDetailsElement>('details.menu[open], details.rooms-picker[open]');
  if (!open) return;
  open.open = false;
  open.querySelector<HTMLElement>('summary')?.focus();
});

// ------------------------------------------------------------------ swipe (S-7.11)
/** Period choices of the overview, in the order of its select: recent → older → all. */
function periods(): string[] {
  return ['30d', '12m', ...ds!.meta.years.map(String).reverse(), 'all'];
}
const PERIOD_LABEL: Record<string, string> = { '30d': '30 derniers jours', '12m': '12 derniers mois', all: "tout l'historique" };

/** Polite announcement for screen readers (the live region sits outside #app, never re-rendered). */
function announce(msg: string) {
  const el = document.getElementById('sr-status');
  if (el) el.textContent = msg;
}

onSwipe(app, (zone, dir) => {
  if (!ds || state.simple) return;
  if (zone === 'period' && state.view === 'overview') {
    // Swipe right goes back in time (older period), swipe left towards the present.
    const next = step(periods(), state.period, dir === 'right' ? 1 : -1);
    if (!next) return;
    slide = dir;
    setState({ period: next });
    return announce(`Période : ${PERIOD_LABEL[next] ?? next}`);
  }
  if (zone === 'tab') {
    const next = step(
      TABS.map(([v]) => v),
      state.view,
      dir === 'left' ? 1 : -1,
    );
    if (!next) return;
    slide = dir;
    setState({ view: next });
    announce(`Vue : ${TABS.find(([v]) => v === next)![1]}`);
  }
});

window.addEventListener('online', () => void updateNetStatus(ds));
window.addEventListener('offline', () => void updateNetStatus(ds));

// ------------------------------------------------------------------ lock (S-8.11)
/** Forget the decrypted data, the remembered key and the GitHub token, then show the lock screen. */
async function lockApp() {
  idle.stop();
  settings.forgetToken();
  if (ds?.source !== 'demo') await forgetKeys();
  setDataset(null);
  await start();
}
const idle = new IdleLock(() => void lockApp());
// #255: once per decrypted dataset, not when the household view is toggled.
onDatasetOpened(() => idle.start(state.lockAfter));
onDatasetOpened(() => prefetchForOffline(ds!));
// #232: the decrypted documents and what was computed from them are forgotten on lock.
onLock(clearDataCaches);
onLock(clearMemo);

// ------------------------------------------------------------------ boot
async function start() {
  // #237: inside another page's frame, no screen at all (clickjacking), only a way out.
  if (isFramed()) {
    app.innerHTML = html(framedHtml(location.href));
    return;
  }
  // #250: loading (decryption) and rendering fail for different reasons: a decryption error
  // is explained on the lock screen, a rendering error (a bug) gets its own error screen.
  let opened: Dataset;
  try {
    let key = await recallKey('data');
    // Away longer than the inactivity delay (tab closed, phone asleep): the key is forgotten.
    if (key && idleSince(state.lockAfter)) {
      await forgetKeys();
      key = null;
    }
    if (!key) return await showLockScreen();
    renderLoading();
    opened = await load('data', key);
  } catch (err) {
    if (err instanceof WrongPassphrase) await forgetKeys();
    renderLock(startError(err), !(err instanceof NoData));
    return;
  }
  setDataset(opened);
  showApp();
}

/** Lock screen, adapted to whether real data exists and to a key lost since the last visit. */
async function showLockScreen() {
  // S-7.9: a key remembered here but gone (erased by iOS / the browser, or expired).
  const mark = readMark();
  const loss = mark?.source === 'data' ? keyLoss(mark, false, Date.now(), REMEMBER_DAYS) : null;
  if (mark) writeMark(null);
  // Check whether real data exists to adapt the lock screen.
  let resp: Response;
  try {
    resp = await fetch('data/keyinfo.json', { cache: 'no-cache' });
  } catch {
    // Offline, never cached: the form stays (the passphrase may work once online), with a word.
    return renderLock(navigator.onLine ? '' : unavailable('Données'), true);
  }
  renderLock('', resp.ok, resp.ok ? lossMessage(loss, isIos(navigator.userAgent, navigator.maxTouchPoints)) : '');
}

/** #250: why the remembered key did not open the data, in words. */
function startError(err: unknown): string {
  if (err instanceof WrongPassphrase) return 'La clé mémorisée ne déchiffre plus les données (phrase de passe changée ?) : saisissez la phrase de passe.';
  if (err instanceof NoData) return ''; // the lock screen already says that nothing was collected
  if (err instanceof BadEnvelope) return err.message;
  if (!navigator.onLine) return unavailable('Données');
  return `Ouverture impossible : ${err instanceof Error ? err.message : String(err)}`;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

start();
