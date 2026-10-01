import { defineConfig, devices } from '@playwright/test';

// PWA update behaviour against real production builds with the service worker
// on: build A is served, the test then builds B over it and triggers an update.
const out = 'dist-pwa';

export default defineConfig({
  testDir: './tests/pwa',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `vite preview` runs as 'serve', so the production base must be passed in.
    command: `APP_VERSION=build-a npx vite build --outDir ${out} --emptyOutDir && npx vite preview --outDir ${out} --base /systema/ --port 4173 --strictPort`,
    url: 'http://localhost:4173/systema/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
