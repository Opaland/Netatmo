import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { builtSourceRepo } from './src/build-env';
import { MANIFEST } from './src/manifest';

// #229: <compte>.github.io is one origin for every Pages site of the account, and the Cache API
// is per origin. The runtime caches carry the repository name (GitHub Actions sets
// GITHUB_REPOSITORY) so that another site's worker never reads or fills them by mistake.
// The precache is already per worker scope (/<dépôt>/). Not an isolation: see scope.ts.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const repo = env.GITHUB_REPOSITORY?.split('/')[1]?.replace(/[^\w.-]/g, '') ?? '';
const cacheName = (name: string) => (repo ? `${name}@${repo}` : name);

export default defineConfig({
  // Relative base: works on https://<user>.github.io/<repo>/ without knowing the repo name.
  base: './',
  define: {
    'import.meta.env.VITE_DATA_CACHE': JSON.stringify(cacheName('energy-data')),
    'import.meta.env.VITE_TARIFF_CACHE': JSON.stringify(cacheName('energy-tariffs')),
    // #533: the repository of this build (a copy links to its own guide), src/source-repo.ts; #541:
    // an empty VITE_SOURCE_REPO does not hide GITHUB_REPOSITORY (src/build-env.ts)
    'import.meta.env.VITE_SOURCE_REPO': JSON.stringify(builtSourceRepo(env)),
  },
  plugins: [
    VitePWA({
      // #357 (decision of 10/11/2026): a new version waits until « Recharger » is touched in the
      // banner (src/pwa.ts), which sends SKIP_WAITING to the waiting worker. #334 forced
      // skipWaiting instead: the open page then ran its old JavaScript under a new worker whose
      // precache no longer had the old hashed chunks (lazy cards failed). The way out of a stuck
      // version that #334 was after is the button (it activates the waiting worker, every tab
      // included), and the check on coming back to the foreground (src/pwa.ts).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/apple-touch-icon.png'],
      manifest: MANIFEST, // src/manifest.ts (#357: id, shortcuts, theme colour of the tokens)
      workbox: {
        // No skipWaiting (see registerType above). clientsClaim only acts on pages that have no
        // worker yet, i.e. the first visit: it makes that page work offline without a reload. A
        // page already controlled switches worker when the waiting one is activated anyway.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Encrypted data: try the network first (fresh nightly data), fall back to cache offline.
        // S-7.12: requests are conditional (cache: 'no-cache' → ETag, 304 when unchanged), the
        // hourly files are fetched in the background on Wi-Fi (src/offline.ts), and the public
        // tariff files are kept too so that costs stay right offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(data|demo)\/.+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: cacheName('energy-data'), networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => /\/tarifs\/[^/]+\.(csv|json)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: cacheName('energy-tariffs'), networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
});
