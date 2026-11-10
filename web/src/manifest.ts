// #357: the web app manifest (vite.config.ts hands it to vite-plugin-pwa). Pure data, so that
// src/manifest.test.ts can check it against the router (every shortcut opens a real page) and
// against the design tokens (theme colour = the page surface of the light theme, as the
// <meta name="theme-color"> of index.html).

/** Light page surface (--surface-page = --sand-2, styles/tokens.primitives.css). */
export const THEME_COLOR = '#f9f9f8';

/** The pages a long press on the icon opens directly (stable routes of #308). */
export const SHORTCUTS: { name: string; short_name: string; description: string; hash: string }[] = [
  { name: 'Accueil', short_name: 'Accueil', description: 'La période en cours et ce qui a changé', hash: 'accueil' },
  { name: 'Pièces', short_name: 'Pièces', description: 'Chaque pièce, son coût et son confort', hash: 'pieces' },
  { name: 'Compteur', short_name: 'Compteur', description: 'Le compteur Linky : tout le logement', hash: 'compteur' },
  { name: 'État des données', short_name: 'État', description: 'Dernière collecte, sources, retards', hash: 'etat' },
];

export const MANIFEST = {
  // A stable identity: the app stays « the same app » for the browser if start_url ever changes.
  id: './',
  name: 'Historique énergie — Intuitiv',
  short_name: 'Énergie',
  description: 'Consommation des radiateurs et du chauffe-eau, sur plusieurs années.',
  lang: 'fr',
  start_url: './',
  scope: './',
  display: 'standalone' as const,
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: SHORTCUTS.map((s) => ({
    name: s.name,
    short_name: s.short_name,
    description: s.description,
    url: `./#${s.hash}`,
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  })),
};
