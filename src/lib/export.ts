import { db, type City, type Expense, type FxRate, type Photo, type Stop, type Trip } from './db';
import { presetByType } from './presets';
import { formatDateRange } from './format';
import { formatSheetDate } from './sheet';
import { realExpenses, tripTotalGBP, categorySummary } from './expenses';
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
  stops: Stop[],
  expenses: Expense[],
  photos: PackPhoto[],
): string {
  const lines: string[] = [];
  lines.push(`# Trip pack: ${trip.name}`, '');
  lines.push(`**Type:** ${presetByType(trip.type).label}  `);
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
export function buildMemoryPrompt(trip: Trip, stops: Stop[], expenses: Expense[]): string {
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
    `Destination: ${trip.name}`,
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
  const [trips, cities, stops, expenses, fxRates, settings, photoRows] = await Promise.all([
    db.trips.toArray(),
    db.cities.toArray(),
    db.stops.toArray(),
    db.expenses.toArray(),
    db.fxRates.toArray(),
    db.kv.toArray(),
    db.photos.toArray(),
  ]);

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
    settings,
    photos,
  };
}

/**
 * A data-only snapshot (no photo blobs) for the opportunistic NAS push — small
 * enough to send after every change. Photos travel separately, one file each.
 */
export async function buildDataBackup(): Promise<Backup> {
  const [trips, cities, stops, expenses, fxRates, settings] = await Promise.all([
    db.trips.toArray(),
    db.cities.toArray(),
    db.stops.toArray(),
    db.expenses.toArray(),
    db.fxRates.toArray(),
    db.kv.toArray(),
  ]);

  return {
    app: 'systema',
    version: 1,
    exportedAt: new Date().toISOString(),
    trips,
    cities,
    stops,
    expenses,
    fxRates,
    settings,
    photos: [],
  };
}

export interface ImportResult {
  trips: number;
  stops: number;
  expenses: number;
  photos: number;
}

/** Merge a backup into the local store (by id — same id overwrites, new id adds). */
export async function importBackup(data: Backup): Promise<ImportResult> {
  if (!data || data.app !== 'systema' || !Array.isArray(data.trips)) {
    throw new Error('That file is not a systema backup.');
  }

  await db.transaction(
    'rw',
    [db.trips, db.cities, db.stops, db.expenses, db.fxRates, db.kv, db.photos],
    async () => {
      if (data.trips?.length) await db.trips.bulkPut(data.trips);
      if (data.cities?.length) await db.cities.bulkPut(data.cities);
      if (data.stops?.length) await db.stops.bulkPut(data.stops);
      if (data.expenses?.length) await db.expenses.bulkPut(data.expenses);
      if (data.fxRates?.length) await db.fxRates.bulkPut(data.fxRates);
      if (data.settings?.length) await db.kv.bulkPut(data.settings);
      if (data.photos?.length) {
        for (const p of data.photos) {
          const blob = await dataUrlToBlob(p.dataUrl);
          await db.photos.put({ ...p.meta, blob });
        }
      }
    },
  );

  return {
    trips: data.trips.length,
    stops: data.stops?.length ?? 0,
    expenses: data.expenses?.length ?? 0,
    photos: data.photos?.length ?? 0,
  };
}
