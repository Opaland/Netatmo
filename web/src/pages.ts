// #308 / #309 / #257: the page registry. Each page of the new navigation (router.ts) has one
// entry: how it is drawn, from the v1.5 cards moved there (architecture-cible.md § 3), and the
// event handlers that apply while it is shown. main.ts draws the shell (header, tab bar, back
// arrow) and dispatches the events to the entry of the page shown only.
import { activeRooms, ds, householdStatus, state } from './app';
import { alert, list, seg as segment, switchField } from './components';
import type { Handlers } from './events';
import { dayShort, fmt1 } from './glossary';
import { glossarySection } from './plain';
import { type Route, SETTINGS, type SettingsPage, type Tool, routeKey } from './router';
import { LOCK_CHOICES } from './session';
import { tenant } from './tenant';
import { html } from './trusted';
import { esc, filtered, roomColor } from './ui';
import { lazyCard } from './lazy';
import { CATEGORY_LABEL } from './aggregate';
import * as analyse from './views/analyse';
import * as compare from './views/compare';
import * as home from './views/home';
import * as household from './views/household';
import * as outils from './views/outils';
import * as overview from './views/overview';
import { pinSelect, pinnedTiles } from './views/pinned';
import * as prices from './views/prices';
import { qualityCard, qualityHandlers } from './views/quality';
import { type Freshness, freshness } from './freshness';
import * as report from './views/report';
import * as rooms from './views/rooms';
import * as settings from './views/settings';
import { sharedOriginWarning } from './views/settings';

export interface Page {
  render(view: HTMLElement, route: Route): void;
  /** Handlers of this page only (#257): the other pages' are not called. */
  handlers?: Handlers[];
  /** Data pages show « Aucune donnée pour cette sélection » when the filters leave nothing. */
  needsData?: boolean;
}

/** Wrap a click / change handler of the v1.5 views (they return true when the event was theirs). */
const h = (click?: (b: HTMLElement) => boolean, change?: (t: HTMLInputElement | HTMLSelectElement) => boolean): Handlers => ({
  click: click ? (el) => click(el) : undefined,
  change: change ? (t) => change(t as HTMLInputElement | HTMLSelectElement) : undefined,
});

/** Several renderers on one page, each in its own block (they each own their container). */
function stack(view: HTMLElement, head: string, parts: ((el: HTMLElement) => void)[]) {
  view.innerHTML = html(`${head}${parts.map((_, i) => `<div class="part" id="part-${i}"></div>`).join('')}`);
  parts.forEach((fn, i) => fn(document.getElementById(`part-${i}`)!));
}

// ------------------------------------------------------------------ comfort (lazy, S-7.10)
let comfort: typeof import('./views/comfort') | null = null;
function renderComfort(view: HTMLElement) {
  if (comfort) return comfort.renderComfort(view);
  view.innerHTML = html('<p class="empty">Chargement…</p>');
  void lazyCard(
    () => import('./views/comfort'),
    (m) => {
      comfort = m;
      if (state.view === 'confort' && view.isConnected) m.renderComfort(view);
    },
    { zone: view, what: 'Air et confort' },
  );
}
const comfortHandlers: Handlers = {
  click: (el) => comfort?.handleClick(el) ?? false,
  change: (t) => comfort?.handleChange(t as HTMLInputElement) ?? false,
};

// ------------------------------------------------------------------ filters (#308)
/** The usage and rooms selection, set in Historique (usage, « Consommation en détail ») and Pièces (rooms): a chip says so elsewhere. */
function filterChip(): string {
  const all = activeRooms().length;
  const n = state.rooms ? state.rooms.length : all;
  if (state.cat === 'all' && n === all) return '';
  const what = [state.cat === 'all' ? '' : CATEGORY_LABEL[state.cat], n === all ? '' : `${n} pièce${n > 1 ? 's' : ''} sur ${all}`].filter(Boolean).join(' · ');
  return `<p class="filter-chip" role="status"><span>Sélection : <strong>${esc(what)}</strong></span> <button type="button" class="link" data-filter-reset>Tout afficher</button></p>`;
}

