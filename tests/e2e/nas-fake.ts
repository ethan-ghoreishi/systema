import type { BrowserContext, Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  /** Photos that always fail, with the HTTP status to answer. */
  failPhotos = new Map<string, number>();
  /** Bodies above this arrive empty, as PHP does past post_max_size. */
  maxBody = Infinity;
  /** 1 = the original receiver (no listing, no hashes); 2 = the current one. */
  version: 1 | 2 = 2;
  /** No answer at all (NAS asleep, away from home). */
  unreachable = false;
  /**
   * Bodies above this get the connection cut mid-upload — what a proxy limit
   * (or PHP printing a warning before its headers) looks like to a browser.
   */
  cutOffAbove = Infinity;
  latestOverride: { status: number; body: string } | null = null;

  handle = async (route: Route) => {
    if (this.unreachable) return route.abort('failed');
    const req = route.request();
    const url = new URL(req.url());
    const kind = url.searchParams.get('kind');
    const id = url.searchParams.get('id') ?? '';
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
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
    if (req.method() === 'GET' && !kind)
      return json(200, {
        ok: true,
        service: 'systema-backup',
        ...(this.version === 2 ? { version: 2, maxBody: 0, writable: true } : {}),
      });
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
      if (kind === 'photos' && this.version === 2)
        return json(200, {
          ok: true,
          photos: [...this.photos].map(([pid, b]) => ({ id: pid, ext: 'png', bytes: b.length })),
        });
      const photo = this.photos.get(id);
      if (kind === 'photo' && photo && url.searchParams.get('meta') === '1' && this.version === 2)
        return json(200, { ok: true, bytes: photo.length, sha256: sha(photo) });
      if (kind === 'photo' && photo)
        return route.fulfill({ headers: cors, contentType: 'image/png', body: photo });
      return json(404, { ok: false, error: 'not found' });
    }

    let body = req.postDataBuffer() ?? Buffer.alloc(0);
    if (body.length > this.cutOffAbove) return route.abort('connectionreset');
    if (body.length > this.maxBody) {
      if (this.version === 2) return json(413, { ok: false, error: 'larger than post_max_size' });
      body = Buffer.alloc(0); // PHP drops it before the script runs
    }
    if (!body.length) return json(400, { ok: false, error: 'empty body' });
    if (kind === 'probe' && this.version === 2) return json(200, { ok: true, bytes: body.length });
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
      if (this.failPhotos.has(id))
        return json(this.failPhotos.get(id)!, { ok: false, error: 'write failed' });
      if (this.photos.size >= this.failPhotoPostsAfter)
        return json(500, { ok: false, error: 'write failed' });
      this.photoPosts += 1;
      const existing = this.photos.get(id);
      if (existing && url.searchParams.get('replace') !== '1')
        return json(
          200,
          this.version === 2
            ? { ok: true, existed: true, bytes: existing.length, sha256: sha(existing) }
            : { ok: true },
        );
      this.photos.set(id, body);
      return json(
        200,
        this.version === 2 ? { ok: true, bytes: body.length, sha256: sha(body) } : { ok: true },
      );
    }
    return json(400, { ok: false, error: 'unknown kind' });
  };

  latest(): any {
    const name = [...this.files.keys()].sort().at(-1);
    return name ? JSON.parse(this.files.get(name)!) : null;
  }
}

/** A fresh "device": its own browser context (own IndexedDB) wired to the NAS. */
export async function device(
  makeContext: () => Promise<BrowserContext>,
  nas: FakeNas | { url: string },
): Promise<Page> {
  const context = await makeContext();
  if (nas instanceof FakeNas) await context.route('https://nas.test/**', nas.handle);
  const nasUrl = nas instanceof FakeNas ? 'https://nas.test/systema-backup.php' : nas.url;
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await page.evaluate(async (nasUrl) => {
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
    m.settingsStore.current = { nasUrl, nasToken: 'synthetic' };
    // Tests drive every sync explicitly; no debounced background syncs.
    m.nasBackup.schedule = () => {};
    m.nasBackup.retryDelays = [0, 0];
    (window as any).m = m;
  }, nasUrl);
  return page;
}

/** Run one sync on a device and return its outcome message. */
export async function sync(page: Page): Promise<{ ok: boolean; message: string }> {
  return page.evaluate(() => (window as any).m.nasBackup.sync());
}

/**
 * A real nas/systema-backup.php, one receiver folder per call, when a PHP
 * server is running (CI): SYSTEMA_PHP_URL serves SYSTEMA_PHP_ROOT.
 */
export function phpReceiver(
  receiver = 'nas/systema-backup.php',
): { url: string; dir: string } | null {
  const root = process.env.SYSTEMA_PHP_ROOT;
  const base = process.env.SYSTEMA_PHP_URL;
  if (!root || !base) return null;
  const name = `r${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const php = readFileSync(receiver, 'utf8').replace(
    "'CHANGE-ME-to-a-long-random-string'",
    "'synthetic'",
  );
  writeFileSync(join(dir, 'systema-backup.php'), php);
  return { url: `${base}/${name}/systema-backup.php`, dir };
}
