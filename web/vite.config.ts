import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base: works on https://<user>.github.io/<repo>/ without knowing the repo name.
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Historique énergie — Intuitiv',
        short_name: 'Énergie',
        description: 'Consommation des radiateurs et du chauffe-eau, sur plusieurs années.',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f3f0',
        theme_color: '#c2410c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Encrypted data: try the network first (fresh nightly data), fall back to cache offline.
        // S-7.12: requests are conditional (cache: 'no-cache' → ETag, 304 when unchanged), the
        // hourly files are fetched in the background on Wi-Fi (src/offline.ts), and the public
        // tariff files are kept too so that costs stay right offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(data|demo)\/.+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'energy-data', networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => /\/tarifs\/[^/]+\.(csv|json)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'energy-tariffs', networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
});