function roomsPicker(): string {
  const roomsCount = state.rooms ? state.rooms.length : activeRooms().length;
  return `<details class="rooms-picker">
      <summary>Pièces affichées <span class="count">${roomsCount}/${activeRooms().length}</span></summary>
      <div class="rooms-panel">
        <div class="rooms-actions"><button type="button" data-rooms="all">Toutes</button><button type="button" data-rooms="none">Aucune</button></div>
        ${activeRooms()
          .map(
            (r) => `<label class="check"><input type="checkbox" data-room="${esc(r.id)}" ${!state.rooms || state.rooms.includes(r.id) ? 'checked' : ''}>
            <span class="swatch" style="background:${roomColor(r.id)}"></span>${esc(r.name)} <small class="muted">${CATEGORY_LABEL[r.category]}</small></label>`,
          )
          .join('')}
      </div>
    </details>`;
}

// ------------------------------------------------------------------ Pièces, Pièce (#313, lazy)
let piece: typeof import('./views/piece') | null = null;
function withPiece(view: HTMLElement, draw: (m: typeof import('./views/piece')) => void) {
  if (piece) return draw(piece);
  view.innerHTML = html('<p class="empty">Chargement…</p>');
  void lazyCard(
    () => import('./views/piece'),
    (m) => {
      piece = m;
      if (view.isConnected) draw(m);
    },
    { zone: view, what: 'Pièces' },
  );
}

function renderPieces(view: HTMLElement) {
  withPiece(view, (m) =>
    m.renderPieces(view, {
      picker: `${roomsPicker()}${filterChip()}`,
      compare: (el) => {
        const records = filtered();
        if (records.length) rooms.renderRooms(el, records, 'list');
        else el.innerHTML = html('<p class="empty">Aucune donnée pour cette sélection.</p>');
      },
    }),
  );
}

function renderPiece(view: HTMLElement, route: Route) {
  const id = route.page === 'piece' ? route.room : '';
  const room = activeRooms().find((r) => r.id === id);
  if (!room) {
    view.innerHTML = html`<section class="card"><p class="hint">Cette pièce n'est pas affichée (renommée, regroupée dans la vue foyer ou sans donnée).</p><a class="link" href="#pieces">Voir toutes les pièces</a></section>`;
    return;
  }
  withPiece(view, (m) => m.renderPiece(view, room.id));
}
const pieceHandlers: Handlers = { click: (el) => piece?.handleClick(el) ?? false };

// ------------------------------------------------------------------ Historique, Compteur
function renderHistorique(view: HTMLElement) {
  const records = filtered();
  stack(view, `<h2 class="page-title" id="page-title" tabindex="-1">Historique</h2>${filterChip()}`, [
    (el) => overview.renderOverview(el, records, 'twelve'),
    // #311: the explorer of the v1.5 Synthèse (period, usage, granularity, by room, values) left Accueil
    (el) => overview.renderOverview(el, records, 'explore'),
    (el) => compare.renderCompare(el, records, 'history'),
    (el) => rooms.renderRooms(el, records, 'changes'),
    (el) => analyse.renderAnalyse(el, records, 'historique'),
  ]);
}

function renderCompteur(view: HTMLElement) {
  const records = filtered();
  stack(view, `<h2 class="page-title" id="page-title" tabindex="-1">Compteur <small class="muted">Linky</small></h2>${filterChip()}`, [
    (el) => overview.renderOverview(el, records, 'meter'),
    (el) => analyse.renderAnalyse(el, records, 'compteur'),
  ]);
}

// ------------------------------------------------------------------ Outils (#314)
/** Sources whose last attempt succeeded (meta.sources), for the État des données row. */
function activeSources(): number {
  const src = (ds!.meta as { sources?: Record<string, { ok?: string; error?: string }> }).sources ?? {};
  return Object.values(src).filter((s) => s.ok && !(s.error && s.error > s.ok)).length;
}
const renderOutils = (view: HTMLElement) => outils.renderOutils(view, dataStatus(), activeSources());

