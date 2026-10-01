import { db } from './db';
import type { ConflictRecord } from './nas.svelte';
import { CONFLICT } from './sync';
import { recomputeTripDerived } from './trips';

/**
 * Edits made to the same field on two devices. Sync keeps the newer value and
 * stores the other here (as synced kv rows, so every device shows the same
 * list). Resolving one is an ordinary edit, and it syncs like any other.
 */

export interface Conflict extends ConflictRecord {
  key: string;
}

export const conflictsQuery = () =>
  db.kv
    .where('key')
    .startsWith(CONFLICT)
    .toArray()
    .then((rows) =>
      rows.map((r) => ({ ...(r.value as ConflictRecord), key: r.key })).sort((a, b) => b.at - a.at),
    );

const FIELD_LABELS: Record<string, string> = {
  planText: 'Plan',
  journalText: 'Journal',
  notes: 'Notes',
  name: 'Name',
  nameManual: 'Custom name',
  visited: 'Visited',
  checklist: 'Checklist',
  status: 'Status',
  partySize: 'Party size',
  arrival: 'Arrival',
  departure: 'Departure',
  sleep: 'Overnight',
  currency: 'Currency',
  amountGBP: 'Amount (£)',
  amountLocal: 'Amount (local)',
  description: 'Description',
  category: 'Category',
  subcategory: 'Subcategory',
  paymentMethod: 'Payment',
  destination: 'Destination',
  date: 'Date',
  promptPrefs: 'Prompt answers',
  coverMode: 'Cover',
};

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** A conflict value as readable text. */
export function showValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v))
    return v
      .map((x) =>
        x && typeof x === 'object' && 'text' in x ? `${x.done ? '☑' : '☐'} ${x.text}` : String(x),
      )
      .join('\n');
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

/** Put the other device's values back in place, then drop the conflict. */
export async function useOtherVersion(c: Conflict): Promise<void> {
  const patch = Object.fromEntries(Object.entries(c.fields).map(([f, v]) => [f, v.other]));
  await db.transaction('rw', [db.table(c.table), db.kv], async () => {
    if (c.table !== 'kv') await db.table(c.table).update(c.recordId, patch);
    await db.kv.delete(c.key);
  });
  if (c.table === 'cities' && c.tripId) await recomputeTripDerived(c.tripId);
}

/** Keep what's in place; drop the conflict. */
export async function keepCurrent(c: Conflict): Promise<void> {
  await db.kv.delete(c.key);
}
