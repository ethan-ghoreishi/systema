import type { Transaction } from 'dexie';
import { db, type Trip } from './db';
import { newId } from './ids';
import { settingsStore } from './settings.svelte';
import { photoExt } from './photos';
import { buildDataBackup, toRecords, type Backup } from './export';
import { validateBackup } from './backup-validation';
import {
  CONFLICT,
  SYNC_TABLES,
  TOMBSTONE,
  countDifferences,
  mergeRecords,
  same,
  type FieldConflict,
  type PhotoMeta,
  type SyncRecords,
  type SyncTable,
} from './sync';
import { derivedTripFields, tripDisplayName } from './trip-shape';

/**
 * NAS sync — backup and device-to-device continuity through a NAS you host.
 *
 * Each sync (debounced after any change, on reconnect, on app open, or on
 * demand):
 *  1. uploads photos the NAS doesn't have yet — before any snapshot that
 *     references them, so a snapshot never points at a missing file;
 *  2. reads the NAS's newest snapshot and downloads photos this device lacks;
 *  3. three-way merges it with this device's data against the last snapshot
 *     both agreed on (see sync.ts), in one transaction: edits from both
 *     devices combine; the same field edited on both keeps the newer value and
 *     records a reviewable conflict, so nothing is overwritten silently;
 *  4. pushes the merged snapshot only if the NAS copy lacks something.
 * Snapshots carry their lineage, so the NAS copy is always a superset of what
 * every device has synced: a fresh or reset device can't replace it. An idle
 * sync writes nothing and pushes nothing (the receiver keeps 60 snapshots).
 *
 * Failures are expected (no wifi, NAS asleep): nothing is pushed or changed,
 * and it retries on the next trigger. The receiver is a small PHP file (see
 * docs/nas-backup-setup.md) that only ever writes into its own folder.
 */

const LAST_PUSH_KEY = 'nasLastDataAt'; // ms of the last successful push (name kept from v1)
const BASE_KEY = 'local:syncBase'; // the last snapshot this device agreed with the NAS
const SYNCED_AT_KEY = 'local:lastSyncAt';
const FILE_BACKUP_KEY = 'local:lastFileBackupAt';
const DEVICE_KEY = 'local:device';
const HISTORY_CAP = 200;
const DEBOUNCE_MS = 15_000;

/** A field edited differently on two devices, kept as a synced kv row. */
export interface ConflictRecord {
  table: SyncTable;
  recordId: string;
  tripId: string | null;
  label: string;
  fields: Record<string, { kept: unknown; other: unknown }>;
  keptDevice: string;
  otherDevice: string;
  at: number;
}

export interface SyncOutcome {
  ok: boolean;
  message: string;
}

interface Device {
  id: string;
  name: string;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Browser';
}

