// Shell (#308): header (home name, data-status pill, ⚙), tab bar, sub-page bar with its back
// arrow; hash routing (router.ts) and Back; one event delegation (#257) that calls the handlers
// of the page shown (pages.ts) then those of the cards loaded on demand (events.ts); boot.
// Each view lives in src/views/, shared helpers in src/ui.ts, state in src/app.ts.
import { toCsv } from './aggregate';
import { type State, activeRooms, app, ds, onDatasetOpened, onLock, setDataset, setRenderer, setState, state } from './app';
import { disposeAll } from './charts';
import { BadEnvelope, WrongPassphrase } from './crypto';
import { type Dataset, NoData, clearDataCaches, forgetKeys, load, recallKey } from './data';
import { type Ctl, cardHandlers, dispatch } from './events';
import { lazyAction } from './lazy';
import { clearMemo } from './memo';
import { viewRendered } from './ready';
import { framedHtml, isFramed } from './frame';
import { prefetchForOffline, unavailable, updateNetStatus } from './offline';
import { PAGES, dataStatus } from './pages';
import { type Route, allowed, parentOf, parseRoute, routeKey, simpleTabs, tabOf, titleOf, visibleTabs } from './router';
import { IdleLock, REMEMBER_DAYS, clearLockNotice, idleSince, lockNotice, markIdleLock } from './session';
import { isIos, keyLoss, lossMessage, readMark, writeMark } from './storage';
import { type SwipeDir, onSwipe, step } from './swipe';
import { HOME_PERIODS, homePeriod } from './home';
import { tenant } from './tenant';
import { downloadBlob, esc, filtered, lastDay, roomName } from './ui';
import { renderLoading, renderLock, showApp } from './views/lock';
import { toggleTerm } from './plain';
import * as settings from './views/settings';
import { html } from './trusted';
import './style.css';

// ------------------------------------------------------------------ icons
const ICONS: Record<string, string> = {
  accueil: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  pieces: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  historique: '<path d="M3 17l5-5 4 3 8-8"/><path d="M3 21h18"/>',
  compteur: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M8 5l-1-2M16 5l1-2"/>',
  outils: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  piece: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/>',
  aide: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
};
const icon = (name: string) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

// ------------------------------------------------------------------ routing (#308)
/** Current route: the address bar first, else the last page shown (remembered), else Accueil. */
function currentRoute(): Route {
  const r = parseRoute(state.view) ?? { page: 'accueil' };
  return allowed(r, tenant().on);
}

/** History depth of the entry shown: the back arrow goes back only to a page of the app. */
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0;

/** Go to a page: a new history entry (Back returns), the page remembered. */
export function navigate(key: string, replace = false) {
  const r = parseRoute(key);
  if (!r) return;
  const k = routeKey(allowed(r, tenant().on));
  if (replace) history.replaceState({ depth: depth() }, '', `#${k}`);
  else if (`#${k}` !== location.hash) history.pushState({ depth: depth() + 1 }, '', `#${k}`);
  if (k !== state.view) setState({ view: k });
}

/** The address changed (Back, Forward, a typed or shared address): show its page. */
function syncRoute() {
  if (!ds) return;
  const r = parseRoute(location.hash);
  if (!r) return; // an anchor of the page, not a route
  const k = routeKey(allowed(r, tenant().on));
  if (k !== state.view) setState({ view: k });
}
window.addEventListener('popstate', syncRoute);
window.addEventListener('hashchange', syncRoute);

let slide: SwipeDir | null = null;
let shownRoute: string | null = null;

/** Selector finding the focused control again after a re-render: its id, else its data-* attributes. */
function focusSelector(el: Element | null): string | null {
  if (!el || el === document.body || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const data = [...el.attributes].filter((a) => a.name.startsWith('data-'));
  if (!data.length) return null;
  return `${el.tagName.toLowerCase()}${data.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('')}`;
}

/** #309: theme of this device ([data-theme] on <html>, read by styles/tokens.css). */
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'light' || state.theme === 'dark') root.dataset.theme = state.theme;
  else delete root.dataset.theme;
}

