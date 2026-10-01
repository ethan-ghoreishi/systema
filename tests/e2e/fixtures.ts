import { test as base, type BrowserContext } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fresh browser contexts for each test ("devices"). WebKit only stores Blobs
 * in IndexedDB for persistent profiles — as the installed iPhone app has — so
 * WebKit contexts get a throwaway persistent profile; photo paths then run on
 * the iPhone's engine too. Service workers stay off (tested separately).
 */
export const test = base.extend<{ makeContext: () => Promise<BrowserContext> }>({
  makeContext: async ({ browser, browserName, playwright }, use, info) => {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } =
      info.project.use;
    const options = {
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      baseURL,
      serviceWorkers: 'block' as const,
    };
    const made: BrowserContext[] = [];
    await use(async () => {
      const ctx =
        browserName === 'webkit'
          ? await playwright.webkit.launchPersistentContext(
              mkdtempSync(join(tmpdir(), 'systema-e2e-')),
              options,
            )
          : await browser.newContext(options);
      made.push(ctx);
      return ctx;
    });
    for (const ctx of made) await ctx.close();
  },
  context: async ({ makeContext }, use) => use(await makeContext()),
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

export { expect } from '@playwright/test';
