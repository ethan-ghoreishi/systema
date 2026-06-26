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
              // 'prompt' so the field app never reloads itself mid-trip — the
              // user taps to update when an offline-safe update is ready.
              registerType: 'prompt',
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
                    urlPattern: /^https:\/\/api\.frankfurter\.app\/.*/i,
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'fx-cache',
                      expiration: { maxEntries: 64, maxAgeSeconds: 604800 },
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
