import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// GitHub Pages serves a project site from /<repo>/. If you deploy to a custom
// domain or a user/organisation page, change `prodBase` to '/'.
const prodBase = '/systema/';

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isTest = mode === 'test';

  return {
    base: command === 'build' ? prodBase : '/',
    // Honour an assigned PORT (the preview harness sets one when 5173 is taken);
    // fall back to Vite's default otherwise.
    server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      svelte(),
      // The PWA plugin pulls in workbox + asset generation, which we don't want
      // running during unit tests.
      ...(isTest
        ? []
        : [
            VitePWA({
              // 'autoUpdate': a new build activates itself and the app reloads
              // to it, so fixes always reach the installed PWA (with 'prompt',
              // a missed toast froze the phone on a stale version). Reloads only
              // happen when online and a new version exists; IndexedDB data is
              // untouched.
              registerType: 'autoUpdate',
              injectRegister: 'auto',
              // Generates favicon, apple-touch-icon and maskable PWA icons from
              // a single source SVG, and injects the right <link> tags.
              pwaAssets: {
                preset: 'minimal-2023',
                image: 'public/logo.svg',
              },
              manifest: {
                name: 'systema — city systems travel companion',
                short_name: 'systema',
                description:
                  'Your entire travel workflow before, during and after a trip. Offline-first, local, free.',
                lang: 'en-GB',
                theme_color: '#faf9f6',
                background_color: '#faf9f6',
                display: 'standalone',
                orientation: 'portrait',
                categories: ['travel', 'productivity'],
              },
              workbox: {
                // Precache the app shell; with hash routing every screen is the
                // same index.html, so the field experience works fully offline.
                globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
                navigateFallback: 'index.html',
                runtimeCaching: [
                  {
                    // Frankfurter FX is also cached in IndexedDB; this is belt-and-braces.
                    // Match both hosts: .app now 301-redirects to .dev.
                    urlPattern: /^https:\/\/api\.frankfurter\.(dev|app)\/.*/i,
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'fx-cache',
                      expiration: { maxEntries: 64, maxAgeSeconds: 604800 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                  {
                    // Map tiles: cache-first so areas browsed at home still
                    // render offline in the field.
                    urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'osm-tiles',
                      expiration: { maxEntries: 600, maxAgeSeconds: 2592000 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
              // Enable the service worker in `vite dev` too, so offline behaviour
              // can be exercised during development.
              devOptions: {
                enabled: true,
                type: 'module',
              },
            }),
          ]),
    ],
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.{test,spec}.ts'],
    },
  };
});
