// #308: addresses of the pages (hash routing). Pure module: no DOM, no state, unit-tested.
// Each page has a stable address (« #accueil », « #piece-r-salon », « #parametres-contrat ») so
// that the system Back button, a shared link and the remembered last page all work.

export type Tab = 'accueil' | 'pieces' | 'historique' | 'compteur' | 'outils';

/** The five tabs, in their order on screen (swipe follows it). */
export const TABS: [Tab, string][] = [
  ['accueil', 'Accueil'],
  ['pieces', 'Pièces'],
  ['historique', 'Historique'],
  ['compteur', 'Compteur'],
  ['outils', 'Outils'],
];

/** Tools of the Outils tab, each on its own sub-page (« #outils-facture »), grouped as on screen. */
export const TOOLS = {
  offres: 'Quelle offre coûte le moins ?',
  voiture: 'Une voiture électrique',
  pac: 'Une pompe à chaleur',
  consigne: 'Demander 1 °C de moins aux radiateurs',
  teletravail: 'Une journée de télétravail',
  facture: 'Une facture',
  plannings: 'Mes plannings et les heures creuses',
  absences: 'Absences',
  volets: 'Volets fermés le soir',
  analyse: 'Analyse du mois',
  questions: 'Questions types',
  exports: 'Exporter mes données',
} as const;
export type Tool = keyof typeof TOOLS;

/** #309: the eight pages of the settings centre (« #parametres-contrat »). */
export const SETTINGS = {
  contrat: 'Contrat et prix',
  logement: 'Mon logement',
  sources: 'Sources de données',
  objectifs: 'Objectifs et alertes',
  affichage: 'Affichage et accessibilité',
  foyer: 'Foyer et partage',
  securite: 'Sécurité',
  apropos: 'À propos et confidentialité',
} as const;
export type SettingsPage = keyof typeof SETTINGS;

/** The detail pages of the Compteur tab (« #compteur-veille »), in the order of its list. */
export const METER_PAGES = {
  journee: 'Journée type',
  veille: 'Veille',
  autres: 'Autres usages en détail',
  'heures-creuses': 'Heures pleines / creuses',
} as const;
export type MeterPage = keyof typeof METER_PAGES;

export type Route =
  | { page: Tab }
  | { page: 'piece'; room: string }
  | { page: 'confort' | 'chauffe-eau' | 'etat' | 'rapport' | 'aide' }
  | { page: 'outil'; tool: Tool }
  | { page: 'compteur-detail'; sub: MeterPage }
  | { page: 'parametres'; section: SettingsPage | null }
  | { page: 'bienvenue'; step: OnboardingStep };

/** #312: the four screens of the first launch (« #bienvenue », « #bienvenue-2 »…). */
export type OnboardingStep = 1 | 2 | 3 | 4;

const SIMPLE_PAGES = new Set(['confort', 'chauffe-eau', 'etat', 'rapport', 'aide']);
const isTab = (s: string): s is Tab => TABS.some(([t]) => t === s);

