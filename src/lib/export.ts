import type { Table } from 'dexie';
import { validateBackup } from './backup-validation';
import { photoExt, photoRef, photoRefs, photoTime } from './photos';
import { visitTimeline, zoneOf } from './moments';
import { instantToWall, wallLabel } from './tz';
import { isZip, unzip, verifyZip, zip } from './zip';
import {
  db,
  type City,
  type Expense,
  type FxRate,
  type Moment,
  type Photo,
  type Stop,
  type Trip,
} from './db';
import { formatDateRange } from './format';
import { formatSheetDate } from './sheet';
import { realExpenses, tripTotalGBP, categorySummary } from './expenses';
import { tripDisplayName, tripShape } from './trip-shape';
import { formatGBP } from './money';
import { TOMBSTONE, isLocalKey, same, type SyncRecords } from './sync';

/**
 * Trip pack (Markdown) + the prefilled journaling prompt, and a full JSON
 * backup/import for device portability. The pack is plain text out; the JSON is
 * for your own backup, not an AI contract.
 */

/** Minimal photo info the pack needs (no blobs). */
export interface PackPhoto {
  id: string;
  stopId: string | null;
  momentId?: string | null;
  kind: Photo['kind'];
  takenAt?: number;
  createdAt: number;
}

export interface ManifestEntry {
  n: number;
  id: string;
  ref: string;
  city: string;
  place: string;
  when: string;
}

/** 'Fri 16 Oct, 14:32' in the zone of the city it happened in. */
function localStamp(t: number, tz?: string): string {
  return wallLabel(instantToWall(t, tz));
}

/**
 * The photographs to attach to Claude, numbered in the order they were
 * taken, each with its stable reference (P-xxxxxx, longer where six hex
 * digits would be shared by two of them), city and place. Receipts
 * stay out.
 */
export function photoManifest(
  photos: PackPhoto[],
  stops: Stop[],
  moments: Moment[],
  cities: City[],
): ManifestEntry[] {
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const momentById = new Map(moments.map((m) => [m.id, m]));
  const cityById = new Map(cities.map((c) => [c.id, c]));
  // References are chosen over the whole set, so no two in one pack collide.
  const refs = photoRefs(photos.map((p) => p.id));
  return photos
    .filter((p) => p.kind !== 'receipt')
    .sort((a, b) => photoTime(a) - photoTime(b) || a.id.localeCompare(b.id))
    .map((p, i) => {
      const m = p.momentId ? momentById.get(p.momentId) : undefined;
      const s = p.stopId ? stopById.get(p.stopId) : undefined;
      const place = m ?? s;
      const city = cityById.get((m?.cityId ?? s?.cityId) || '');
      return {
        n: i + 1,
        id: p.id,
        ref: refs.get(p.id)!,
        city: city?.name ?? '',
        place: m?.title ?? s?.name ?? (p.kind === 'cover' ? 'Trip' : 'Unassigned'),
        when: localStamp(photoTime(p), place ? zoneOf(place, cities) : undefined),
      };
    });
}

export interface PackInput {
  trip: Trip;
  cities: City[];
  stops: Stop[];
  expenses: Expense[];
  photos: PackPhoto[];
  moments?: Moment[];
}

/**
 * Build the trip pack Markdown. Pure given the trip's data.
 *
 * Photos are listed in a numbered manifest (reference, place, time), not
 * embedded: base64 images would bloat the file far past what can be pasted
 * into a chat. The photos themselves are attached in Claude in the same order.
 */
