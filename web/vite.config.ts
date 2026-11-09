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
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(data|demo)\/.+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'energy-data', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
});