function renderExports(view: HTMLElement) {
  view.innerHTML = html`<section class="card">
    <div class="card-head"><h2>Exporter mes données</h2></div>
    <p class="hint muted">Préparés sur cet appareil, à partir des données déchiffrées ; rien n'est envoyé.</p>
    <div class="actions">
      <button type="button" class="btn secondary" id="export">Exporter en CSV (sélection appliquée)</button>
      <button type="button" class="btn secondary" data-export-long="csv" title="Format long documenté (docs/export-long.md), tout l'historique">Export long (CSV)</button>
      <button type="button" class="btn secondary" data-export-long="json" title="Même contenu en JSON, conforme au schéma docs/export-long.schema.json">Export long (JSON)</button>
      <button type="button" class="btn secondary" data-research title="Horaire, pièces pseudonymisées, dates décalées, licence au choix (docs/export-recherche.md)">Export recherche (anonymisé)</button>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Sauvegarde chiffrée</h2></div>
    <p class="hint muted">Tous les fichiers chiffrés en un seul, toujours chiffrés : à garder hors de GitHub.</p>
    <button type="button" class="btn secondary" id="backup">Télécharger une sauvegarde chiffrée</button>
  </section>
  <section class="card"><div class="card-head"><h2>Pour un tiers</h2></div>
    <p class="hint">Le <a href="#rapport">rapport annuel</a> a une version anonymisée (bouton « Rapport anonymisé »).</p></section>`;
}

/** #314: the « et si… » tools look like simulations (dashed cards, label, assumptions recalled). */
const SIMULATORS = new Set<Tool>(['offres', 'voiture', 'consigne', 'pac', 'teletravail']);

function renderTool(view: HTMLElement, route: Route) {
  if (route.page !== 'outil') return;
  drawTool(view, route.tool);
  if (SIMULATORS.has(route.tool)) {
    view.classList.add('sim-page');
    view.insertAdjacentHTML(
      'afterbegin',
      html(`<p class="sim-note"><span class="tag">Simulation</span> Une estimation « et si… » calculée sur vos données réelles, pas une mesure : les hypothèses sont rappelées dans chaque carte.</p>`),
    );
  }
}

function drawTool(view: HTMLElement, t: Tool) {
  const records = filtered();
  if (t === 'offres') return compare.renderCompare(view, records, 'offers');
  if (t === 'voiture') return compare.renderCompare(view, records, 'ev');
  if (t === 'facture') return overview.renderOverview(view, records, 'invoice');
  if (t === 'exports') return renderExports(view);
  if (t === 'questions') {
    view.innerHTML = html`<section class="card" id="questions-card" aria-busy="true"><h2>Questions types</h2></section>`;
    void lazyCard(() => import('./views/questions'), (m) => m.mountQuestions(document.getElementById('questions-card')), { zone: 'questions-card', what: 'Questions types' });
    return;
  }
  const part = ({ consigne: 'consigne', pac: 'pac', teletravail: 'teletravail', absences: 'absences', volets: 'volets', analyse: 'ia' } as const)[t];
  analyse.renderAnalyse(view, records, part);
}

// ------------------------------------------------------------------ État des données (#318, #336)
function renderEtat(view: HTMLElement) {
  const last = ds!.meta.last_day;
  const s = dataStatus();
  const failing = s.failing.length ? `En échec : ${s.failing.map((k) => SOURCE_NAME[k] ?? k).join(', ')}. Le détail est dans « État des sources », plus bas.` : '';
  const head = last
    ? s.stale
      ? alert('bad', `Données arrêtées au ${dayShort(last, true)} (il y a ${s.days} jours)`, 'La collecte est peut-être en panne : une alerte est ouverte dans les issues GitHub du dépôt ; vous pouvez la relancer depuis ⚙ Paramètres → Sources de données.')
      : s.level === 'warn'
        ? alert('warn', `Données du ${dayShort(last, true)} : ${s.text}`, failing || 'Intuis a gardé le total du mois mais pas le détail de ces jours : la collecte les a estimés.')
        : alert('good', `Données à jour : jusqu'au ${dayShort(last, true)}`, ds!.source === 'demo' ? 'Démo : données d’exemple.' : 'La collecte passe chaque nuit.')
    : '';
  stack(view, `${head}<div id="etat-bilan" aria-busy="true"><p class="hint muted" role="status">Bilan des données : calcul…</p></div>`, [
    (el) => settings.renderSettings(el, 'etat'),
    (el) => (el.innerHTML = html(qualityCard(false) || '<section class="card"><p class="hint">Tous les mois sont complets : aucun jour estimé ni perdu.</p></section>')),
  ]);
  void lazyCard(() => import('./views/etat'), (m) => m.mountEtat(document.getElementById('etat-bilan')), { zone: 'etat-bilan', what: 'Bilan des données' });
}

