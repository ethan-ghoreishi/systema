import type { Transaction } from 'dexie';
import { db, type Photo, type Trip } from './db';
import { newId } from './ids';
import { settingsStore } from './settings.svelte';
import { photoExt, sha256Hex } from './photos';
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
import {
  NasError,
  backoffMs,
  classifyReply,
  classifyThrown,
  explain,
  fatal,
  probeVerdict,
  receiverUrl,
  redact,
  transient,
  type Check,
  type FailureKind,
} from './nas-diagnostics';

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
 * Each photo is its own upload, verified (size, and SHA-256 where the receiver
 * reports it) before it counts as backed up. One photo that keeps failing —
 * too large for the receiver, say — no longer holds everything else back:
 * the others upload, the snapshot is pushed, and the sync reports a partial
 * backup naming the photos left, which retry with a growing wait (or at once,
 * with "Retry failed only"). A failure of the receiver itself (wrong token,
 * nothing at the URL, unreachable) stops the sync: nothing is pushed or
 * changed, and it retries on the next trigger. The receiver is a small PHP
 * file (see docs/nas-backup-setup.md) that only ever writes into its own folder.
 */

const LAST_PUSH_KEY = 'nasLastDataAt'; // ms of the last successful push (name kept from v1)
const BASE_KEY = 'local:syncBase'; // the last snapshot this device agreed with the NAS
const SYNCED_AT_KEY = 'local:lastSyncAt';
const FILE_BACKUP_KEY = 'local:lastFileBackupAt';
const DEVICE_KEY = 'local:device';
const ATTEMPT_KEY = 'local:nasAttempt';
const FAILURES_KEY = 'local:nasFailures';
const MISSING_KEY = 'local:nasMissing';
const TEST_KEY = 'local:nasTest';
// Which photos are on the NAS, kept apart from the photo rows: those stay
// write-once (rewriting a multi-MB row just to flip a flag copies the image
// again, and WebKit has lost Blobs from rewritten rows). 'redo' overrides an
// older row's own `backedUp` when its NAS copy turns out missing or damaged.
const PHOTO_STATE_KEY = 'local:nasPhotoState';
type PhotoState = Record<string, 'up' | 'redo'>;
const isBacked = (p: { id: string; backedUp?: boolean }, state: PhotoState) =>
  state[p.id] === 'up' || (!!p.backedUp && state[p.id] !== 'redo');
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
  /** Synced, but some photos are still not on the NAS. */
  partial?: boolean;
  message: string;
}

/** The last sync attempt, whatever its outcome (device-local). */
export interface SyncAttempt {
  at: number;
  ok: boolean;
  partial: boolean;
  kind?: FailureKind;
  message: string;
}

/** A photo that hasn't uploaded, and why (device-local). */
export interface PhotoFailure {
  tripId: string;
  attempts: number;
  lastAt: number;
  kind: FailureKind;
  error: string;
  bytes: number;
}

/** Photos a snapshot lists that the NAS doesn't hold (from a check, sync or restore). */
export interface MissingPhotos {
  at: number;
  items: { id: string; tripId: string }[];
}