// ------------------------------------------------------------------ shell
function render() {
  if (!ds) return;
  applyTheme();
  const route = currentRoute();
  const key = routeKey(route);
  // the address bar follows the page (first render, or a page reached without a link)
  if (location.hash !== `#${key}`) history.replaceState({ depth: depth() }, '', `#${key}`);
  const changed = shownRoute !== null && shownRoute !== key;
  const focus = changed ? null : focusSelector(document.activeElement);
  const keepTab = changed && (document.activeElement as HTMLElement | null)?.closest?.('.tabs') ? focusSelector(document.activeElement) : null;
  disposeAll(app);
  const { meta } = ds;
  const tab = tabOf(route);
  const parent = parentOf(route);
  const tabs = state.simple ? simpleTabs(state.pinnedRoom) : visibleTabs(tenant().on);
  const s = dataStatus();
  const title = titleOf(route, roomName);
  const sub = parent !== null && !(state.simple && route.page === 'piece' && route.room === state.pinnedRoom);
  const isOn = (k: string) => (state.simple ? k === key || (k === 'pieces' && route.page === 'piece') : k === tab);
  app.innerHTML = html`
  <header class="top" data-swipe="${route.page === 'accueil' ? 'period' : 'tab'}">
    <div class="title">
      <h1>${esc(meta.home.name)}${ds.source === 'demo' ? ' <span class="badge">démo</span>' : ''}</h1>
    </div>
    <a class="status-pill ${s.level}" href="#etat" data-view="etat" title="État des données"><span class="dot" aria-hidden="true"></span>${esc(s.label)}<span class="sr-only"> : ${s.level === 'ok' ? 'à jour' : 'en retard'}, voir l'état des données</span></a>
    <a class="icon-btn" href="#parametres" data-view="parametres" aria-label="Paramètres"${route.page === 'parametres' ? ' aria-current="page"' : ''}>${icon('settings')}</a>
  </header>
  <nav class="tabs${tabs.length === 3 ? ' three' : ''}" aria-label="Onglets" data-swipe="tab">
    ${tabs
      .map(
        ([k, l]) =>
          `<a href="#${k}" data-view="${k}"${isOn(k) ? ' aria-current="page"' : ''}>${icon(state.simple && k.startsWith('piece') ? 'piece' : state.simple && k === 'aide' ? 'aide' : k)}<span>${esc(l)}</span></a>`,
      )
      .join('')}
  </nav>
  ${s.level !== 'ok' ? `<p class="stale" role="alert"><span aria-hidden="true">⚠️</span> Données arrêtées au ${esc(s.label.replace('Données du ', ''))} (il y a ${s.days} jours) : la collecte est peut-être en panne. <a href="#etat">Voir pourquoi</a></p>` : ''}
  <p class="offline" id="net-status" role="status" hidden></p>
  ${
    sub
      ? `<div class="subhead"><a class="back" href="#${parent}" data-back aria-label="Retour">${icon('back')}</a><h2 id="page-title" tabindex="-1">${esc(title)}</h2></div>`
      : ''
  }
  <main id="view" data-page="${esc(key)}"></main>`;
  renderView(document.getElementById('view')!, route);
  shownRoute = key;
  if (changed) {
    window.scrollTo(0, 0);
    // a sub-page announces itself: its title takes the focus; a tab keeps it on the tab bar
    queueMicrotask(() => {
      const t = keepTab ? app.querySelector<HTMLElement>(keepTab) : app.querySelector<HTMLElement>('#page-title');
      t?.focus({ preventScroll: true });
    });
  } else if (focus) {
    // #256: give the focus back to the control that had it (the page was redrawn around it).
    queueMicrotask(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      app.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
    });
  }
}

function renderView(view: HTMLElement, route: Route) {
  const page = PAGES[route.page];
  if (page.needsData && !filtered().length) view.innerHTML = html`<p class="empty">Aucune donnée pour cette sélection. <button type="button" class="link" data-filter-reset>Tout afficher</button></p>`;
  else page.render(view, route);
  if (slide) view.classList.add(`slide-${slide}`);
  slide = null;
  void updateNetStatus(ds);
  document.body.classList.toggle('is-report', route.page === 'rapport' || route.page === 'parametres');
  document.body.classList.toggle('is-simple', state.simple && route.page === 'accueil');
  document.body.classList.toggle('simple-nav', state.simple);
  viewRendered(); // #260: #view[data-ready] once its lazy cards and documents have settled
}

// #256: a value typed in a field is saved on change (Tab, Enter): the page is redrawn once the
// focus has moved on, so that it lands on the next field again (found by its id or data-*).
let deferred = false;
let pending = false;
setRenderer(() => {
  if (!deferred) return render();
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    render();
  });
});

// ------------------------------------------------------------------ events (#257: one delegation)
const pageHandlers = () => PAGES[currentRoute().page].handlers ?? [];

