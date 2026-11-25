/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Percorsi relativi: l'app funziona sia in locale sia su GitHub Pages (/worklog-app/).
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'sw-notifiche.js'],
      manifest: {
        id: './',
        name: 'Gestionale Interventi',
        short_name: 'Interventi',
        description: 'Presenze, attività, interventi, rapportini, cartellini e magazzino. Funziona anche senza rete.',
        lang: 'it',
        dir: 'ltr',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#f4f6f8',
        theme_color: '#0f766e',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'Oggi', url: './#/op', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Notifiche', url: './#/notifiche', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Gestione del tocco sugli avvisi di sistema (apre la pagina collegata).
        importScripts: ['sw-notifiche.js'],
        // Le versioni precedenti della cache vengono rimosse: i dati (IndexedDB) non sono toccati.
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // pdfmake + font (≈2,5 MB) devono stare in cache per esportare i PDF anche offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // I blocchi di pdfmake e dei font sono grandi ma caricati solo al primo export PDF.
    chunkSizeWarningLimit: 1300,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    env: { TZ: 'Europe/Rome' },
  },
});