/** Route of an address (« piece-r-salon », with or without « # »), or null when unknown. */
export function parseRoute(hash: string): Route | null {
  const h = hash.replace(/^#\/?/, '');
  if (isTab(h)) return { page: h };
  if (SIMPLE_PAGES.has(h)) return { page: h as 'confort' };
  if (h === 'parametres') return { page: 'parametres', section: null };
  if (h === 'bienvenue') return { page: 'bienvenue', step: 1 };
  const b = /^bienvenue-([2-4])$/.exec(h);
  if (b) return { page: 'bienvenue', step: Number(b[1]) as OnboardingStep };
  let m = /^parametres-(.+)$/.exec(h);
  if (m) return m[1] in SETTINGS ? { page: 'parametres', section: m[1] as SettingsPage } : null;
  m = /^compteur-(.+)$/.exec(h);
  if (m) return m[1] in METER_PAGES ? { page: 'compteur-detail', sub: m[1] as MeterPage } : null;
  m = /^outils-(.+)$/.exec(h);
  if (m) return m[1] in TOOLS ? { page: 'outil', tool: m[1] as Tool } : null;
  m = /^piece-(.+)$/.exec(h);
  if (m) {
    try {
      return { page: 'piece', room: decodeURIComponent(m[1]) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Address of a route, without « # ». */
export function routeKey(r: Route): string {
  switch (r.page) {
    case 'piece':
      return `piece-${encodeURIComponent(r.room)}`;
    case 'outil':
      return `outils-${r.tool}`;
    case 'compteur-detail':
      return `compteur-${r.sub}`;
    case 'parametres':
      return r.section ? `parametres-${r.section}` : 'parametres';
    case 'bienvenue':
      return r.step > 1 ? `bienvenue-${r.step}` : 'bienvenue';
    default:
      return r.page;
  }
}

/** Tab lit for a route (a sub-page lights its parent tab); null for the settings. */
export function tabOf(r: Route): Tab | null {
  switch (r.page) {
    case 'piece':
    case 'confort':
    case 'chauffe-eau':
      return 'pieces';
    case 'compteur-detail':
      return 'compteur';
    case 'outil':
    case 'etat':
    case 'rapport':
      return 'outils';
    case 'parametres':
    case 'aide':
    case 'bienvenue':
      return null;
    default:
      return r.page;
  }
}

/** Where the back arrow of a sub-page leads; null on a tab (no arrow). */
export function parentOf(r: Route): string | null {
  switch (r.page) {
    case 'piece':
    case 'confort':
    case 'chauffe-eau':
      return 'pieces';
    case 'compteur-detail':
      return 'compteur';
    case 'outil':
    case 'etat':
    case 'rapport':
      return 'outils';
    case 'parametres':
      return r.section ? 'parametres' : 'accueil';
    case 'aide':
      return 'accueil';
    default:
      return null; // a tab, or the first launch (its own header, #312)
  }
}

/** Title of a sub-page (its heading, focused on arrival); the tab name for a tab. */
export function titleOf(r: Route, roomName: (id: string) => string = (id) => id): string {
  switch (r.page) {
    case 'piece':
      return roomName(r.room);
    case 'confort':
      return 'Air et confort';
    case 'chauffe-eau':
      return 'Chauffe-eau';
    case 'etat':
      return 'État des données';
    case 'rapport':
      return 'Rapport annuel';
    case 'aide':
      return 'Aide';
    case 'bienvenue':
      return 'Bienvenue';
    case 'outil':
      return TOOLS[r.tool];
    case 'compteur-detail':
      return METER_PAGES[r.sub];
    case 'parametres':
      return r.section ? SETTINGS[r.section] : 'Paramètres';
    default:
      return TABS.find(([t]) => t === r.page)![1];
  }
}

/**
 * The tab bar of the simple mode (« vue Proche », architecture § 6): Accueil, Ma pièce, Aide.
 * « Ma pièce » is the pinned room, or the list of rooms when none is pinned.
 */
export function simpleTabs(pinned: string | null): [string, string][] {
  return [
    ['accueil', 'Accueil'],
    [pinned ? routeKey({ page: 'piece', room: pinned }) : 'pieces', 'Ma pièce'],
    ['aide', 'Aide'],
  ];
}

/** Hidden tab: the meter tab is replaced by a line in Outils in tenant mode (#308). */
export function visibleTabs(tenant: boolean): [Tab, string][] {
  return tenant ? TABS.filter(([t]) => t !== 'compteur') : TABS;
}

/** A route the page can show: the meter pages fall back to Accueil in tenant mode. */
export function allowed(r: Route, tenant: boolean): Route {
  if (tenant && (r.page === 'compteur' || r.page === 'compteur-detail')) return { page: 'outils' };
  return r;
}