async function thisDevice(): Promise<Device> {
  const row = await db.kv.get(DEVICE_KEY);
  if (row?.value) return row.value as Device;
  const device = { id: newId(), name: deviceName() };
  await db.kv.put({ key: DEVICE_KEY, value: device });
  return device;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Write only the records that differ, so an idle sync makes no writes. */
async function applyMerge(local: SyncRecords, merged: SyncRecords): Promise<number> {
  let changes = 0;
  for (const table of SYNC_TABLES) {
    const key = table === 'kv' ? 'key' : 'id';
    const rows = (r: SyncRecords) => r[table] as unknown as Record<string, string>[];
    const before = new Map(rows(local).map((r) => [r[key], r]));
    const after = new Set(rows(merged).map((r) => r[key]));
    const puts = rows(merged).filter((r) => !same(before.get(r[key]), r));
    const dels = rows(local)
      .map((r) => r[key])
      .filter((k) => !after.has(k));
    const t = db.table(table);
    if (puts.length) await t.bulkPut(puts);
    if (dels.length) await t.bulkDelete(dels);
    changes += puts.length + dels.length;
  }
  // Photos only ever leave through tombstones (see sync.ts).
  const keep = new Set(merged.photosMeta.map((p) => p.id));
  const gone = local.photosMeta.map((p) => p.id).filter((id) => !keep.has(id));
  if (gone.length) await db.photos.bulkDelete(gone);
  return changes + gone.length;
}

/** Re-derive trip dates from the merged legs (deterministic on every device). */
async function fixDerivedDates(): Promise<void> {
  const [trips, cities] = await Promise.all([db.trips.toArray(), db.cities.toArray()]);
  for (const trip of trips) {
    const patch = derivedTripFields(
      trip,
      cities.filter((c) => c.tripId === trip.id),
    );
    if (Object.keys(patch).length) await db.trips.update(trip.id, patch);
  }
}

function conflictLabel(c: FieldConflict, m: SyncRecords): { tripId: string | null; label: string } {
  const row = (m[c.table] as unknown as Record<string, unknown>[]).find(
    (r) => (r.id ?? r.key) === c.recordId,
  );
  const tripId = c.table === 'trips' ? c.recordId : ((row?.tripId as string) ?? null);
  const trip = m.trips.find((t) => t.id === tripId) as Trip | undefined;
  const name = trip
    ? tripDisplayName(
        trip,
        m.cities.filter((x) => x.tripId === trip.id),
      )
    : 'A trip';
  const what =
    c.table === 'stops'
      ? `stop “${row?.name}”`
      : c.table === 'cities'
        ? `leg “${row?.name}”`
        : c.table === 'expenses'
          ? `expense “${row?.description || row?.subcategory}”`
          : c.table === 'kv'
            ? 'sync data'
            : '';
  return { tripId, label: what ? `${name}: ${what}` : name };
}

class NasBackup {
  running = $state(false);
  /** Last successful push of a snapshot. */
  lastDataAt = $state<number | null>(null);
  /** Last sync that completed (pushed or already up to date). */
  lastSyncAt = $state<number | null>(null);
  /** Last full backup file this device prepared for download. */
  lastFileBackupAt = $state<number | null>(null);
  /** The timestamps above have been read from storage. */
  healthLoaded = $state(false);
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

    void db.kv
      .bulkGet([LAST_PUSH_KEY, SYNCED_AT_KEY, FILE_BACKUP_KEY])
      .then(([push, synced, file]) => {
        if (typeof push?.value === 'number') this.lastDataAt = push.value;
        if (typeof synced?.value === 'number') this.lastSyncAt = synced.value;
        if (typeof file?.value === 'number') this.lastFileBackupAt = file.value;
        this.healthLoaded = true;
      });
    void this.refreshCounts();

    window.addEventListener('online', () => this.schedule(2_000));

    // Any write to user data schedules a sync — no call-site sprinkling.
    const bump = () => this.schedule();
    for (const table of [db.trips, db.cities, db.stops, db.expenses]) {
      table.hook('creating', bump);
      table.hook('deleting', bump);
      table.hook('updating', bump);
    }
    const photoChanged = (_key: unknown, _obj: unknown, transaction: Transaction) => {
      transaction.on('complete', () => {
        void this.refreshCounts();
        this.schedule();
      });
    };
    db.photos.hook('creating', photoChanged);
    db.photos.hook('deleting', photoChanged);

    // Catch anything that changed while the app was closed.
    this.schedule(4_000);
  }

  /** Debounced trigger; safe to call constantly. */
  schedule(delay = DEBOUNCE_MS): void {
    if (!this.configured) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  async refreshCounts(): Promise<void> {
    const photos = await db.photos.toArray();
    this.photosTotal = photos.length;
    this.photosBacked = photos.filter((p) => p.backedUp).length;
  }

  private endpoint(kind: string, extra = ''): string {
    const { nasUrl, nasToken } = settingsStore.current;
    const base = nasUrl.trim().replace(/[?#].*$/, '');
    return `${base}?kind=${kind}&token=${encodeURIComponent(nasToken.trim())}${extra}`;
  }

  private async post(kind: string, extra: string, body: string | ArrayBuffer): Promise<void> {
    const res = await fetch(this.endpoint(kind, extra), {
      method: 'POST',
      // A CORS-simple type: no preflight round trip per upload. The receiver
      // reads the raw body either way.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      bytes?: number;
    } | null;
    if (!res.ok || !json?.ok)
      throw new Error(`${kind} upload: ${json?.error ?? `HTTP ${res.status}`}`);
    // Receivers that report what they stored let a short write be caught.
    if (body instanceof ArrayBuffer && json.bytes !== undefined && json.bytes !== body.byteLength)
      throw new Error(`${kind} upload: stored ${json.bytes} of ${body.byteLength} bytes`);
  }

  /** Upload each photo the NAS doesn't have yet, one at a time (resumable). */
  private async uploadPhotos(): Promise<number> {
    const ids = await db.photos.filter((p) => !p.backedUp).primaryKeys();
    for (const id of ids) {
      const p = await db.photos.get(id);
      if (!p || p.backedUp) continue;
      const ext = photoExt(p.blob);
      // Bytes, not the stored Blob: IndexedDB-backed Blobs have uploaded empty
      // in WebKit. One photo in memory at a time.
      await this.post('photo', `&id=${p.id}&ext=${ext}`, await p.blob.arrayBuffer());
      await db.photos.update(p.id, { backedUp: true });
    }
    return ids.length;
  }

  /**
   * Download the NAS photos this device lacks (and hasn't deleted), saving each
   * as it arrives so memory stays flat and an interrupted sync resumes. Photos
   * are immutable and union-only, so adding them ahead of the merge is safe.
   */
  private async downloadPhotos(remote: Backup): Promise<{ fetched: number; unavailable: number }> {
    const have = new Set(await db.photos.toCollection().primaryKeys());
    const dead = new Set(
      [
        ...((await db.kv.where('key').startsWith(TOMBSTONE).primaryKeys()) as string[]),
        ...remote.settings.map((r) => r.key).filter((k) => k.startsWith(TOMBSTONE)),
      ].map((k) => k.slice(TOMBSTONE.length)),
    );
    let fetched = 0;
    let unavailable = 0;
    for (const meta of remote.photosMeta ?? []) {
      if (have.has(meta.id) || dead.has(meta.id)) continue;
      const res = await fetch(this.endpoint('photo', `&id=${meta.id}`));
      if (res.status === 404) {
        unavailable += 1; // never uploaded by its device yet; it will arrive later
        continue;
      }
      if (!res.ok) throw new Error(`photo download: HTTP ${res.status}`);
      const blob = await res.blob();
      await db.transaction('rw', db.photos, db.kv, async () => {
        if (await db.photos.get(meta.id)) return;
        if (await db.kv.get(`${TOMBSTONE}${meta.id}`)) return;
        await db.photos.add({ ...meta, blob, backedUp: true });
        fetched += 1;
      });
    }
    return { fetched, unavailable };
  }

  /**
   * The base for a device's first sync after updating from the add-only
   * version: if the NAS's newest (lineage-less) snapshot is this device's own
   * last push, it is exactly what both sides agreed on.
   */
  private async legacyBase(remote: Backup | null): Promise<Backup | null> {
    if (!remote || remote.sync) return null;
    const last = (await db.kv.get(LAST_PUSH_KEY))?.value;
    const at = Date.parse(remote.exportedAt);
    return typeof last === 'number' && Math.abs(at - last) < 60_000 ? remote : null;
  }

  /** Sync now. Never throws; the outcome says what happened. */
  async sync(): Promise<SyncOutcome> {
    if (!this.configured) return { ok: false, message: 'Set the receiver URL and token first.' };
    if (typeof navigator !== 'undefined' && !navigator.onLine)
      return { ok: false, message: 'Offline — syncs automatically when connected.' };
    const busy = { ok: false, message: 'A sync is already running.' };
    // One sync at a time, across tabs too (a Mac may have several open).
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request('systema-nas-sync', { ifAvailable: true }, (lock) =>
        lock ? this.syncOnce() : busy,
      );
    return this.syncOnce();
  }

  private async syncOnce(): Promise<SyncOutcome> {
    if (this.running) return { ok: false, message: 'A sync is already running.' };
    this.running = true;
    this.lastError = '';
    try {
      const device = await thisDevice();
      const uploaded = await this.uploadPhotos();

      const res = await fetch(this.endpoint('latest'));
      let remote: Backup | null = null;
      if (res.status !== 404) {
        if (!res.ok) throw new Error(`reading the NAS copy: HTTP ${res.status}`);
        remote = (await res.json()) as Backup;
        validateBackup(remote);
      }
      const photos = remote ? await this.downloadPhotos(remote) : { fetched: 0, unavailable: 0 };

      const otherDevice = remote?.sync?.deviceName ?? 'another device';
      const { changes, conflicts } = await db.transaction(
        'rw',
        [db.trips, db.cities, db.stops, db.expenses, db.photos, db.kv, db.fxRates],
        async () => {
          const local = toRecords(await buildDataBackup());
          const base =
            ((await db.kv.get(BASE_KEY))?.value as Backup | undefined) ??
            (await this.legacyBase(remote));
          const descends =
            !!base &&
            !!remote &&
            (base === remote ||
              (!!base.sync &&
                !!remote.sync &&
                (remote.sync.id === base.sync.id || remote.sync.history.includes(base.sync.id))));
          const result = mergeRecords(
            base ? toRecords(base) : null,
            local,
            remote ? toRecords(remote) : null,
            descends,
          );
          const changes = await applyMerge(local, result.merged);
          const now = Date.now();
          await db.kv.bulkPut(
            result.conflicts.map((c) => ({
              key: `${CONFLICT}${newId()}`,
              value: {
                table: c.table,
                recordId: c.recordId,
                ...conflictLabel(c, result.merged),
                fields: c.fields,
                keptDevice: c.keptLocal ? device.name : otherDevice,
                otherDevice: c.keptLocal ? otherDevice : device.name,
                at: now,
              } satisfies ConflictRecord,
            })),
          );
          await fixDerivedDates();
          if (remote) await db.kv.put({ key: BASE_KEY, value: remote });
          return { changes, conflicts: result.conflicts.length };
        },
      );

      // Push only when the NAS copy lacks something this device has.
      const snapshot = await buildDataBackup();
      const records = toRecords(snapshot);
      const ahead = remote
        ? countDifferences(records, toRecords(remote)) > 0
        : records.trips.length + records.kv.length > 0;
      if (ahead) {
        snapshot.sync = {
          id: newId(),
          device: device.id,
          deviceName: device.name,
          at: Date.now(),
          history: remote?.sync ? [...remote.sync.history, remote.sync.id].slice(-HISTORY_CAP) : [],
        };
        await this.post('data', '', JSON.stringify(snapshot));
        this.lastDataAt = Date.now();
        await db.kv.bulkPut([
          { key: BASE_KEY, value: snapshot },
          { key: LAST_PUSH_KEY, value: this.lastDataAt },
        ]);
      }
      this.lastSyncAt = Date.now();
      await db.kv.put({ key: SYNCED_AT_KEY, value: this.lastSyncAt });
      await this.refreshCounts();

      const parts = [
        changes && `${plural(changes, 'change')} from the NAS`,
        photos.fetched && `${plural(photos.fetched, 'photo')} downloaded`,
        uploaded && `${plural(uploaded, 'photo')} uploaded`,
        ahead && 'your changes sent',
        conflicts && `${plural(conflicts, 'edit')} made on two devices to review`,
        photos.unavailable &&
          `${plural(photos.unavailable, 'photo')} not on the NAS yet (still on the device that took them)`,
      ].filter(Boolean);
      return { ok: true, message: parts.length ? `Synced: ${parts.join(', ')}.` : 'Up to date.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return { ok: false, message: `Not synced (${msg}). Nothing on the NAS was replaced.` };
    } finally {
      this.running = false;
    }
  }

  /**
   * Fetch photo files from the NAS for photos restored without them (an older
   * NAS snapshot picked from the share holds only their metadata), un-deleting
   * them. Returns how many arrived.
   */
  async restorePhotos(metas: PhotoMeta[]): Promise<number> {
    let fetched = 0;
    for (const meta of metas) {
      if (await db.photos.get(meta.id)) continue;
      const res = await fetch(this.endpoint('photo', `&id=${meta.id}`));
      if (!res.ok) continue;
      const blob = await res.blob();
      await db.transaction('rw', db.photos, db.kv, async () => {
        if (await db.photos.get(meta.id)) return;
        await db.photos.add({ ...meta, blob, backedUp: true });
        await db.kv.delete(`${TOMBSTONE}${meta.id}`);
        fetched += 1;
      });
    }
    return fetched;
  }

  /** Note that a full backup file was prepared (for the backup-health status). */
  async recordFileBackup(): Promise<void> {
    this.lastFileBackupAt = Date.now();
    await db.kv.put({ key: FILE_BACKUP_KEY, value: this.lastFileBackupAt });
  }

  /**
   * Verify the NAS copy without changing anything: it must be readable and
   * valid, every photo it lists must be on the NAS, and it reports what a sync
   * would bring here and send from here.
   */
  async check(onProgress?: (done: number, total: number) => void): Promise<SyncOutcome> {
    if (!this.configured) return { ok: false, message: 'Set the receiver URL and token first.' };
    if (typeof navigator !== 'undefined' && !navigator.onLine)
      return { ok: false, message: 'Offline — check again when connected.' };
    try {
      const res = await fetch(this.endpoint('latest'));
      if (res.status === 404) return { ok: false, message: 'The NAS has no backup yet.' };
      if (!res.ok) throw new Error(`reading the NAS copy: HTTP ${res.status}`);
      const remote = (await res.json()) as Backup;
      validateBackup(remote);

      const metas = remote.photosMeta ?? [];
      let missing = 0;
      let done = 0;
      const queue = [...metas];
      const worker = async () => {
        for (let meta = queue.shift(); meta; meta = queue.shift()) {
          const ctrl = new AbortController();
          const r = await fetch(this.endpoint('photo', `&id=${meta.id}`), { signal: ctrl.signal });
          if (!r.ok) missing += 1;
          ctrl.abort(); // only the status matters; don't download the photo
          onProgress?.((done += 1), metas.length);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));

      const local = toRecords(await buildDataBackup());
      const base = (await db.kv.get(BASE_KEY))?.value as Backup | undefined;
      const remoteRecs = toRecords(remote);
      const descends =
        !!base?.sync &&
        !!remote.sync &&
        (remote.sync.id === base.sync.id || remote.sync.history.includes(base.sync.id));
      const { merged, conflicts } = mergeRecords(
        base ? toRecords(base) : null,
        local,
        remoteRecs,
        descends,
      );
      const incoming = countDifferences(merged, local);
      const outgoing = countDifferences(merged, remoteRecs);
      const when = new Date(remote.sync?.at ?? Date.parse(remote.exportedAt)).toLocaleString(
        'en-GB',
        { dateStyle: 'medium', timeStyle: 'short' },
      );
      const by = remote.sync ? ` by ${remote.sync.deviceName}` : '';
      const lines = [
        `NAS copy saved ${when}${by}: ${plural(remote.trips.length, 'trip')}, ${plural(remote.expenses.length, 'expense')}, ${plural(metas.length, 'photo')}.`,
        missing
          ? `${plural(missing, 'photo')} listed but not on the NAS yet (still on the device that took them).`
          : metas.length
            ? 'Every photo it lists is on the NAS.'
            : '',
        incoming || outgoing || conflicts.length
          ? `A sync would bring ${plural(incoming, 'change')} here and send ${plural(outgoing, 'change')}${conflicts.length ? `, with ${plural(conflicts.length, 'edit')} made on two devices` : ''}.`
          : 'This device and the NAS match.',
      ];
      return { ok: missing === 0, message: lines.filter(Boolean).join(' ') };
    } catch (err) {
      return {
        ok: false,
        message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Records on this device the NAS hasn't got yet (null: never synced). */
  async unsyncedChanges(): Promise<number | null> {
    const base = (await db.kv.get(BASE_KEY))?.value as Backup | undefined;
    if (!base) return null;
    return countDifferences(toRecords(await buildDataBackup()), toRecords(base));
  }
}

export const nasBackup = new NasBackup();