export function buildTripPack({
  trip,
  cities,
  stops,
  expenses,
  photos,
  moments = [],
}: PackInput): string {
  const lines: string[] = [];
  lines.push(`# Trip pack: ${tripDisplayName(trip, cities)}`, '');
  lines.push(`**Shape:** ${tripShape(trip, cities).label}  `);
  lines.push(`**Dates:** ${formatDateRange(trip.startDate, trip.endDate)}  `);
  lines.push(`**Party:** ${trip.partySize}`, '');

  if (trip.planText.trim()) {
    lines.push('## Plan', '', trip.planText.trim(), '');
  }

  const cityById = new Map(cities.map((c) => [c.id, c]));
  const orderedStops = [...stops].sort((a, b) => a.order - b.order);
  const manifest = photoManifest(photos, stops, moments, cities);
  const refsFor = (pred: (p: PackPhoto) => boolean) =>
    manifest.filter((e) => pred(photos.find((p) => p.id === e.id)!)).map((e) => e.ref);

  if (orderedStops.length) {
    lines.push('## Stops', '');
    for (const s of orderedStops) {
      lines.push(`### ${s.name}${s.visited ? ' (visited)' : ''}`);
      if (s.guide?.anchor) lines.push(`Anchor: ${s.guide.anchor}`);
      for (const item of s.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
      if (s.notes.trim()) lines.push('', s.notes.trim());
      const refs = refsFor((p) => p.stopId === s.id && !p.momentId);
      if (refs.length)
        lines.push('', `_${refs.length} photo${refs.length > 1 ? 's' : ''}: ${refs.join(', ')}_`);
      lines.push('');
    }
  }

  const stopName = new Map(stops.map((s) => [s.id, s.name]));
  const timeline = visitTimeline(stops, moments, cities);
  if (timeline.length) {
    lines.push('## Visit order', '');
    timeline.forEach((it, i) => {
      if (it.kind === 'stop') {
        const c = cityById.get(it.stop.cityId ?? '');
        const when = it.at != null ? `${localStamp(it.at, zoneOf(it.stop, cities))}, ` : '';
        lines.push(`${i + 1}. ${when}${it.stop.name}${c ? ` (${c.name})` : ''}`);
      } else {
        const c = cityById.get(it.moment.cityId ?? '');
        lines.push(
          `${i + 1}. ${localStamp(it.at, zoneOf(it.moment, cities))}, ${
            it.moment.stopId && stopName.get(it.moment.stopId)
              ? `at ${stopName.get(it.moment.stopId)}`
              : 'off-plan'
          }: ${it.moment.title}${c ? ` (${c.name})` : ''}`,
        );
      }
    });
    lines.push('');
  }

  if (moments.length) {
    lines.push('## Unplanned / serendipitous moments (in visit order)', '');
    for (const it of timeline) {
      if (it.kind !== 'moment') continue;
      const m = it.moment;
      const c = cityById.get(m.cityId ?? '');
      const refs = refsFor((p) => p.momentId === m.id);
      const bits = [
        `- ${localStamp(m.at, zoneOf(m, cities))}${c ? `, ${c.name}` : ''}: **${m.title}**`,
        m.note ? `. ${m.note}` : '',
        m.stopId && stopName.get(m.stopId) ? ` (at ${stopName.get(m.stopId)})` : '',
        refs.length ? ` [photos: ${refs.join(', ')}]` : '',
      ];
      lines.push(bits.join(''));
    }
    lines.push('');
  }

  if (manifest.length) {
    lines.push('## Photos (attached in this order)', '');
    for (const e of manifest) {
      const where = [e.city, e.place].filter(Boolean).join(', ');
      lines.push(`${e.n}. [photo: ${e.ref}] ${where}, ${e.when}`);
    }
    lines.push('');
  }

  const real = realExpenses(expenses);
  if (real.length) {
    lines.push('## Expenses', '');
    lines.push(`**Total:** ${formatGBP(tripTotalGBP(expenses))}`, '');
    for (const c of categorySummary(expenses)) {
      lines.push(`- ${c.category}: ${formatGBP(c.total)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

// The journaling prompt from the brief's appendix. Plain UK English, no em-dashes.
// The [photo: P-xxxxxx] placeholder contract matches src/lib/journal.ts, which
// swaps the placeholders for the real stored photographs when the journal is
// rendered — by stable reference, so duplicates and off-plan places are safe.
export const JOURNAL_PROMPT =
  'You are helping me write a post-trip journal in my City Systems Playbook style. ' +
  'Using the trip pack below (plan, ticked stops, visit order, unplanned moments, photos list, expense summary), ' +
  'write a debrief that states my city thesis, tests it against what I actually saw, gives a ' +
  'short reading of each main stop, draws the London and Esfahan contrasts, and ends with a ' +
  'brief counterfactual on what I would do differently. Plain UK English, no em-dashes. ' +
  'The unplanned moments are things that happened off the plan, in the order they happened: weave them ' +
  'naturally into the story where they happened, with the same care as the planned stops, rather than ' +
  'listing them separately. ' +
  'I have attached my photographs in the order of the Photos section, which gives each one a reference ' +
  'such as P-3f9a1c, with where and when it was taken. Where a photograph would naturally illustrate ' +
  'the narrative, insert a placeholder on its own line exactly as listed, for example [photo: P-3f9a1c]. ' +
  'Use each reference at most once and only references from the list. My app replaces them with the ' +
  'real photographs. Trip pack:';

export function buildJournalingPrompt(pack: string): string {
  return `${JOURNAL_PROMPT}\n\n${pack}`;
}

/**
 * Journal-reconstruction prompt for trips that predate the app (imported from
 * the expense ledger, no plan/notes/photos). The expense trail is the memory
 * scaffold: Claude interviews first, then writes the journal in house style.
 */
export function buildMemoryPrompt(
  trip: Trip,
  cities: City[],
  stops: Stop[],
  expenses: Expense[],
): string {
  const real = realExpenses(expenses);
  const lines: string[] = [];

  lines.push(
    'You are helping me reconstruct and write a post-trip journal in my City Systems Playbook ' +
      'style for a trip taken before I kept notes. Work in two steps.',
    '',
    '**Step 1 - interview me.** Using the expense trail and visited places below as the memory ' +
      'scaffold, ask me 6-8 sharp, specific questions, then wait for my answers. Cover: my one-line ' +
      'thesis of how the city works; a concrete moment at each main visited place; what the streets ' +
      'and people did that London would not do; where Esfahan or Iranian instincts surfaced; the ' +
      'food situation (coeliac-safe vegetarian, grocery-first); one thing that surprised us; one ' +
      'thing we would do differently.',
    '',
    '**Step 2 - after I answer,** write the debrief: state the city thesis, test it against what I ' +
      'recalled, give a short reading of each main stop, draw the London and Esfahan contrasts, and ' +
      'end with a brief counterfactual. Plain UK English, no em-dashes. We travel as a party of ' +
      `${trip.partySize}.`,
    '',
    `## Trip`,
    '',
    `Destination: ${tripDisplayName(trip, cities)}`,
    `Dates: ${formatDateRange(trip.startDate, trip.endDate)}`,
    '',
  );

  const visited = [...stops].sort((a, b) => a.order - b.order).filter((s) => s.visited);
  if (visited.length) {
    lines.push('## Places visited (from tickets and entries)', '');
    for (const s of visited) lines.push(`- ${s.name}`);
    lines.push('');
  }

  if (real.length) {
    lines.push(`## Expense trail (total ${formatGBP(tripTotalGBP(real))})`, '');
    for (const e of real) {
      const what = e.description || e.subcategory;
      lines.push(
        `- ${formatSheetDate(e.date)} ${e.category} / ${e.subcategory}: ${what} (${formatGBP(e.amountGBP)})`,
      );
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

// ---- Full JSON backup / import ----

export interface BackupPhoto {
  meta: Omit<Photo, 'blob'>;
  dataUrl: string;
}

export interface Backup {
  app: 'systema';
  version: number;
  exportedAt: string;
  trips: Trip[];
  cities: City[];
  stops: Stop[];
  expenses: Expense[];
  /** Off-plan moments (absent in backups from older versions). */
  moments?: Moment[];
  fxRates: FxRate[];
  /** Synced key/value rows (edit conflicts, photo tombstones). Never device settings. */
  settings: { key: string; value: unknown }[];
  photos: BackupPhoto[];
  /** Photo records without blobs (data snapshots) — lets a restoring device
   *  know which photo files to fetch from the NAS and how to re-link them. */
  photosMeta?: Omit<Photo, 'blob'>[];
  /** NAS sync lineage (absent on file backups and older snapshots). */
  sync?: SyncMeta;
}

export interface SyncMeta {
  /** This snapshot's id. */
  id: string;
  device: string;
  deviceName: string;
  at: number;
  /** Ids of the snapshots this one was merged from, newest last (capped). */
  history: string[];
  /**
   * How much of each device's work this snapshot includes: one counter per
   * device, raised only by that device and carried forward by every merge.
   * `history` answers the same question but only for its last 200 snapshots,
   * so a device that has been away longer than that falls off the end of it;
   * this holds for any absence, and costs one small number per device.
   * Absent on snapshots from versions before it existed.
   */
  clock?: Record<string, number>;
}

/** The highest counter each device reaches across the given clocks. */
export function mergeClocks(
  ...clocks: (Record<string, number> | undefined)[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const clock of clocks)
    for (const [device, n] of Object.entries(clock ?? {}))
      if (typeof n === 'number' && Number.isFinite(n)) out[device] = Math.max(out[device] ?? 0, n);
  return out;
}

/**
 * Whether `remote` is known to include everything in `base`: the same
 * snapshot, one that lists it among its ancestors, or one whose counters all
 * reach `base`'s. Only then may an absence on the remote side be read as a
 * deletion (see sync.ts), so every test here has to be certain; being unsure
 * costs nothing but a union.
 */
export function descendsFrom(base: Backup, remote: Backup | null): boolean {
  if (!remote) return false;
  if (base === remote) return true;
  if (!base.sync || !remote.sync) return false;
  if (remote.sync.id === base.sync.id || remote.sync.history.includes(base.sync.id)) return true;
  const [mine, theirs] = [base.sync.clock, remote.sync.clock];
  if (!mine || !theirs) return false;
  return Object.entries(mine).every(([device, n]) => (theirs[device] ?? 0) >= n);
}

/** The syncable record sets of a backup or snapshot. */
export function toRecords(b: Backup): SyncRecords {
  return {
    trips: b.trips,
    cities: b.cities,
    stops: b.stops,
    expenses: b.expenses,
    moments: b.moments,
    kv: b.settings.filter((r) => !isLocalKey(r.key)),
    photosMeta: b.photosMeta ?? b.photos.map((p) => p.meta),
  };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export const BACKUP_JSON = 'systema-backup.json';

const README = `systema backup

systema-backup.json  trips, legs, stops, expenses, journals (all text)
photos/              every photo, as an ordinary image file named by its id

Restore: systema -> Settings -> Restore from a backup file, and pick this .zip.
Restoring only adds what the device doesn't already have.
`;

/** One stored photo's bytes, fetched when its turn comes (see ZipEntry.data). */
async function storedPhoto(id: string): Promise<Blob> {
  const photo = await db.photos.get(id);
  // Deleted between listing the photos and reaching this one. Refusing is the
  // only honest answer: an empty file in the archive would look like a photo.
  if (!photo)
    throw new Error(
      `Photo ${photoRef(id)} was deleted while the backup was being prepared. Try again.`,
    );
  return photo.blob;
}

/**
 * Full backup as a ZIP: the data snapshot plus every photo as its own file.
 * The data is read in one transaction (a consistent copy); each photo's bytes
 * are read only when its turn comes, so a library of thousands costs about
 * one photo's worth of memory, and a transient read failure retries instead
 * of losing the whole backup.
 */
export async function buildZipBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const names: { id: string; ext: string }[] = [];
  const data = await db.transaction(
    'r',
    [db.trips, db.cities, db.stops, db.expenses, db.moments, db.fxRates, db.kv, db.photos],
    async () => {
      const data = await buildDataBackup();
      await db.photos.each((p) => names.push({ id: p.id, ext: photoExt(p.blob) }));
      return data;
    },
  );
  return zip(
    [
      { name: BACKUP_JSON, data: new Blob([JSON.stringify(data)], { type: 'application/json' }) },
      { name: 'README.txt', data: new Blob([README]) },
      ...names.map(({ id, ext }) => ({ name: `photos/${id}.${ext}`, data: () => storedPhoto(id) })),
    ],
    { onProgress },
  );
}

/**
 * Read a backup file — a ZIP from this version, or a JSON file from earlier
 * ones — checking every checksum and the data's shape before anything is
 * written. Photos come back as lazy slices of the file.
 */
export async function readBackupFile(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ backup: Backup; files: Map<string, Blob> }> {
  if (await isZip(file)) {
    const entries = await unzip(file);
    await verifyZip(entries, onProgress);
    const json = entries.find((e) => e.name === BACKUP_JSON);
    if (!json) throw new Error(`Not a systema backup: ${BACKUP_JSON} is missing.`);
    const backup = JSON.parse(await json.data.text());
    validateBackup(backup);
    const types: Record<string, string> = {
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };
    const files = new Map(
      entries
        .filter((e) => e.name.startsWith('photos/'))
        .map((e) => {
          const [, id, ext] = e.name.match(/^photos\/(.+)\.([^.]+)$/) ?? [];
          return [id ?? e.name, e.data.slice(0, e.data.size, types[ext] ?? '')] as const;
        }),
    );
    return { backup, files };
  }
  let backup: unknown;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a systema backup (.zip or .json).');
  }
  validateBackup(backup);
  return { backup, files: new Map() };
}

/**
 * A data-only snapshot (no photo blobs) for the opportunistic NAS push — small
 * enough to send after every change. Photos travel separately, one file each.
 */
export async function buildDataBackup(): Promise<Backup> {
  // Photo rows are streamed, not collected: a device holds gigabytes of them
  // and only the metadata is wanted, so one blob is alive at a time.
  const photosMeta: Omit<Photo, 'blob'>[] = [];
  const [trips, cities, stops, expenses, moments, fxRates, settings] = await db.transaction(
    'r',
    [db.trips, db.cities, db.stops, db.expenses, db.moments, db.fxRates, db.kv, db.photos],
    async () => {
      const rows = await Promise.all([
        db.trips.toArray(),
        db.cities.toArray(),
        db.stops.toArray(),
        db.expenses.toArray(),
        db.moments.toArray(),
        db.fxRates.toArray(),
        db.kv.toArray(),
      ]);
      await db.photos.each(({ blob: _blob, ...meta }) => {
        photosMeta.push(meta);
      });
      return rows;
    },
  );

  return {
    app: 'systema',
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
    cities,
    stops,
    expenses,
    moments,
    fxRates,
    settings: settings.filter((r) => !isLocalKey(r.key)),
    photos: [],
    photosMeta,
  };
}

export interface ImportResult {
  trips: number;
  /** Legs (cities) added. A backup whose only missing record is a leg still restores. */
  cities: number;
  stops: number;
  expenses: number;
  moments: number;
  photos: number;
  /** Records already on this device whose content differs from the backup (kept as they are). */
  differing: number;
  /** Existing records whose blank fields were filled in from the backup (fillEmpty only). */
  filled: number;
  /** Photos listed in the backup whose file is missing from it. */
  missingPhotos: number;
}

/** Status-message tail: flag edits that didn't transfer, stay quiet when identical. */
export function importNote(r: ImportResult): string {
  return (
    (r.filled ? ` ${r.filled} existing record(s) had blank fields filled in.` : '') +
    (r.differing
      ? ` ${r.differing} record(s) on this device differ from the backup and stay as they are.`
      : '') +
    (r.missingPhotos ? ` ${r.missingPhotos} photo file(s) were missing from the backup.` : '')
  );
}

/**
 * A field counts as blank when there is nothing in it: absent, null, an empty
 * string or an empty list. (A merge is stricter — there, clearing a field is
 * an edit to be weighed, not an absence to fill.)
 */
const blank = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * The backup's values for fields this device has left blank. Filling only
 * those can never displace information, which is what makes `fillEmpty` safe
 * to offer alongside the add-only rule. Identity never moves.
 */
export function blankFieldPatch<T extends object>(existing: T, incoming: T): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'id' || key === 'tripId' || key === 'createdAt' || key === 'updatedAt') continue;
    if (blank(value)) continue;
    if (blank((existing as Record<string, unknown>)[key])) patch[key] = value;
  }
  return patch as Partial<T>;
}

/**
 * Add missing records only: a backup can never overwrite this device's data.
 * `files` holds a ZIP backup's photos by id. With `dryRun`, nothing is
 * written and the result says what an import would do.
 *
 * `fillEmpty` additionally writes the backup's values into fields an existing
 * record has left blank (see `blankFieldPatch`) — never over anything already
 * there. It is how a reconstructed journal reaches a trip that already exists.
 */
export async function importBackup(
  data: Backup,
  files = new Map<string, Blob>(),
  { dryRun = false, fillEmpty = false } = {},
): Promise<ImportResult> {
  validateBackup(data);
  // Blob decoding is asynchronous work outside IndexedDB. Doing it inside the
  // write transaction can let that transaction commit before all photos arrive.
  const legacy = dryRun
    ? data.photos.map((p) => ({ ...p.meta, blob: new Blob(), backedUp: false }))
    : await Promise.all(
        data.photos.map(async (p) => ({
          ...p.meta,
          blob: await dataUrlToBlob(p.dataUrl),
          backedUp: false,
        })),
      );
  const metas = data.photosMeta ?? [];
  const zipPhotos = metas
    .filter((m) => files.has(m.id))
    .map((m) => ({ ...m, blob: files.get(m.id)!, backedUp: false }));
  let zipToAdd: Photo[] = [];
  const result: ImportResult = {
    trips: 0,
    cities: 0,
    stops: 0,
    expenses: 0,
    moments: 0,
    photos: 0,
    differing: 0,
    filled: 0,
    missingPhotos: files.size ? metas.filter((m) => !files.has(m.id)).length : 0,
  };
  await db.transaction(
    dryRun ? 'r' : 'rw',
    [db.trips, db.cities, db.stops, db.expenses, db.moments, db.fxRates, db.kv, db.photos],
    async () => {
      async function addMissing<T extends object>(
        table: Table<T, string>,
        rows: T[],
        key: (row: T) => string,
        { compare = true, write = !dryRun } = {},
      ): Promise<T[]> {
        const existing = await table.bulkGet(rows.map(key));
        if (
          rows.some(
            (row, i) =>
              existing[i] &&
              'tripId' in row &&
              (!('tripId' in existing[i]!) ||
                row.tripId !== (existing[i] as { tripId: unknown }).tripId),
          )
        ) {
          throw new Error('Backup IDs belong to different trips on this device. No data imported.');
        }
        const fresh = rows.filter((_, i) => existing[i] === undefined);
        // Blank fields on records this device already has: filled only when
        // asked, and only where there is nothing to displace.
        const patches: [string, Partial<T>][] = [];
        if (compare && fillEmpty) {
          for (const [i, row] of rows.entries()) {
            const have = existing[i];
            if (!have) continue;
            const patch = blankFieldPatch(have, row);
            if (Object.keys(patch).length) patches.push([key(row), patch]);
          }
          result.filled += patches.length;
        }
        if (compare)
          result.differing += rows.filter(
            (row, i) =>
              existing[i] && !same(existing[i], row) && !patches.some(([id]) => id === key(row)),
          ).length;
        if (fresh.length && write) await table.bulkAdd(fresh);
        // `update` leaves `updatedAt` to the table hook, so sync carries the
        // fill to the other device as the newer edit it is.
        if (write) for (const [id, patch] of patches) await table.update(id, patch as object);
        return fresh;
      }
      result.trips = (await addMissing(db.trips, data.trips, (r) => r.id)).length;
      result.cities = (await addMissing(db.cities, data.cities, (r) => r.id)).length;
      result.stops = (await addMissing(db.stops, data.stops, (r) => r.id)).length;
      result.expenses = (await addMissing(db.expenses, data.expenses, (r) => r.id)).length;
      result.moments = (await addMissing(db.moments, data.moments ?? [], (r) => r.id)).length;
      // Rates and photo files are this device's own cache/state; not user edits.
      await addMissing(db.fxRates, data.fxRates, (r) => r.code, { compare: false });
      // Device settings and sync state never come from a backup.
      const added = await addMissing(db.photos, legacy, (r) => r.id, { compare: false });
      // Restoring a photo from a backup un-deletes it, here and (via sync) elsewhere.
      if (added.length && !dryRun) await db.kv.bulkDelete(added.map((p) => `${TOMBSTONE}${p.id}`));
      // ZIP photos are checked now and written below, a few at a time.
      zipToAdd = await addMissing(db.photos, zipPhotos, (r) => r.id, {
        compare: false,
        write: false,
      });
      result.photos = added.length + zipToAdd.length;
    },
  );
  if (dryRun) return result;

  // Never store a slice of the picked file: WebKit can store the whole file
  // for each slice. Each photo is copied to its own bytes first, in batches of
  // up to ~16 MB so memory stays bounded however large the backup. Re-running
  // the restore completes any batch an interruption missed.
  result.photos -= zipToAdd.length;
  for (let i = 0; i < zipToAdd.length; ) {
    const batch: typeof zipToAdd = [];
    for (let bytes = 0; i < zipToAdd.length && (!batch.length || bytes < 16e6); i += 1) {
      const p = zipToAdd[i];
      const blob = new Blob([await p.blob.arrayBuffer()], { type: p.blob.type });
      bytes += blob.size;
      batch.push({ ...p, blob });
    }
    await db.transaction('rw', db.photos, db.kv, async () => {
      const existing = await db.photos.bulkGet(batch.map((p) => p.id));
      const fresh = batch.filter((_, j) => !existing[j]);
      if (!fresh.length) return;
      await db.photos.bulkAdd(fresh);
      await db.kv.bulkDelete(fresh.map((p) => `${TOMBSTONE}${p.id}`));
      result.photos += fresh.length;
    });
  }
  return result;
}