const SOURCE_NAME: Record<string, string> = {
  intuis: 'Intuis',
  'open-meteo': 'météo',
  netatmo: 'station Netatmo',
  linky: 'Linky',
  'linky-30min': 'Linky à la demi-heure',
  shelly: 'prises Shelly',
  'releve-horaire': 'relevé horaire',
  appareils: 'état des appareils',
  ia: 'analyse IA',
};

/** Freshness of the data, for the header pill and the État page (#318). */
export function dataStatus(): Freshness & { label: string } {
  const last = ds!.meta.last_day;
  const month = last ? `${last.slice(0, 8)}01` : '';
  const days = new Set<string>();
  if (last) for (const k of ds!.estimated) if (k.slice(k.indexOf('|') + 1) >= month) days.add(k.slice(k.indexOf('|') + 1));
  const sources = (ds!.meta as { sources?: Record<string, { ok?: string; error?: string }> }).sources;
  const f = freshness({ last, now: Date.now(), demo: ds!.source === 'demo', sources, uncertain: days.size });
  const label = last ? `Données du ${dayShort(last)}${f.level === 'ok' ? '' : f.stale ? ' · en retard' : ' · à vérifier'}` : 'Pas encore de données';
  return { ...f, label };
}

// ------------------------------------------------------------------ Paramètres (#309)
const SCOPE: Record<SettingsPage, string> = {
  contrat: 'foyer',
  logement: 'ce téléphone',
  sources: 'foyer',
  objectifs: 'ce téléphone',
  affichage: 'ce téléphone',
  foyer: 'ce téléphone',
  securite: 'ce téléphone',
  apropos: '',
};

function settingsSummary(p: SettingsPage): string {
  const c = (() => {
    try {
      return prices.contractSummary();
    } catch {
      return '';
    }
  })();
  switch (p) {
    case 'contrat':
      return tenant().on ? 'prix moyen du locataire' : c;
    case 'logement':
      return `${activeRooms().length} pièces, travaux et surfaces, appareils saisis`;
    case 'sources':
      return 'état, dernière collecte, identifiants, collecte manuelle';
    case 'objectifs':
      return `budget, seuil de confort ${fmt1(state.comfortThreshold)} °C, alerte froid, CO₂`;
    case 'affichage':
      return `${state.simple ? 'vue simple' : 'complet'} · thème ${({ system: 'du système', light: 'clair', dark: 'sombre' } as const)[state.theme]}`;
    case 'foyer':
      return `inviter, chambres ${householdStatus().enabled ? 'regroupées' : 'détaillées'}, locataire${tenant().on ? ' (actif)' : ''}`;
    case 'securite':
      return `verrouillage ${state.lockAfter ? `après ${state.lockAfter < 60 ? `${state.lockAfter} min` : `${state.lockAfter / 60} h`}` : 'désactivé'}, sauvegarde`;
    default:
      return 'ce qui est public, cadre juridique, version';
  }
}

