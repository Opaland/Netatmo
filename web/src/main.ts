// Shell: header, tabs, menu and filters; view router; delegated events; boot.
// Each view lives in src/views/, shared helpers in src/ui.ts, state in src/app.ts.
import { CATEGORY_LABEL, toCsv } from './aggregate';
import { type State, type View, activeRooms, app, ds, onDatasetLoaded, setDataset, setRenderer, setState, state } from './app';
import { disposeAll } from './charts';
import { WrongPassphrase } from './crypto';
import { NoData, forgetKeys, load, recallKey } from './data';
import { IdleLock, LOCK_CHOICES, idleSince } from './session';
import { esc, filtered, keepMenuOpen, lastDay, longDate, roomColor, seg } from './ui';
import * as analyse from './views/analyse';
import * as compare from './views/compare';
import { renderLoading, renderLock } from './views/lock';
import * as overview from './views/overview';
import * as prices from './views/prices';
import * as report from './views/report';
import * as rooms from './views/rooms';
import * as settings from './views/settings';
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

function render() {
  if (!ds) return;
  disposeAll(app);
  const { meta } = ds;
  const tabs: [View, string][] = [
    ['overview', 'Synthèse'],
    ['compare', 'Comparer'],
    ['rooms', 'Pièces'],
    ['analyse', 'Analyse'],
    ['comfort', 'Confort'],
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
        ${prices.pricesForm()}
        <button type="button" data-view="report">${icon('report')} Rapport annuel imprimable</button>
        <button type="button" data-view="settings">${icon('settings')} Paramètres et connexions</button>
        <label class="check"><input type="checkbox" data-toggle="simple" ${state.simple ? 'checked' : ''}> Mode simple (grands caractères, l'essentiel)</label>
        <label class="lock-after">Verrouiller sans activité
          <select data-lock-after>${LOCK_CHOICES.map((m) => `<option value="${m}" ${m === state.lockAfter ? 'selected' : ''}>${m ? (m < 60 ? `après ${m} min` : `après ${m / 60} h`) : 'jamais sur cet appareil'}</option>`).join('')}</select>
        </label>
        <button type="button" id="export">Exporter en CSV (filtres appliqués)</button>
        <button type="button" id="backup" title="Tous les fichiers chiffrés en un seul, toujours chiffrés : à garder hors de GitHub">Télécharger une sauvegarde chiffrée</button>
        <button type="button" id="lock">${ds.source === 'demo' ? 'Quitter la démo' : 'Verrouiller'}</button>
      </div>
    </details>
  </header>
  ${staleBanner()}
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
  if (!records.length && state.view !== 'settings' && state.view !== 'comfort') {
    view.innerHTML = `<p class="empty">Aucune donnée pour cette sélection.</p>`;
  } else if (state.view === 'overview') overview.renderOverview(view, records);
  else if (state.view === 'compare') compare.renderCompare(view, records);
  else if (state.view === 'analyse') analyse.renderAnalyse(view, records);
  else if (state.view === 'comfort') renderComfort(view);
  else if (state.view === 'report') report.renderReport(view);
  else if (state.view === 'settings') settings.renderSettings(view);
  else rooms.renderRooms(view, records);
  document.body.classList.toggle('is-report', state.view === 'report' || state.view === 'settings');
  document.body.classList.toggle('is-comfort', state.view === 'comfort');
  document.body.classList.toggle('is-simple', state.simple && state.view === 'overview');
}
setRenderer(render);

// Comfort (S-11, S-3.8) is loaded on demand: its code stays out of the entry chunk.
let comfort: typeof import('./views/comfort') | null = null;
function renderComfort(view: HTMLElement) {
  if (comfort) return comfort.renderComfort(view);
  view.innerHTML = '<p class="empty">Chargement…</p>';
  import('./views/comfort')
    .then((m) => {
      comfort = m;
      if (state.view === 'comfort') render();
    })
    .catch(() => {
      view.innerHTML = '<p class="empty">Vue indisponible hors ligne : elle se chargera au prochain accès réseau.</p>';
    });
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
const clickHandlers = [compare.handleClick, rooms.handleClick, report.handleClick, settings.handleClick, prices.handleClick, comfortClick];
const changeHandlers = [overview.handleChange, rooms.handleChange, prices.handleChange, compare.handleChange, analyse.handleChange, report.handleChange, comfortChange];

app.addEventListener('submit', (e) => settings.handleSubmit(e));

app.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('button, [data-view]');
  if (!btn || !ds) return;
  if (btn.dataset.view) return setState({ view: btn.dataset.view as View });
  if (btn.dataset.set) return setState({ [btn.dataset.set]: btn.dataset.value } as Partial<State>);
  if (btn.dataset.rooms) {
    return setState({ rooms: btn.dataset.rooms === 'all' ? null : [] });
  }
  if (clickHandlers.some((h) => h(btn))) return;
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
  if (changeHandlers.some((h) => h(t))) return;
  if (t.dataset.lockAfter !== undefined) {
    setState({ lockAfter: Number(t.value) });
    idle.configure(state.lockAfter);
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
});

app.addEventListener('toggle', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('table-details')) state.showTables = (t as HTMLDetailsElement).open;
}, true);

// Redraw charts with the right colours when the OS theme flips.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => ds && render());

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
onDatasetLoaded(() => idle.start(state.lockAfter));

// ------------------------------------------------------------------ boot
async function start() {
  try {
    let key = await recallKey('data');
    // Away longer than the inactivity delay (tab closed, phone asleep): the key is forgotten.
    if (key && idleSince(state.lockAfter)) {
      await forgetKeys();
      key = null;
    }
    if (key) {
      renderLoading();
      setDataset(await load('data', key));
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
