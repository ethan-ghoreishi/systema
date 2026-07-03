import { db } from './db';
import { settingsStore } from './settings.svelte';
import { buildDataBackup } from './export';

/**
 * Opportunistic NAS backup — the Hess design, built.
 *
 * Whenever the receiver is reachable (home wifi, or anywhere if the NAS has a
 * public hostname), the app pushes:
 *  - a small data snapshot (everything except photo blobs) after any change,
 *    debounced so bursts of edits coalesce into one push;
 *  - each photo exactly once (tracked per photo via `backedUp`), which also
 *    makes "save to NAS, then delete locally to free space" safe.
 *
 * Failures are silent and expected — no wifi, NAS asleep, internet cut-out.
 * Nothing is lost; it simply tries again on the next change, reconnect, or
 * app open. The receiver is a ~60-line PHP file (see docs/nas-backup-setup.md)
 * that only ever writes into its own backup folder.
 */

const LAST_DATA_KEY = 'nasLastDataAt';
const DEBOUNCE_MS = 15_000;

class NasBackup {
  running = $state(false);
  lastDataAt = $state<number | null>(null);
  lastError = $state('');
  photosTotal = $state(0);
  photosBacked = $state(0);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private initialised = false;

  get configured(): boolean {
    return settingsStore.current.nasUrl.trim() !== '';
  }

  /** Register write hooks + connectivity triggers. Call once at app start. */
  init(): void {
    if (this.initialised || typeof window === 'undefined') return;
    this.initialised = true;

    void db.kv.get(LAST_DATA_KEY).then((row) => {
      if (row && typeof row.value === 'number') this.lastDataAt = row.value;
    });
    void this.refreshCounts();

    window.addEventListener('online', () => this.schedule(2_000));

    // Any write to user data schedules a push — no call-site sprinkling.
    const bump = () => this.schedule();
    for (const table of [db.trips, db.cities, db.stops, db.expenses]) {
      table.hook('creating', bump);
      table.hook('deleting', bump);
      table.hook('updating', bump);
    }
    db.photos.hook('creating', () => {
      void this.refreshCounts();
      this.schedule();
    });
    db.photos.hook('deleting', () => {
      void this.refreshCounts();
      this.schedule();
    });
    db.photos.hook('updating', (mods) => {
      // Marking a photo as backed up must not re-trigger a push loop.
      const keys = Object.keys(mods as object);
      if (keys.length === 1 && keys[0] === 'backedUp') return;
      this.schedule();
    });

    // Catch anything that changed while the app was closed.
    this.schedule(4_000);
  }

  /** Debounced trigger; safe to call constantly. */
  schedule(delay = DEBOUNCE_MS): void {
    if (!this.configured) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  async refreshCounts(): Promise<void> {
    const photos = await db.photos.toArray();
    this.photosTotal = photos.length;
    this.photosBacked = photos.filter((p) => p.backedUp).length;
  }

  /** Push a data snapshot, then any photos not yet on the NAS. */
  async run(): Promise<void> {
    if (this.running || !this.configured) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    this.running = true;
    this.lastError = '';

    try {
      const { nasUrl, nasToken } = settingsStore.current;
      const base = nasUrl.trim().replace(/[?#].*$/, '');
      const endpoint = (kind: string, extra = '') =>
        `${base}?kind=${kind}&token=${encodeURIComponent(nasToken.trim())}${extra}`;

      // 1) Data snapshot (small — no photo blobs).
      const snapshot = await buildDataBackup();
      const res = await fetch(endpoint('data'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(snapshot),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      this.lastDataAt = Date.now();
      await db.kv.put({ key: LAST_DATA_KEY, value: this.lastDataAt });

      // 2) Photos, one file each, exactly once.
      const photos = await db.photos.toArray();
      for (const p of photos) {
        if (p.backedUp) continue;
        const ext = p.blob.type.includes('png')
          ? 'png'
          : p.blob.type.includes('webp')
            ? 'webp'
            : 'jpg';
        const r = await fetch(endpoint('photo', `&id=${p.id}&ext=${ext}`), {
          method: 'POST',
          body: p.blob,
        });
        const b = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !b?.ok) throw new Error(b?.error ?? `photo: HTTP ${r.status}`);
        await db.photos.update(p.id, { backedUp: true });
      }
      await this.refreshCounts();
    } catch (err) {
      // Expected when away from the NAS — quiet retry on the next trigger.
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.running = false;
    }
  }
}

export const nasBackup = new NasBackup();