function renderParametres(view: HTMLElement) {
  view.innerHTML = html`${demoBanner()}
  ${list(
    (Object.keys(SETTINGS) as SettingsPage[]).map((p) => ({
      title: SETTINGS[p],
      sub: settingsSummary(p),
      value: SCOPE[p],
      href: `#${routeKey({ page: 'parametres', section: p })}`,
    })),
    'Pages des paramètres',
  )}
  <p class="hint muted">« foyer » : enregistré dans le dépôt, valable sur tous les appareils. « ce téléphone » : gardé dans ce navigateur seulement.</p>
  <button type="button" class="btn secondary block" id="lock">${ds!.source === 'demo' ? 'Quitter la démo' : 'Verrouiller maintenant'}</button>`;
}

const demoBanner = () => (ds!.source === 'demo' ? alert('info', 'Démo', 'Explorez librement : les réglages restent sur cet appareil et rien n’est envoyé à GitHub.') : '');

const THRESHOLDS = [17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21];
const scopeTag = settings.scopeTag;

function renderSettingsPage(view: HTMLElement, route: Route) {
  if (route.page !== 'parametres' || !route.section) return renderParametres(view);
  const p = route.section;
  const records = filtered();
  const head = demoBanner();
  switch (p) {
    case 'contrat':
      return stack(view, head, [
        (el) => (el.innerHTML = html(`<section class="card" id="prices-card"><div class="card-head"><h2>Mon contrat et mes prix</h2>${scopeTag(prices.sharedNow() ? 'foyer' : 'appareil')}</div>${prices.pricesForm()}</section>`)),
        (el) => settings.renderSettings(el, 'contrat'),
      ]);
    case 'logement':
      return stack(view, head, [
        (el) =>
          (el.innerHTML = html(`<section class="card"><div class="card-head"><h2>Pièces</h2>${scopeTag('foyer')}</div>
          <p class="hint muted">Noms et catégories viennent d'Intuis (collecte). Liaison d'une pièce au module de la station : dans <a href="#confort">Air et confort</a>.</p>
          ${list(activeRooms().map((r) => ({ title: r.name, sub: CATEGORY_LABEL[r.category], color: roomColor(r.id), href: `#${routeKey({ page: 'piece', room: r.id })}` })))}</section>`)),
        (el) => analyse.renderAnalyse(el, records, 'travaux'),
        (el) =>
          (el.innerHTML = html(`<section class="card"><div class="card-head"><h2>Appareils saisis à la main</h2>${scopeTag('appareil')}</div>
          <p class="hint muted">${ds!.linky.size && !tenant().on ? 'Ils se saisissent sous leur décomposition, dans la carte « Autres usages en détail » du Compteur (une seule carte, pour voir aussitôt leur part).' : 'Disponible avec le compteur Linky.'}</p>
          ${ds!.linky.size && !tenant().on ? list([{ title: 'Autres usages en détail', sub: 'Compteur : prises, appareils saisis, veille', href: '#compteur' }]) : ''}</section>`)),
      ]);
    case 'sources':
      return stack(view, head, [(el) => settings.renderSettings(el, 'sources')]);
    case 'objectifs':
      view.innerHTML = html`${head}<div id="money-zone"></div>
        <section class="card"><div class="card-head"><h2>Seuil de confort</h2>${scopeTag('appareil')}</div>
          <p class="hint muted">Une heure (ou un jour en moyenne) sous ce seuil compte comme froide, dans Pièces et Air et confort.</p>
          <label class="select">Seuil <select data-threshold>${THRESHOLDS.map((t) => `<option value="${t}" ${t === state.comfortThreshold ? 'selected' : ''}>${fmt1(t)} °C</option>`).join('')}</select></label>
        </section>
        <div id="goals-cold"></div>`;
      void lazyCard(() => import('./views/budget'), (m) => m.fillGoals(), { zone: 'money-zone', what: 'Budget et CO₂' });
      settings.renderSettings(document.getElementById('goals-cold')!, 'objectifs');
      return;
    case 'affichage':
      view.innerHTML = html`${head}<section class="card"><div class="card-head"><h2>Thème</h2>${scopeTag('appareil')}</div>
        ${segment('theme', state.theme, [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']], 'Thème')}
        <p class="hint muted">« Système » suit le réglage clair / sombre du téléphone. Le contraste élevé et les couleurs forcées du système sont toujours respectés.</p></section>
      <section class="card"><div class="card-head"><h2>Vue simple</h2>${scopeTag('appareil')}</div>
        ${switchField('Vue simple (grands caractères, phrases courtes)', state.simple, { 'data-toggle': 'simple' })}
        ${pinSelect()}
        <p class="hint muted">La vue simple a trois onglets (Accueil, Ma pièce, Aide) ; « Voir plus de détails » la quitte.</p></section>
      <section class="card"><div class="card-head"><h2>Vue foyer</h2>${scopeTag('appareil')}</div>
        ${household.householdMenu() || '<p class="hint muted">Aucune pièce nommée comme une chambre.</p>'}</section>
      <section class="card"><div class="card-head"><h2>Taille du texte</h2></div>
        <p class="hint muted">L'appli suit la taille du texte du téléphone (jusqu'à 200 %) : réglez-la dans les réglages d'accessibilité du système.</p></section>`;
      return;
    case 'foyer':
      return stack(view, head, [
        (el) => settings.renderSettings(el, 'foyer'),
        (el) =>
          (el.innerHTML = html(`<section class="card"><div class="card-head"><h2>Chambres regroupées</h2></div><p class="hint muted">La vue foyer (chambres regroupées en « Chambres ») se règle dans <a href="#parametres-affichage">Affichage et accessibilité</a>.</p></section>`)),
      ]);
    case 'securite':
      view.innerHTML = html`${head}<section class="card"><div class="card-head"><h2>Verrouillage automatique</h2>${scopeTag('appareil')}</div>
        <label class="select lock-after">Verrouiller sans activité
          <select data-lock-after>${LOCK_CHOICES.map((m) => `<option value="${m}" ${m === state.lockAfter ? 'selected' : ''}>${m ? (m < 60 ? `après ${m} min` : `après ${m / 60} h`) : 'jamais sur cet appareil'}</option>`).join('')}</select>
        </label></section>
      <section class="card"><div class="card-head"><h2>Sauvegarde chiffrée</h2>${scopeTag('appareil')}</div>
        <p class="hint muted">Tous les fichiers chiffrés en un seul, toujours chiffrés : à garder hors de GitHub.</p>
        <button type="button" class="btn secondary" id="backup">Télécharger une sauvegarde chiffrée</button></section>
      <section class="card"><div class="card-head"><h2>Phrase de passe</h2></div>
        <p class="hint muted">Elle ne se change pas dans l'appli : procédure « rekey » du README.</p>${sharedOriginWarning(location.hostname)}</section>
      <button type="button" class="btn secondary block" id="lock">${ds!.source === 'demo' ? 'Quitter la démo' : 'Verrouiller maintenant'}</button>`;
      return;
    default:
      return stack(view, head, [(el) => settings.renderSettings(el, 'apropos')]);
  }
}

