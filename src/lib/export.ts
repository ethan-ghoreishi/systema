import type { Table } from 'dexie';
import { validateBackup } from './backup-validation';
import { db, type City, type Expense, type FxRate, type Photo, type Stop, type Trip } from './db';
import { formatDateRange } from './format';
import { formatSheetDate } from './sheet';
import { realExpenses, tripTotalGBP, categorySummary } from './expenses';
import { tripDisplayName, tripShape } from './trip-shape';
import { formatGBP } from './money';

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
  settings: { key: string; value: unknown }[];
  photos: BackupPhoto[];
  /** Photo records without blobs (data snapshots) — lets a restoring device
   *  know which photo files to fetch from the NAS and how to re-link them. */
  photosMeta?: Omit<Photo, 'blob'>[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function buildBackup(): Promise<Backup> {
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

  const photos: BackupPhoto[] = await Promise.all(
    photoRows.map(async (p) => {
      const { blob, ...meta } = p;
      return { meta, dataUrl: await blobToDataUrl(blob) };
    }),
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
    settings: settings.filter((r) => r.key !== 'settings' && r.key !== 'nasLastDataAt'),
    photos,
  };
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
    settings: settings.filter((r) => r.key !== 'settings' && r.key !== 'nasLastDataAt'),
    photos: [],
    photosMeta: photoRows.map(({ blob: _blob, ...meta }) => meta),
  };
}

export interface ImportResult {
  trips: number;
  stops: number;
  expenses: number;
  photos: number;
  preserved: number;
}

/** Add missing records only. A stale backup must never replace the device's only copy. */
export async function importBackup(data: Backup): Promise<ImportResult> {
  validateBackup(data);
  // Blob decoding is asynchronous work outside IndexedDB. Doing it inside the
  // write transaction can let that transaction commit before all photos arrive.
  const photos = await Promise.all(
    data.photos.map(async (p) => ({
      ...p.meta,
      blob: await dataUrlToBlob(p.dataUrl),
      backedUp: false,
    })),
  );
  const result: ImportResult = { trips: 0, stops: 0, expenses: 0, photos: 0, preserved: 0 };
  await db.transaction(
    'rw',
    [db.trips, db.cities, db.stops, db.expenses, db.fxRates, db.kv, db.photos],
    async () => {
      async function addMissing<T extends object>(
        table: Table<T, string>,
        rows: T[],
        key: (row: T) => string,
      ): Promise<number> {
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
        result.preserved += rows.length - fresh.length;
        if (fresh.length) await table.bulkAdd(fresh);
        return fresh.length;
      }
      result.trips = await addMissing(db.trips, data.trips, (r) => r.id);
      await addMissing(db.cities, data.cities, (r) => r.id);
      result.stops = await addMissing(db.stops, data.stops, (r) => r.id);
      result.expenses = await addMissing(db.expenses, data.expenses, (r) => r.id);
      await addMissing(db.fxRates, data.fxRates, (r) => r.code);
      // Receiver credentials and backup-success markers belong to this device.
      // Never import them from a portable or NAS snapshot.
      result.photos = await addMissing(db.photos, photos, (r) => r.id);
    },
  );
  return result;
}