export interface ConnectionTest {
  at: number;
  ok: boolean;
  checks: Check[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const online = () => typeof navigator === 'undefined' || navigator.onLine;

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
          : c.table === 'moments'
            ? `moment “${row?.title}”`
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
  /** Why the last sync failed ('' after a success). */
  lastError = $state('');
  lastAttempt = $state<SyncAttempt | null>(null);
  photosTotal = $state(0);
  photosBacked = $state(0);
  /** Photos that failed to upload, by id, with the reason. */
  failures = $state<Record<string, PhotoFailure>>({});
  /** Photos listed in the NAS copy but not on the NAS. */
  missing = $state<MissingPhotos | null>(null);
  lastTest = $state<ConnectionTest | null>(null);
  /** Upload progress while photos are going up. */
  progress = $state<{ done: number; total: number } | null>(null);
  /** Pauses between quick retries of one photo (tests set these to 0). */
  retryDelays = [1_000, 3_000];

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
      .bulkGet([
        LAST_PUSH_KEY,
        SYNCED_AT_KEY,
        FILE_BACKUP_KEY,
        ATTEMPT_KEY,
        FAILURES_KEY,
        MISSING_KEY,
        TEST_KEY,
      ])
      .then(([push, synced, file, attempt, failures, missing, test]) => {
        if (typeof push?.value === 'number') this.lastDataAt = push.value;
        if (typeof synced?.value === 'number') this.lastSyncAt = synced.value;
        if (typeof file?.value === 'number') this.lastFileBackupAt = file.value;
        if (attempt?.value) this.lastAttempt = attempt.value as SyncAttempt;
        if (failures?.value) this.failures = failures.value as Record<string, PhotoFailure>;
        if (missing?.value) this.missing = missing.value as MissingPhotos;
        if (test?.value) this.lastTest = test.value as ConnectionTest;
        this.healthLoaded = true;
      });
    void this.refreshCounts();

    window.addEventListener('online', () => this.schedule(2_000));

    // Any write to user data schedules a sync — no call-site sprinkling.
    const bump = () => this.schedule();
    for (const table of [db.trips, db.cities, db.stops, db.expenses, db.moments]) {
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

  private async photoState(): Promise<PhotoState> {
    return ((await db.kv.get(PHOTO_STATE_KEY))?.value as PhotoState | undefined) ?? {};
  }

  private async setPhotoState(ids: string[], value: 'up' | 'redo'): Promise<void> {
    if (!ids.length) return;
    await db.transaction('rw', db.kv, async () => {
      const state = await this.photoState();
      for (const id of ids) state[id] = value;
      await db.kv.put({ key: PHOTO_STATE_KEY, value: state });
    });
  }

  /** Photos not on the NAS yet, oldest first. */
  private async pendingPhotoIds(): Promise<string[]> {
    const state = await this.photoState();
    const rows: { id: string; createdAt: number }[] = [];
    await db.photos.each((p) => {
      if (!isBacked(p, state)) rows.push({ id: p.id, createdAt: p.createdAt });
    });
    return rows.sort((a, b) => a.createdAt - b.createdAt).map((r) => r.id);
  }

  async refreshCounts(): Promise<void> {
    const state = await this.photoState();
    const seen: Record<string, true> = {};
    let total = 0;
    let backed = 0;
    await db.photos.each((p) => {
      seen[p.id] = true;
      total += 1;
      if (isBacked(p, state)) backed += 1;
    });
    this.photosTotal = total;
    this.photosBacked = backed;
    // Forget photos deleted since.
    const stale = Object.keys(state).filter((id) => !seen[id]);
    if (stale.length)
      await db.transaction('rw', db.kv, async () => {
        const cur = await this.photoState();
        for (const id of stale) if (!seen[id]) delete cur[id];
        await db.kv.put({ key: PHOTO_STATE_KEY, value: cur });
      });
  }

  private get token(): string {
    return settingsStore.current.nasToken.trim();
  }

  private endpoint(
    kind: string,
    extra = '',
    base = receiverUrl(settingsStore.current.nasUrl),
  ): string {
    return `${base}?kind=${kind}&token=${encodeURIComponent(this.token)}${extra}`;
  }

  /** Never let the token reach a message, a log or storage. */
  private safe(text: string): string {
    return redact(text, this.token);
  }

  private async request(
    method: 'GET' | 'POST',
    kind: string,
    extra = '',
    body?: string | ArrayBuffer,
  ): Promise<Response> {
    try {
      return await fetch(this.endpoint(kind, extra), {
        method,
        // A CORS-simple type: no preflight round trip per upload. The receiver
        // reads the raw body either way.
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }
          : {}),
      });
    } catch (err) {
      const kindOf = classifyThrown(err, online());
      throw new NasError(explain(kindOf), kindOf);
    }
  }

  private async post(kind: string, extra: string, body: string | ArrayBuffer): Promise<any> {
    const res = await this.request('POST', kind, extra, body);
    const json = (await res.json().catch(() => null)) as any;
    const sent = typeof body === 'string' ? body.length : body.byteLength;
    const failure = classifyReply(res.status, json, sent);
    if (failure)
      throw new NasError(
        explain(failure, json?.error ?? `HTTP ${res.status}`, sent),
        failure,
        res.status,
      );
    return json;
  }