// ------------------------------------------------------------------ Aide (vue simple, #316 later)
function renderAide(view: HTMLElement) {
  view.innerHTML = html`${glossarySection()}
  <section class="card"><h2>Voir toute l'appli</h2>
    <p>La vue simple montre l'essentiel. Pour tous les détails :</p>
    ${simpleExit()}</section>`;
}

/** « Voir plus de détails »: leaving the simple view asks for a confirmation, in the page (#316). */
export function simpleExit(): string {
  return `<div class="simple-exit"><button type="button" class="btn secondary block" data-simple-exit="ask">Voir plus de détails</button>
    <div class="simple-confirm" hidden role="group" aria-label="Quitter la vue simple ?"><p>Quitter la vue simple ? L'appli montrera tous les onglets et les graphiques.</p>
    <button type="button" class="btn primary" data-simple-exit="yes">Oui, voir tout</button> <button type="button" class="btn secondary" data-simple-exit="no">Rester en vue simple</button></div></div>`;
}

// ------------------------------------------------------------------ Accueil
function renderAccueil(view: HTMLElement) {
  const records = filtered();
  home.renderHome(view, records);
  // S-7.8: the pinned room comes first among the key figures of the simple mode.
  if (state.simple) {
    view.querySelector('.kpis')?.insertAdjacentHTML('afterbegin', html(pinnedTiles()));
    view.insertAdjacentHTML('beforeend', html(simpleExit()));
  }
}

const settingsHandlers: Handlers[] = [h(settings.handleClick), h(prices.handleClick, prices.handleChange), h(household.handleClick, household.handleChange), { keydown: (e) => (settings.handleKeydown(e), false) }];

/** One entry per page (#257: the handlers apply while it is shown, and only then). */
export const PAGES: Record<Route['page'], Page> = {
  accueil: { render: renderAccueil, needsData: true },
  pieces: { render: renderPieces, handlers: [h(undefined, rooms.handleChange)] },
  piece: { render: renderPiece, handlers: [pieceHandlers] },
  confort: { render: renderComfort, handlers: [comfortHandlers] },
  'chauffe-eau': { render: (v) => analyse.renderAnalyse(v, filtered(), 'chauffe-eau'), needsData: true },
  historique: { render: renderHistorique, handlers: [h(undefined, overview.handleChange), h(compare.handleClick, compare.handleChange), h(undefined, analyse.handleChange), h(undefined, rooms.handleChange)] },
  compteur: { render: renderCompteur, handlers: [h(undefined, analyse.handleChange)] },
  outils: { render: renderOutils },
  outil: { render: renderTool, handlers: [h(compare.handleClick, compare.handleChange), h(undefined, analyse.handleChange)], needsData: true },
  etat: { render: renderEtat, handlers: [qualityHandlers] },
  rapport: { render: (v) => report.renderReport(v), handlers: [h(report.handleClick, report.handleChange)] },
  aide: { render: renderAide },
  parametres: { render: renderSettingsPage, handlers: settingsHandlers },
};
