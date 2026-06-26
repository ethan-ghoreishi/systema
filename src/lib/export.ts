import { db, type City, type Expense, type FxRate, type Photo, type Stop, type Trip } from './db';
import { presetByType } from './presets';
import { formatDateRange } from './format';
import { realExpenses, tripTotalGBP, categorySummary } from './expenses';
import { formatGBP } from './money';

/**
 * Trip pack (Markdown) + the prefilled journaling prompt, and a full JSON
 * backup/import for device portability. The pack is plain text out; the JSON is
 * for your own backup, not an AI contract.
 */

/** Build the trip pack Markdown. Pure given the trip's data. */
export function buildTripPack(
  trip: Trip,
  stops: Stop[],
  expenses: Expense[],
  photoCounts: Record<string, number>,
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
  if (orderedStops.length) {
    lines.push('## Stops', '');
    for (const s of orderedStops) {
      lines.push(`### ${s.name}${s.visited ? ' (visited)' : ''}`);
      for (const item of s.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
      if (s.notes.trim()) lines.push('', s.notes.trim());
      const pc = photoCounts[s.id] ?? 0;
      if (pc) lines.push('', `_${pc} photo${pc > 1 ? 's' : ''}_`);
      lines.push('');
    }
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
export const JOURNAL_PROMPT =
  'You are helping me write a post-trip journal in my City Systems Playbook style. ' +
  'Using the trip pack below (plan, ticked stops, notes, photos list, expense summary), ' +
  'write a debrief that states my city thesis, tests it against what I actually saw, gives a ' +
  'short reading of each main stop, draws the London and Esfahan contrasts, and ends with a ' +
  'brief counterfactual on what I would do differently. Plain UK English, no em-dashes. Trip pack:';

export function buildJournalingPrompt(pack: string): string {
  return `${JOURNAL_PROMPT}\n\n${pack}`;
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
