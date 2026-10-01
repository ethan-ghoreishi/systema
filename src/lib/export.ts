import type { Table } from 'dexie';
import { validateBackup } from './backup-validation';
import { photoExt } from './photos';
import { isZip, unzip, verifyZip, zip } from './zip';
import { db, type City, type Expense, type FxRate, type Photo, type Stop, type Trip } from './db';
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
  stopId: string | null;
  createdAt: number;
}

function photoStamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/**
 * Build the trip pack Markdown. Pure given the trip's data.
 *
 * Photos are listed (stop + time), not embedded: base64 images would bloat the
 * file far past what can be pasted into a chat, and pasted Markdown can't carry
 * viewable images anyway. Attach the photos themselves in Claude if wanted.
 */
export function buildTripPack(
  trip: Trip,
  cities: City[],
  stops: Stop[],
  expenses: Expense[],
  photos: PackPhoto[],
): string {
  const lines: string[] = [];
  lines.push(`# Trip pack: ${tripDisplayName(trip, cities)}`, '');
  lines.push(`**Shape:** ${tripShape(trip, cities).label}  `);
  lines.push(`**Dates:** ${formatDateRange(trip.startDate, trip.endDate)}  `);
  lines.push(`**Party:** ${trip.partySize}`, '');

  if (trip.planText.trim()) {
    lines.push('## Plan', '', trip.planText.trim(), '');
  }

  const orderedStops = [...stops].sort((a, b) => a.order - b.order);
  const stopPhotos = photos.filter((p) => p.stopId != null);
  if (orderedStops.length) {
    lines.push('## Stops', '');
    for (const s of orderedStops) {
      lines.push(`### ${s.name}${s.visited ? ' (visited)' : ''}`);
      for (const item of s.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
      if (s.notes.trim()) lines.push('', s.notes.trim());
      const pc = stopPhotos.filter((p) => p.stopId === s.id).length;
      if (pc) lines.push('', `_${pc} photo${pc > 1 ? 's' : ''}_`);
      lines.push('');
    }
  }

  if (stopPhotos.length) {
    const nameById = new Map(stops.map((s) => [s.id, s.name]));
    lines.push('## Photos', '');
    for (const p of [...stopPhotos].sort((a, b) => a.createdAt - b.createdAt)) {
      lines.push(
        `- ${nameById.get(p.stopId as string) ?? 'Unassigned'}: ${photoStamp(p.createdAt)}`,
      );
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
// The [photo: ...] placeholder contract matches src/lib/journal.ts, which swaps
// the placeholders for the real stored photographs when the journal is rendered.
export const JOURNAL_PROMPT =
  'You are helping me write a post-trip journal in my City Systems Playbook style. ' +
  'Using the trip pack below (plan, ticked stops, notes, photos list, expense summary), ' +
  'write a debrief that states my city thesis, tests it against what I actually saw, gives a ' +
  'short reading of each main stop, draws the London and Esfahan contrasts, and ends with a ' +
  'brief counterfactual on what I would do differently. Plain UK English, no em-dashes. ' +
  'The Photos section of the pack lists the photographs I took, by stop and time. Where one ' +
  'would naturally illustrate the narrative, insert a placeholder on its own line in exactly ' +
  'this form: [photo: <stop name>] - use only stop names from the Photos list, at most as many ' +
  'placeholders per stop as it has photos, placed where they best support the text. My app ' +
  'replaces them with the real photographs. Trip pack:';

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
}

/** The syncable record sets of a backup or snapshot. */
export function toRecords(b: Backup): SyncRecords {
  return {
    trips: b.trips,
    cities: b.cities,
    stops: b.stops,
    expenses: b.expenses,
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

/**
 * Full backup as a ZIP: the data snapshot plus every photo as its own file.
 * Read in one transaction (a consistent copy); photos are composed by
 * reference, so memory stays at about one photo however many there are.
 */
export async function buildZipBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { data, photos } = await db.transaction(
    'r',
    [db.trips, db.cities, db.stops, db.expenses, db.fxRates, db.kv, db.photos],
    async () => ({ data: await buildDataBackup(), photos: await db.photos.toArray() }),
  );
  return zip(
    [
      { name: BACKUP_JSON, data: new Blob([JSON.stringify(data)], { type: 'application/json' }) },
      { name: 'README.txt', data: new Blob([README]) },
      ...photos.map((p) => ({ name: `photos/${p.id}.${photoExt(p.blob)}`, data: p.blob })),
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
    const files = new Map(
      entries
        .filter((e) => e.name.startsWith('photos/'))
        .map((e) => [e.name.slice('photos/'.length).replace(/\.[^.]+$/, ''), e.data]),
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
  const [trips, cities, stops, expenses, fxRates, settings, photoRows] = await db.transaction(
    'r',
    [db.trips, db.cities, db.stops, db.expenses, db.fxRates, db.kv, db.photos],
    () =>
      Promise.all([
        db.trips.toArray(),
        db.cities.toArray(),
        db.stops.toArray(),
        db.expenses.toArray(),
        db.fxRates.toArray(),
        db.kv.toArray(),
        db.photos.toArray(),
      ]),
  );

  return {
    app: 'systema',
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
    cities,
    stops,
    expenses,
    fxRates,
    settings: settings.filter((r) => !isLocalKey(r.key)),
    photos: [],
    photosMeta: photoRows.map(({ blob: _blob, ...meta }) => meta),
  };
}

export interface ImportResult {
  trips: number;
  stops: number;
  expenses: number;
  photos: number;
  /** Records already on this device whose content differs from the backup (kept as they are). */
  differing: number;
  /** Photos listed in the backup whose file is missing from it. */
  missingPhotos: number;
}

/** Status-message tail: flag edits that didn't transfer, stay quiet when identical. */
export function importNote(r: ImportResult): string {
  return (
    (r.differing
      ? ` ${r.differing} record(s) on this device differ from the backup and stay as they are.`
      : '') +
    (r.missingPhotos ? ` ${r.missingPhotos} photo file(s) were missing from the backup.` : '')
  );
}

/**
 * Add missing records only: a backup can never overwrite this device's data.
 * `files` holds a ZIP backup's photos by id. With `dryRun`, nothing is
 * written and the result says what an import would do.
 */
export async function importBackup(
  data: Backup,
  files = new Map<string, Blob>(),
  { dryRun = false } = {},
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
  const photos = [
    ...legacy,
    ...metas
      .filter((m) => files.has(m.id))
      .map((m) => ({ ...m, blob: files.get(m.id)!, backedUp: false })),
  ];
  const result: ImportResult = {
    trips: 0,
    stops: 0,
    expenses: 0,
    photos: 0,
    differing: 0,
    missingPhotos: files.size ? metas.filter((m) => !files.has(m.id)).length : 0,
  };
  await db.transaction(
    dryRun ? 'r' : 'rw',
    [db.trips, db.cities, db.stops, db.expenses, db.fxRates, db.kv, db.photos],
    async () => {
      async function addMissing<T extends object>(
        table: Table<T, string>,
        rows: T[],
        key: (row: T) => string,
        compare = true,
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
        if (compare)
          result.differing += rows.filter(
            (row, i) => existing[i] && !same(existing[i], row),
          ).length;
        if (fresh.length && !dryRun) await table.bulkAdd(fresh);
        return fresh;
      }
      result.trips = (await addMissing(db.trips, data.trips, (r) => r.id)).length;
      await addMissing(db.cities, data.cities, (r) => r.id);
      result.stops = (await addMissing(db.stops, data.stops, (r) => r.id)).length;
      result.expenses = (await addMissing(db.expenses, data.expenses, (r) => r.id)).length;
      // Rates and photo files are this device's own cache/state; not user edits.
      await addMissing(db.fxRates, data.fxRates, (r) => r.code, false);
      // Device settings and sync state never come from a backup.
      const added = await addMissing(db.photos, photos, (r) => r.id, false);
      result.photos = added.length;
      // Restoring a photo from a backup un-deletes it, here and (via sync) elsewhere.
      if (added.length && !dryRun) await db.kv.bulkDelete(added.map((p) => `${TOMBSTONE}${p.id}`));
    },
  );
  return result;
}