  /**
   * Whether the NAS already holds this exact photo (size and SHA-256), asked
   * of the current receiver without sending the photo. False when it can't
   * say (the original receiver answers with the image itself).
   */
  private async nasHasCopy(id: string, bytes: number, sha256?: string): Promise<boolean> {
    if (!sha256) return false;
    const res = await this.request('GET', 'photo', `&id=${id}&meta=1`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return false;
    const json = (await res.json().catch(() => null)) as { bytes?: number; sha256?: string } | null;
    return json?.bytes === bytes && json?.sha256 === sha256;
  }

  /**
   * A stored photo's bytes. WebKit has failed to read an IndexedDB Blob
   * ("The object can not be found here") and then read it fine moments later,
   * so a failed read is retried on a fresh copy of the record.
   */
  private async readBytes(id: string): Promise<{ p: Photo; buf: ArrayBuffer } | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const p = await db.photos.get(id);
      if (!p) return null;
      try {
        return { p, buf: await p.blob.arrayBuffer() };
      } catch {
        await sleep(this.retryDelays[0] ? 300 * (attempt + 1) : 0);
      }
    }
    throw new NasError(explain('unreadable'), 'unreadable');
  }

  /**
   * Upload one photo and verify what landed; retries a blip twice. A photo
   * that failed before is first looked up on the NAS: its upload may have
   * landed with only the reply lost.
   *
   * The bytes sent are hashed as they are now and checked against the hash
   * recorded when the photo was taken: a copy damaged on this device is never
   * sent, and a damaged NAS copy is replaced only by one proven intact (older
   * photos without a recorded hash never replace anything).
   */
  private async uploadOne(id: string, failedBefore = false): Promise<void> {
    // Bytes, not the stored Blob: IndexedDB-backed Blobs have uploaded empty
    // in WebKit. One photo in memory at a time.
    const read = await this.readBytes(id);
    if (!read) return;
    const { p, buf } = read;
    const ext = photoExt(p.blob);
    // Hashed here only — older photos don't gain the fields: the previous
    // version never updates a photo's metadata from a snapshot, so changing
    // it would make two devices on different versions push forever.
    const sha256 = await sha256Hex(buf);
    const intact =
      p.sha256 && sha256
        ? p.sha256 === sha256
        : p.bytes != null
          ? p.bytes === buf.byteLength
          : undefined;
    if (intact === false) throw new NasError(explain('unreadable'), 'unreadable');
    if (failedBefore && (await this.nasHasCopy(id, buf.byteLength, sha256))) {
      await this.setPhotoState([id], 'up');
      return;
    }
    let replace = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const json = await this.post(
          'photo',
          `&id=${p.id}&ext=${ext}${replace ? '&replace=1' : ''}`,
          buf,
        );
        // Receivers that report what they stored let a short or damaged write be caught.
        const sizeOk = json.bytes === undefined || json.bytes === buf.byteLength;
        const hashOk = !json.sha256 || !sha256 || json.sha256 === sha256;
        if (!sizeOk || !hashOk) {
          const what = !sizeOk ? `${json.bytes} of ${buf.byteLength} bytes` : 'SHA-256 differs';
          if (json.existed && !replace && intact === true) {
            // A damaged copy already on the NAS, and this one is the photo as taken.
            replace = true;
            attempt = -1;
            continue;
          }
          throw new NasError(
            explain('verify', json.existed ? `${what}; the NAS copy is left as it is` : what),
            'verify',
          );
        }
        await this.setPhotoState([id], 'up');
        return;
      } catch (err) {
        const kind = err instanceof NasError ? err.kind : 'other';
        if (!transient(kind) || attempt >= this.retryDelays.length) throw err;
        await sleep(this.retryDelays[attempt]);
      }
    }
  }

  /** Whether the receiver answers at all (no token, nothing written). */
  private async receiverAnswers(): Promise<boolean> {
    return fetch(receiverUrl(settingsStore.current.nasUrl)).then(
      (r) => r.ok,
      () => false,
    );
  }

  private async saveFailures(): Promise<void> {
    await db.kv.put({ key: FAILURES_KEY, value: $state.snapshot(this.failures) });
  }

  /**
   * Upload the photos the NAS doesn't have yet, one at a time (resumable). A
   * photo that fails is recorded and skipped until its backoff has passed —
   * the rest carry on. The receiver failing as a whole (or every attempt
   * unreachable) stops here and throws.
   */
  private async uploadPhotos(
    only?: Set<string>,
  ): Promise<{ uploaded: number; failed: number; waiting: number }> {
    const ids = await this.pendingPhotoIds();
    const queue = only ? ids.filter((id) => only.has(id)) : ids;
    let uploaded = 0;
    let failed = 0;
    let waiting = 0;
    // Photos that got no answer at all: a size limit if the NAS answers otherwise.
    const cutOff: { id: string; prev?: PhotoFailure }[] = [];
    let answers: boolean | undefined;
    const record = async (
      id: string,
      prev: PhotoFailure | undefined,
      kind: FailureKind,
      error: string,
    ) => {
      const p = await db.photos.get(id);
      this.failures[id] = {
        tripId: p?.tripId ?? '',
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: Date.now(),
        kind,
        error: this.safe(error),
        bytes: p?.blob.size ?? 0,
      };
      await this.saveFailures();
      failed += 1;
    };
    this.progress = queue.length ? { done: 0, total: queue.length } : null;
    try {
      for (const id of queue) {
        const prev = this.failures[id];
        if (!only && prev && Date.now() < prev.lastAt + backoffMs(prev.attempts)) {
          waiting += 1;
          continue;
        }
        try {
          await this.uploadOne(id, !!prev);
          uploaded += 1;
          if (prev) {
            delete this.failures[id];
            await this.saveFailures();
          }
          this.photosBacked += 1;
        } catch (err) {
          const e = err instanceof NasError ? err : new NasError(String(err), 'other');
          if (fatal(e.kind)) throw e;
          if (e.kind === 'unreachable') {
            // Nothing through yet: is it the network (stop, blame no photo) or
            // this photo being cut off (carry on with the others)? Ask once.
            if (uploaded === 0 && answers === undefined) answers = await this.receiverAnswers();
            if (uploaded === 0 && !answers) throw e;
            cutOff.push({ id, prev });
          } else {
            await record(id, prev, e.kind, e.message);
          }
        }
        if (this.progress) this.progress = { ...this.progress, done: this.progress.done + 1 };
      }
      // ponytail: heuristic. An upload that got no answer while the NAS answers
      // otherwise is almost always over a size limit: nginx (a 413 without CORS
      // headers) and PHP printing a warning before its headers both look like
      // a dropped connection to the browser. Test connection confirms it.
      for (const c of cutOff)
        await record(
          c.id,
          c.prev,
          'too-large',
          explain(
            'too-large',
            'The connection was cut off while sending it, though the NAS answers.',
            (await db.photos.get(c.id))?.blob.size,
          ),
        );
    } finally {
      this.progress = null;
    }
    return { uploaded, failed, waiting };
  }

  private async setMissing(items: { id: string; tripId: string }[]): Promise<void> {
    this.missing = items.length ? { at: Date.now(), items } : null;
    await db.kv.put({ key: MISSING_KEY, value: $state.snapshot(this.missing) });
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
    const absent: { id: string; tripId: string }[] = [];
    for (const meta of remote.photosMeta ?? []) {
      if (have.has(meta.id) || dead.has(meta.id)) continue;
      const res = await this.request('GET', 'photo', `&id=${meta.id}`);
      if (res.status === 404) {
        absent.push({ id: meta.id, tripId: meta.tripId }); // its device hasn't uploaded it yet
        continue;
      }
      if (!res.ok)
        throw new NasError(
          explain('server', `photo download: HTTP ${res.status}`),
          'server',
          res.status,
        );
      // Own bytes, not a network-backed Blob: WebKit can store those unreadably.
      const blob = new Blob([await res.arrayBuffer()], {
        type: res.headers.get('content-type') ?? '',
      });
      await db.transaction('rw', db.photos, db.kv, async () => {
        if (await db.photos.get(meta.id)) return;
        if (await db.kv.get(`${TOMBSTONE}${meta.id}`)) return;
        await db.photos.add({ ...meta, blob, backedUp: true });
        fetched += 1;
      });
    }
    // What this device can't get and doesn't hold: reported, never skipped silently.
    await this.setMissing(absent);
    return { fetched, unavailable: absent.length };
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

  private async readLatest(): Promise<Backup | null> {
    const res = await this.request('GET', 'latest');
    if (res.status === 404) {
      const json = await res.json().catch(() => null);
      // The receiver answers "no snapshots yet" in JSON; a web server's own
      // 404 page means there is no receiver at that address.
      if (json) return null;
      throw new NasError(explain('not-found'), 'not-found', 404);
    }
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      const kind = classifyReply(res.status, json) ?? 'other';
      throw new NasError(
        explain(kind, `reading the NAS copy: HTTP ${res.status}`),
        kind,
        res.status,
      );
    }
    const remote = (await res.json().catch(() => {
      throw new NasError(explain('bad-response'), 'bad-response');
    })) as Backup;
    validateBackup(remote);
    return remote;
  }

  private async recordAttempt(a: SyncAttempt): Promise<void> {
    this.lastAttempt = a;
    await db.kv.put({ key: ATTEMPT_KEY, value: a }).catch(() => {});
  }

  /** Sync now. Never throws; the outcome says what happened. */
  async sync(): Promise<SyncOutcome> {
    if (!this.configured) return { ok: false, message: 'Set the receiver URL and token first.' };
    if (!online()) return { ok: false, message: explain('offline') };
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
    let outcome: SyncOutcome;
    let kind: FailureKind | undefined;
    try {
      const device = await thisDevice();
      const up = await this.uploadPhotos();

      const remote = await this.readLatest();
      const photos = remote ? await this.downloadPhotos(remote) : { fetched: 0, unavailable: 0 };

      const otherDevice = remote?.sync?.deviceName ?? 'another device';
      const { changes, conflicts } = await db.transaction(
        'rw',
        [db.trips, db.cities, db.stops, db.expenses, db.moments, db.photos, db.kv, db.fxRates],
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

      // Push only when the NAS copy lacks something this device has — even if
      // some photos failed: the data must not wait on one stubborn photo.
      const snapshot = await buildDataBackup();
      const records = toRecords(snapshot);
      const ahead = remote
        ? countDifferences(records, toRecords(remote), true) > 0
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

      const outstanding = Object.keys(this.failures).length;
      const parts = [
        changes && `${plural(changes, 'change')} from the NAS`,
        photos.fetched && `${plural(photos.fetched, 'photo')} downloaded`,
        up.uploaded && `${plural(up.uploaded, 'photo')} uploaded`,
        ahead && 'your changes sent',
        conflicts && `${plural(conflicts, 'edit')} made on two devices to review`,
        photos.unavailable &&
          `${plural(photos.unavailable, 'photo')} not on the NAS yet (still on the device that took them)`,
      ].filter(Boolean);
      const done = parts.length ? `Synced: ${parts.join(', ')}.` : 'Up to date.';
      outcome = outstanding
        ? {
            ok: true,
            partial: true,
            message: `${done} ${plural(outstanding, 'photo')} from this device not on the NAS yet — see Backup in Settings.`,
          }
        : { ok: true, message: done };
    } catch (err) {
      kind = classifyThrown(err, online());
      const msg = this.safe(err instanceof Error ? err.message : String(err));
      this.lastError = msg;
      outcome = { ok: false, message: `Not synced (${msg}). Nothing on the NAS was replaced.` };
    } finally {
      this.running = false;
    }
    await this.recordAttempt({
      at: Date.now(),
      ok: outcome.ok,
      partial: !!outcome.partial,
      kind,
      message: outcome.message,
    });
    return outcome;
  }

  /** Upload just the photos that failed, now, ignoring their wait. */
  async retryFailed(): Promise<SyncOutcome> {
    if (!this.configured) return { ok: false, message: 'Set the receiver URL and token first.' };
    if (this.running) return { ok: false, message: 'A sync is already running.' };
    const ids = Object.keys(this.failures);
    if (!ids.length) return { ok: true, message: 'No failed photos to retry.' };
    this.running = true;
    try {
      // Photos deleted since they failed have nothing left to retry.
      const present = new Set((await db.photos.bulkGet(ids)).filter(Boolean).map((p) => p!.id));
      for (const id of ids) if (!present.has(id)) delete this.failures[id];
      await this.saveFailures();
      const r = await this.uploadPhotos(present);
      await this.refreshCounts();
      if (r.uploaded) this.schedule(1_000); // the snapshot can now list them as stored
      const left = Object.keys(this.failures).length;
      return {
        ok: left === 0,
        partial: left > 0,
        message: left
          ? `${plural(r.uploaded, 'photo')} uploaded; ${plural(left, 'photo')} still failing.`
          : `${plural(r.uploaded, 'photo')} uploaded. Every photo on this device is on the NAS.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Retry failed (${this.safe(err instanceof Error ? err.message : String(err))}).`,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Fetch photo files from the NAS for photos restored without them (an older
   * NAS snapshot picked from the share holds only their metadata), un-deleting
   * them. Reports which ones the NAS doesn't have, instead of skipping them.
   */
  async restorePhotos(metas: PhotoMeta[]): Promise<{ fetched: number; missing: PhotoMeta[] }> {
    let fetched = 0;
    const missing: PhotoMeta[] = [];
    for (const meta of metas) {
      if (await db.photos.get(meta.id)) continue;
      const res = await this.request('GET', 'photo', `&id=${meta.id}`);
      if (!res.ok) {
        missing.push(meta);
        continue;
      }
      // Own bytes, not a network-backed Blob: WebKit can store those unreadably.
      const blob = new Blob([await res.arrayBuffer()], {
        type: res.headers.get('content-type') ?? '',
      });
      await db.transaction('rw', db.photos, db.kv, async () => {
        if (await db.photos.get(meta.id)) return;
        await db.photos.add({ ...meta, blob, backedUp: true });
        await db.kv.delete(`${TOMBSTONE}${meta.id}`);
        fetched += 1;
      });
    }
    if (missing.length) await this.setMissing(missing.map((m) => ({ id: m.id, tripId: m.tripId })));
    return { fetched, missing };
  }

  /** Note that a full backup file was prepared (for the backup-health status). */
  async recordFileBackup(): Promise<void> {
    this.lastFileBackupAt = Date.now();
    await db.kv.put({ key: FILE_BACKUP_KEY, value: this.lastFileBackupAt });
  }

  /** The receiver's photo listing (current receiver), or null on the original one. */
  private async photoListing(): Promise<Map<string, number> | null> {
    const res = await this.request('GET', 'photos');
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      photos?: { id: string; bytes: number }[];
    } | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.photos)) return null;
    return new Map(json.photos.map((p) => [p.id, p.bytes]));
  }

  /**
   * Verify the NAS copy: it must be readable and valid, and every photo it
   * lists must be on the NAS at the right size. It reports what a sync would
   * bring here and send from here, and names the photos that are missing.
   * The only thing it changes is local: photos this device holds that the NAS
   * lacks (or holds damaged) are queued to upload again.
   */
  async check(onProgress?: (done: number, total: number) => void): Promise<SyncOutcome> {
    if (!this.configured) return { ok: false, message: 'Set the receiver URL and token first.' };
    if (!online()) return { ok: false, message: explain('offline') };
    try {
      const remote = await this.readLatest();
      if (!remote) return { ok: false, message: 'The NAS has no backup yet.' };

      const metas = remote.photosMeta ?? [];
      const listing = await this.photoListing();
      const absent: PhotoMeta[] = [];
      const damaged: PhotoMeta[] = [];
      if (listing) {
        for (const m of metas) {
          if (!listing.has(m.id)) absent.push(m);
          else if (m.bytes != null && listing.get(m.id) !== m.bytes) damaged.push(m);
        }
        onProgress?.(metas.length, metas.length);
      } else {
        // The original receiver can't list: ask for each photo (status only).
        let done = 0;
        const queue = [...metas];
        const worker = async () => {
          for (let meta = queue.shift(); meta; meta = queue.shift()) {
            const ctrl = new AbortController();
            const r = await fetch(this.endpoint('photo', `&id=${meta.id}`), {
              signal: ctrl.signal,
            });
            if (!r.ok) absent.push(meta);
            ctrl.abort(); // only the status matters; don't download the photo
            onProgress?.((done += 1), metas.length);
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
      }

      // Recovery: what this device holds goes up again on the next sync.
      const problem = [...absent, ...damaged];
      const local = await db.photos.bulkGet(problem.map((m) => m.id));
      const requeue = local.filter((p): p is NonNullable<typeof p> => !!p);
      await this.setPhotoState(
        requeue.map((p) => p.id),
        'redo',
      );
      if (requeue.length) await this.refreshCounts();
      await this.setMissing(
        absent
          .filter((m) => !requeue.some((p) => p.id === m.id))
          .map((m) => ({
            id: m.id,
            tripId: m.tripId,
          })),
      );

      const localRecs = toRecords(await buildDataBackup());
      const base = (await db.kv.get(BASE_KEY))?.value as Backup | undefined;
      const remoteRecs = toRecords(remote);
      const descends =
        !!base?.sync &&
        !!remote.sync &&
        (remote.sync.id === base.sync.id || remote.sync.history.includes(base.sync.id));
      const { merged, conflicts } = mergeRecords(
        base ? toRecords(base) : null,
        localRecs,
        remoteRecs,
        descends,
      );
      const incoming = countDifferences(merged, localRecs);
      const outgoing = countDifferences(merged, remoteRecs, true);
      const when = new Date(remote.sync?.at ?? Date.parse(remote.exportedAt)).toLocaleString(
        'en-GB',
        { dateStyle: 'medium', timeStyle: 'short' },
      );
      const by = remote.sync ? ` by ${remote.sync.deviceName}` : '';
      const lines = [
        `NAS copy saved ${when}${by}: ${plural(remote.trips.length, 'trip')}, ${plural(remote.expenses.length, 'expense')}, ${plural(metas.length, 'photo')}.`,
        absent.length
          ? `${plural(absent.length, 'photo')} listed but not on the NAS yet (still on the device that took them).`
          : metas.length
            ? 'Every photo it lists is on the NAS.'
            : '',
        damaged.length ? `${plural(damaged.length, 'photo')} on the NAS at the wrong size.` : '',
        requeue.length
          ? `${plural(requeue.length, 'photo')} of those ${requeue.length === 1 ? 'is' : 'are'} on this device and will upload again on the next sync.`
          : '',
        incoming || outgoing || conflicts.length
          ? `A sync would bring ${plural(incoming, 'change')} here and send ${plural(outgoing, 'change')}${conflicts.length ? `, with ${plural(conflicts.length, 'edit')} made on two devices` : ''}.`
          : 'This device and the NAS match.',
      ];
      return { ok: problem.length === 0, message: lines.filter(Boolean).join(' ') };
    } catch (err) {
      return {
        ok: false,
        message: `Check failed: ${this.safe(err instanceof Error ? err.message : String(err))}`,
      };
    }
  }

  /**
   * Test connection: each step that can fail, in order, with what to do —
   * the address, reaching the receiver (and telling CORS apart from no
   * connection), the token, and whether an upload the size of the largest
   * photo arrives intact. Writes nothing on the NAS.
   */
  async testConnection(): Promise<ConnectionTest> {
    const checks: Check[] = [];
    const finish = async () => {
      const result = { at: Date.now(), ok: checks.every((c) => c.ok), checks };
      this.lastTest = result;
      await db.kv.put({ key: TEST_KEY, value: result }).catch(() => {});
      return result;
    };
    const url = settingsStore.current.nasUrl.trim();
    const parsed = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      checks.push({ label: 'Address', ok: false, detail: 'Not a web address (https://…).' });
      return finish();
    }
    if (location.protocol === 'https:' && parsed.protocol === 'http:') {
      checks.push({
        label: 'Address',
        ok: false,
        detail:
          'This app runs over HTTPS, so the browser blocks an http:// receiver (mixed content). Use https:// with a valid certificate — see the setup guide.',
      });
      return finish();
    }
    let base = receiverUrl(url);
    const shown = (u: string) => u.replace(/^https?:\/\//, '');
    checks.push({ label: 'Address', ok: true, detail: shown(base) });
    if (!online()) {
      checks.push({ label: 'Network', ok: false, detail: explain('offline') });
      return finish();
    }

    // 1. Reach the receiver (no token needed).
    type Info = { version?: number; maxBody?: number; displayErrors?: boolean; writable?: boolean };
    const probe = async (u: string) => {
      try {
        const res = await fetch(u);
        const json = await res.json().catch(() => null);
        return { res, json, isReceiver: res.ok && json?.service === 'systema-backup' };
      } catch {
        return null; // no answer this page may read
      }
    };
    let found = await probe(base);
    // Not the receiver at the saved address: look where it should be, at the
    // host's /systema-backup.php, and switch only once the token works there.
    let moved = '';
    if (!found?.isReceiver) {
      const usual = `${new URL(base).origin}/systema-backup.php`;
      const there = usual !== base ? await probe(usual) : null;
      if (there?.isReceiver) {
        const res = await fetch(this.endpoint('latest', '', usual)).catch(() => null);
        if (res && (res.ok || res.status === 404)) {
          moved = base;
          base = usual;
          found = there;
          settingsStore.current.nasUrl = usual;
          await settingsStore.save();
          checks[0] = { label: 'Address', ok: true, detail: shown(base) };
        }
      }
    }
    let info: Info | null;
    if (found?.isReceiver) {
      const json = found.json as Info;
      info = json;
      checks.push({
        label: 'Receiver',
        ok: json.writable !== false,
        detail:
          json.writable === false
            ? "Found, but it can't write to its systema-backups folder: give Web Station write access."
            : `Found${json.version ? ` (version ${json.version})` : ' (original version: update it for verified uploads and a photo list)'}.${moved ? ` The saved address (${shown(moved)}) isn't the receiver; switched to this one.` : ''}`,
      });
    } else if (found) {
      checks.push({
        label: 'Receiver',
        ok: false,
        detail:
          found.res.status === 404
            ? explain('not-found')
            : found.json
              ? `HTTP ${found.res.status}.`
              : explain('bad-response'),
      });
      return finish();
    } else {
      // No answer the page may read. Ask again without CORS: an (opaque) answer
      // means the server is there and only the headers are missing.
      const reached = await fetch(base, { mode: 'no-cors' }).then(
        () => true,
        () => false,
      );
      checks.push({
        label: 'Receiver',
        ok: false,
        detail: reached
          ? `The server answered, but not as the receiver this app may read: ${shown(base)} is a page without the receiver's CORS headers — the address isn't the receiver's (it should end in /systema-backup.php), or something in front of PHP strips them.`
          : "No connection: wrong address, a port closed from this network, the NAS off, or a certificate this device doesn't trust. Open the address in Safari — a certificate warning there means the certificate. (Browsers don't tell an app which it is.)",
      });
      return finish();
    }

    // 2. The token.
    try {
      const res = await this.request('GET', 'latest');
      const json = await res.json().catch(() => null);
      if (res.status === 403) {
        checks.push({ label: 'Token', ok: false, detail: explain('auth') });
        return finish();
      }
      checks.push({
        label: 'Token',
        ok: res.ok || res.status === 404,
        detail: res.ok
          ? `Accepted. Newest snapshot ${new Date(json?.sync?.at ?? Date.parse(json?.exportedAt ?? '')).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`
          : res.status === 404
            ? 'Accepted (no snapshot on the NAS yet).'
            : `HTTP ${res.status}.`,
      });
    } catch (err) {
      checks.push({
        label: 'Token',
        ok: false,
        detail: this.safe(err instanceof Error ? err.message : String(err)),
      });
      return finish();
    }

    // 3. Can the largest photo get through? (Writes nothing.) Always sent for
    // real: the limits PHP reports don't say what actually happens.
    let largest = 0;
    await db.photos.each((p) => {
      largest = Math.max(largest, p.blob.size);
    });
    const size = Math.max(largest, 1_000_000);
    let verdict: Check;
    try {
      const res = await fetch(this.endpoint('probe'), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: new Uint8Array(size),
      });
      verdict = probeVerdict(res.status, await res.json().catch(() => null), size);
    } catch {
      verdict = probeVerdict('threw', null, size);
    }
    if (!verdict.ok && info?.maxBody && info.maxBody < size)
      verdict.detail += ` PHP's post_max_size here is ${(info.maxBody / 1e6).toFixed(1)} MB${(info as { displayErrors?: boolean }).displayErrors ? ', and display_errors is on' : ''}.`;
    checks.push(verdict);
    return finish();
  }

  /** Records on this device the NAS hasn't got yet (null: never synced). */
  async unsyncedChanges(): Promise<number | null> {
    const base = (await db.kv.get(BASE_KEY))?.value as Backup | undefined;
    if (!base) return null;
    return countDifferences(toRecords(await buildDataBackup()), toRecords(base));
  }
}

export const nasBackup = new NasBackup();
