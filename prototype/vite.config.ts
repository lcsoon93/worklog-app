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
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Gestionale Interventi – Prototipo',
        short_name: 'Interventi',
        description: 'Prototipo Fase 1: presenze, attività, rapportini e cartellini (dati dimostrativi locali).',
        lang: 'it',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f6f8',
        theme_color: '#0f766e',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
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
