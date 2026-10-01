import type { Browser, Page, Route, TestInfo } from '@playwright/test';

/**
 * An in-test NAS receiver, faithful to nas/systema-backup.php: snapshots are
 * files named by second (a same-second push overwrites), `latest` is the
 * highest name, 60 are kept, photos are write-once by id, 404 when missing.
 * Shared by several browser contexts, it lets two "devices" sync for real.
 */
export class FakeNas {
  files = new Map<string, string>();
  photos = new Map<string, Buffer>();
  second = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
  /** Advance the receiver clock one second per snapshot (false: collide). */
  advance = true;
  dataPosts = 0;
  photoPosts = 0;
  /** Fail photo uploads once this many have been stored (simulated outage). */
  failPhotoPostsAfter = Infinity;
  latestOverride: { status: number; body: string } | null = null;

  handle = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const kind = url.searchParams.get('kind');
    const id = url.searchParams.get('id') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const json = (status: number, obj: unknown) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify(obj),
      });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.searchParams.get('token') !== 'synthetic')
      return json(403, { ok: false, error: 'bad token' });

    if (req.method() === 'GET') {
      if (kind === 'latest') {
        if (this.latestOverride)
          return route.fulfill({
            ...this.latestOverride,
            headers: cors,
            contentType: 'application/json',
          });
        const name = [...this.files.keys()].sort().at(-1);
        if (!name) return json(404, { ok: false, error: 'no snapshots yet' });
        return route.fulfill({
          headers: cors,
          contentType: 'application/json',
          body: this.files.get(name),
        });
      }
      const photo = this.photos.get(id);
      if (kind === 'photo' && photo)
        return route.fulfill({ headers: cors, contentType: 'image/png', body: photo });
      return json(404, { ok: false, error: 'not found' });
    }

    const body = req.postDataBuffer() ?? Buffer.alloc(0);
    if (!body.length) return json(400, { ok: false, error: 'empty body' });
    if (kind === 'data') {
      try {
        JSON.parse(body.toString());
      } catch {
        return json(400, { ok: false, error: 'not JSON' });
      }
      if (this.advance) this.second += 1;
      const stamp = new Date(this.second * 1000).toISOString().replace(/[-:]/g, '').slice(0, 15);
      const name = `systema-data-${stamp.replace('T', '-')}.json`;
      this.files.set(name, body.toString());
      for (const old of [...this.files.keys()].sort().slice(0, Math.max(0, this.files.size - 60)))
        this.files.delete(old);
      this.dataPosts += 1;
      return json(200, { ok: true, stored: name });
    }
    if (kind === 'photo') {
      if (this.photos.size >= this.failPhotoPostsAfter)
        return json(500, { ok: false, error: 'write failed' });
      if (!this.photos.has(id)) this.photos.set(id, body);
      this.photoPosts += 1;
      return json(200, { ok: true });
    }
    return json(400, { ok: false, error: 'unknown kind' });
  };

  latest(): any {
    const name = [...this.files.keys()].sort().at(-1);
    return name ? JSON.parse(this.files.get(name)!) : null;
  }
}

/** A fresh "device": its own browser context (own IndexedDB) wired to the NAS. */
export async function device(browser: Browser, nas: FakeNas, info: TestInfo): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = info.project.use;
  const context = await browser.newContext({
    ...{ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL },
    serviceWorkers: 'block',
  });
  await context.route('https://nas.test/**', nas.handle);
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = [
      '/src/lib/db.ts',
      '/src/lib/trips.ts',
      '/src/lib/stops.ts',
      '/src/lib/photos.ts',
      '/src/lib/expenses.ts',
      '/src/lib/export.ts',
      '/src/lib/nas.svelte.ts',
      '/src/lib/settings.svelte.ts',
    ];
    const mods = await Promise.all(paths.map((p) => import(/* @vite-ignore */ p)));
    const m = Object.assign({}, ...mods);
    m.settingsStore.current = {
      nasUrl: 'https://nas.test/systema-backup.php',
      nasToken: 'synthetic',
    };
    // Tests drive every sync explicitly; no debounced background syncs.
    m.nasBackup.schedule = () => {};
    (window as any).m = m;
  });
  return page;
}

/** Run one sync on a device and return its outcome message. */
export async function sync(page: Page): Promise<{ ok: boolean; message: string }> {
  return page.evaluate(() => (window as any).m.nasBackup.sync());
}