/** Clicks of the shell itself: navigation, segments, filters, glossary, exports, lock. */
async function shellClick(el: HTMLElement, e: MouseEvent): Promise<boolean> {
  // a link to a page of the app: a history entry of its own (Back returns here)
  const a = el.closest<HTMLAnchorElement>('a[href^="#"]');
  if (a) {
    const href = a.getAttribute('href')!;
    if (!parseRoute(href)) return false; // an anchor in the page
    e.preventDefault();
    if (a.dataset.back !== undefined && depth() > 0) history.back();
    else navigate(href.slice(1), a.dataset.back !== undefined);
    return true;
  }
  if (el.dataset.view) {
    navigate(el.dataset.view);
    return true;
  }
  if (el.dataset.set) {
    setState({ [el.dataset.set]: el.dataset.value } as Partial<State>);
    return true;
  }
  if (el.dataset.rooms) {
    setState({ rooms: el.dataset.rooms === 'all' ? null : [] });
    document.querySelector<HTMLDetailsElement>('.rooms-picker')?.setAttribute('open', '');
    return true;
  }
  if (el.dataset.filterReset !== undefined) {
    setState({ cat: 'all', rooms: null });
    return true;
  }
  if (el.dataset.simpleExit) {
    // #316: leaving the simple view is confirmed in the page (no blocking dialog)
    const box = el.closest('.simple-exit');
    const confirm = box?.querySelector<HTMLElement>('.simple-confirm');
    if (el.dataset.simpleExit === 'ask' && confirm) {
      confirm.hidden = false;
      confirm.querySelector<HTMLElement>('[data-simple-exit=yes]')?.focus();
    } else if (el.dataset.simpleExit === 'no' && confirm) {
      confirm.hidden = true;
      box?.querySelector<HTMLElement>('[data-simple-exit=ask]')?.focus();
    } else if (el.dataset.simpleExit === 'yes') {
      setState({ simple: false });
      navigate('accueil');
    }
    return true;
  }
  // S-7.13: a glossary term of the simple mode shows its definition (and reads it aloud).
  if (el.dataset.term) {
    const def = toggleTerm(el);
    if (def) announce(def);
    return true;
  }
  if (!ds) return false;
  // S-9.7: long export, built locally from the decrypted data (lazy module)
  // S-6.6: anonymised research dataset (lazy dialog)
  if (el.dataset.research !== undefined) {
    void lazyAction(el, () => import('./views/research'), (m) => m.openResearch(), 'Export recherche');
    return true;
  }
  if (el.dataset.exportLong) {
    const d = ds;
    void lazyAction(el, () => import('./export'), (m) => m.downloadLong(d, el.dataset.exportLong as 'csv' | 'json'), 'Export long');
    return true;
  }
  if (el.id === 'export') {
    downloadBlob(new Blob(['﻿' + toCsv(filtered(), ds.meta.rooms)], { type: 'text/csv;charset=utf-8' }), `consommation-${lastDay()}.csv`);
    return true;
  }
  if (el.id === 'backup') {
    // S-1.15: lazy module, the envelopes are copied as served (never decrypted).
    const label = el.textContent;
    el.textContent = 'Sauvegarde en cours…';
    try {
      const { downloadBackup } = await import('./backup');
      const n = await downloadBackup(ds.source, ds.meta);
      el.textContent = `Sauvegarde téléchargée (${n} fichiers)`;
    } catch (err) {
      el.textContent = `Sauvegarde impossible : ${err instanceof Error ? err.message : err}`;
    }
    setTimeout(() => (el.textContent = label), 4000);
    return true;
  }
  if (el.id === 'lock') {
    await lockApp();
    return true;
  }
  return false;
}

/** Changes of the shell: room selection, simple view, lock delay, pinned room, threshold. */
function shellChange(t: Ctl): boolean {
  if (t.dataset.lockAfter !== undefined) {
    setState({ lockAfter: Number(t.value) });
    idle.configure(state.lockAfter);
    return true;
  }
  if (t.dataset.pin !== undefined) {
    setState({ pinnedRoom: t.value || null });
    return true;
  }
  if (t.dataset.threshold !== undefined) {
    setState({ comfortThreshold: Number(t.value) });
    return true;
  }
  if (t.dataset.toggle === 'simple') {
    setState({ simple: (t as HTMLInputElement).checked });
    return true;
  }
  if (t instanceof HTMLInputElement && t.dataset.room) {
    const all = activeRooms().map((r) => r.id);
    const cur = new Set(state.rooms ?? all);
    if (t.checked) cur.add(t.dataset.room);
    else cur.delete(t.dataset.room);
    const rooms = all.filter((r) => cur.has(r));
    setState({ rooms: rooms.length === all.length ? null : rooms });
    // keep the picker open across the re-render
    document.querySelector<HTMLDetailsElement>('.rooms-picker')?.setAttribute('open', '');
    return true;
  }
  return false;
}

app.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button, a, [data-view]');
  if (!el || !ds) return;
  if (await shellClick(el, e)) return;
  dispatch([...pageHandlers(), ...cardHandlers()], 'click', el, e);
});

/** A text-like field (not a box, a radio or a list): its change comes with a move of the focus. */
const typed = (t: Ctl) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'file'].includes(t.type));

