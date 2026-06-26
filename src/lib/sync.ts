import { db } from './db';
import { settingsStore } from './settings.svelte';
import { expenseToRow, subtotalRow, type SheetRow } from './sheet';
import { realExpenses, tripTotalGBP } from './expenses';

/**
 * Sync to the Apps Script capture web app. The sheet is a write buffer you
 * reconcile by hand, so this is deliberately fire-and-mark: a POST that resolves
 * is treated as delivered; failures keep the rows queued (unsynced) for retry.
 */

export interface SyncResult {
  ok: boolean;
  synced: number;
  error?: string;
}

async function postRows(rows: SheetRow[]): Promise<void> {
  const { webAppUrl, sharedToken } = settingsStore.current;
  if (!webAppUrl.trim()) {
    throw new Error('No capture web app URL set — add it in Settings → Capture sync.');
  }
  const res = await fetch(webAppUrl.trim(), {
    method: 'POST',
    // text/plain keeps this a "simple" request, avoiding a CORS preflight the
    // Apps Script endpoint can't answer.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: sharedToken || undefined, rows }),
  });
  if (!res.ok) throw new Error(`Capture sheet returned HTTP ${res.status}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Push a trip's unsynced (real) expenses to the sheet. */
export async function syncTrip(tripId: string): Promise<SyncResult> {
  const all = await db.expenses.where('tripId').equals(tripId).toArray();
  const real = realExpenses(all);
  const pending = real.filter((e) => !e.synced);
  if (pending.length === 0) return { ok: true, synced: 0 };

  // Transaction# = 1-based position among ALL real rows, so numbers stay
  // sequential even when syncing incrementally.
  const numberById = new Map(real.map((e, i) => [e.id, i + 1]));
  const rows = pending.map((e) => expenseToRow(e, numberById.get(e.id) ?? 0));

  try {
    await postRows(rows);
    await db.transaction('rw', db.expenses, async () => {
      for (const e of pending) await db.expenses.update(e.id, { synced: true });
    });
    return { ok: true, synced: pending.length };
  } catch (err) {
    return { ok: false, synced: 0, error: errorMessage(err) };
  }
}

/** Append the trailing per-trip total row to the sheet. */
export async function appendSubtotalRow(tripId: string): Promise<SyncResult> {
  const all = await db.expenses.where('tripId').equals(tripId).toArray();
  const total = tripTotalGBP(realExpenses(all));
  try {
    await postRows([subtotalRow(total)]);
    return { ok: true, synced: 1 };
  } catch (err) {
    return { ok: false, synced: 0, error: errorMessage(err) };
  }
}

/** Count of real, unsynced expenses for a trip. */
export async function pendingCount(tripId: string): Promise<number> {
  const all = await db.expenses.where('tripId').equals(tripId).toArray();
  return realExpenses(all).filter((e) => !e.synced).length;
}

async function syncAllPending(): Promise<void> {
  const trips = await db.trips.toArray();
  for (const t of trips) {
    if ((await pendingCount(t.id)) > 0) await syncTrip(t.id);
  }
}

/** Flush queued rows automatically when connectivity returns. */
export function initAutoSync(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void syncAllPending();
  });
}