app.addEventListener('change', (e) => {
  const t = e.target as Ctl;
  if (!ds) return;
  deferred = typed(t);
  if (deferred) viewRendered(); // not ready until the deferred redraw (#260)
  try {
    if (shellChange(t)) return;
    dispatch([...pageHandlers(), ...cardHandlers()], 'change', t, e);
  } finally {
    deferred = false;
  }
});
app.addEventListener('input', (e) => ds && dispatch([...pageHandlers(), ...cardHandlers()], 'input', e.target, e));
app.addEventListener('submit', (e) => ds && dispatch([...pageHandlers(), ...cardHandlers()], 'submit', e.target, e));

app.addEventListener('toggle', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('table-details')) state.showTables = (t as HTMLDetailsElement).open;
}, true);

// Redraw charts with the right colours (and patterns) when the OS theme or contrast flips.
for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(forced-colors: active)']) {
  window.matchMedia(q).addEventListener('change', () => ds && render());
}

app.addEventListener('keydown', (e) => {
  if (dispatch([...pageHandlers(), ...cardHandlers()], 'keydown', e)) return;
  // S-7.6: Escape closes an open fold (room picker…) and gives the focus back to its summary;
  // on a sub-page with nothing open, it goes back (#308).
  if (e.key !== 'Escape') return;
  const open = (e.target as HTMLElement).closest<HTMLDetailsElement>('details[open]') ?? app.querySelector<HTMLDetailsElement>('details.rooms-picker[open]');
  if (open) {
    open.open = false;
    open.querySelector<HTMLElement>('summary')?.focus();
    return;
  }
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  app.querySelector<HTMLElement>('.subhead .back')?.click();
});

// ------------------------------------------------------------------ swipe (S-7.11)
/** #311: the period of Accueil, in the order of its control (Mois · Saison · 12 mois · Année). */
const periods = () => HOME_PERIODS.map(([k]) => k);
const PERIOD_LABEL = Object.fromEntries(HOME_PERIODS) as Record<string, string>;

/** Polite announcement for screen readers (the live region sits outside #app, never re-rendered). */
function announce(msg: string) {
  const el = document.getElementById('sr-status');
  if (el) el.textContent = msg;
}

onSwipe(app, (zone, dir) => {
  if (!ds || state.simple) return;
  const route = currentRoute();
  if (zone === 'period' && route.page === 'accueil') {
    // Swipe right: the next, longer period; swipe left: back to the shorter one.
    const next = step(periods(), homePeriod(state.home), dir === 'right' ? 1 : -1);
    if (!next) return;
    slide = dir;
    setState({ home: next });
    return announce(`Période : ${PERIOD_LABEL[next] ?? next}`);
  }
  if (zone === 'tab') {
    const tabs = visibleTabs(tenant().on);
    const cur = tabOf(route) ?? 'accueil';
    const next = step(
      tabs.map(([v]) => v),
      cur,
      dir === 'left' ? 1 : -1,
    );
    if (!next) return;
    slide = dir;
    navigate(next);
    announce(`Onglet : ${tabs.find(([v]) => v === next)![1]}`);
  }
});

window.addEventListener('online', () => void updateNetStatus(ds));
window.addEventListener('offline', () => void updateNetStatus(ds));

// ------------------------------------------------------------------ lock (S-8.11)
/** Forget the decrypted data, the remembered key and the GitHub token, then show the lock screen. */
async function lockApp(idleFor = 0) {
  idle.stop();
  if (idleFor) markIdleLock(idleFor); // #334: the lock screen says why
  else clearLockNotice(); // locked on purpose: no stale explanation
  settings.forgetToken();
  if (ds?.source !== 'demo') await forgetKeys();
  setDataset(null);
  shownRoute = null;
  await start();
}
const idle = new IdleLock(() => void lockApp(state.lockAfter));
// #255: once per decrypted dataset, not when the household view is toggled.
onDatasetOpened(() => idle.start(state.lockAfter));
onDatasetOpened(() => prefetchForOffline(ds!));
// #308: an address opened directly (shared link, Back after a reload) wins over the last page.
onDatasetOpened(() => {
  const r = parseRoute(location.hash);
  if (r) state.view = routeKey(r);
  history.replaceState({ depth: 0 }, '', location.href);
});
// #232: the decrypted documents and what was computed from them are forgotten on lock.
onLock(clearDataCaches);
onLock(clearMemo);

// ------------------------------------------------------------------ boot
async function start() {
  applyTheme();
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
      markIdleLock(state.lockAfter);
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
  const why = lockNotice() || lossMessage(loss, isIos(navigator.userAgent, navigator.maxTouchPoints)); // #334
  renderLock('', resp.ok, resp.ok ? why : '');
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
