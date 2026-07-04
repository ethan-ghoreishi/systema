import { db, type Expense, type Trip } from './db';
import { presetByType } from './presets';
import { newId } from './ids';
import { getRateForDate } from './fx';

/**
 * Expense mutations + pure summaries. Transaction numbers are derived from row
 * order (sequential, no gaps) rather than stored, matching how the sheet reads.
 */

export interface ExpenseInput {
  cityId: string | null;
  destination: string;
  date: string;
  category: string;
  subcategory: string;
  description: string;
  paymentMethod: string;
  amountGBP: number;
  amountLocal: number;
  currency: string;
  fxRate: number | null;
  fxPending?: boolean;
  notes: string;
}

export async function addExpense(tripId: string, input: ExpenseInput): Promise<string> {
  const id = newId();
  const order = await db.expenses.where('tripId').equals(tripId).count();
  const expense: Expense = {
    id,
    tripId,
    ...input,
    skeleton: false,
    order,
    createdAt: Date.now(),
  };
  await db.expenses.add(expense);
  return id;
}

export async function updateExpense(id: string, patch: Partial<Expense>): Promise<void> {
  await db.expenses.update(id, patch);
}

export async function deleteExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.photos, async () => {
    await db.photos.where('expenseId').equals(id).delete();
    await db.expenses.delete(id);
  });
}

/** Seed the preset's skeleton rows for a trip, unless it already has expenses. */
export async function seedSkeleton(trip: Trip): Promise<number> {
  const existing = await db.expenses.where('tripId').equals(trip.id).count();
  if (existing > 0) return 0;

  const preset = presetByType(trip.type);
  if (preset.skeleton.length === 0) return 0;

  const now = Date.now();
  const rows: Expense[] = preset.skeleton.map((s, i) => ({
    id: newId(),
    tripId: trip.id,
    cityId: null,
    date: '',
    destination: '',
    category: s.category,
    subcategory: s.subcategory,
    description: s.description,
    paymentMethod: '',
    amountGBP: 0,
    amountLocal: 0,
    notes: '',
    currency: '',
    fxRate: null,
    skeleton: true,
    order: i,
    createdAt: now,
  }));

  await db.expenses.bulkAdd(rows);
  return rows.length;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Filled (non-skeleton) expenses in row order — the rows that go to the sheet. */
export function realExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].filter((e) => !e.skeleton).sort((a, b) => a.order - b.order);
}

/** Running GBP total for the trip. */
export function tripTotalGBP(expenses: Expense[]): number {
  return round2(expenses.reduce((sum, e) => sum + (e.amountGBP || 0), 0));
}

export interface CategoryTotal {
  category: string;
  total: number;
}

/** Per-category GBP totals, biggest first. */
export function categorySummary(expenses: Expense[]): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const e of expenses) {
    if (!e.amountGBP) continue;
    map.set(e.category, (map.get(e.category) ?? 0) + e.amountGBP);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Auto-price expenses saved without a rate (frictionless offline capture):
 * fetch the ECB rate for each row's own date and fill in the GBP amount.
 * Currencies the ECB doesn't publish (e.g. MAD, AMD) stay pending until a
 * manual £ amount is entered. Returns how many rows were priced.
 */
export async function resolvePendingFx(tripId?: string): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const all = tripId
    ? await db.expenses.where('tripId').equals(tripId).toArray()
    : await db.expenses.toArray();
  const pending = all.filter((e) => e.fxPending && !e.skeleton && e.amountLocal > 0);

  let resolved = 0;
  for (const e of pending) {
    const rate = await getRateForDate(e.currency, e.date);
    if (rate == null) continue;
    const fxNote = `FX: 1 ${e.currency} = £${rate}`;
    await db.expenses.update(e.id, {
      amountGBP: round2(e.amountLocal * rate),
      fxRate: rate,
      fxPending: false,
      notes: e.notes.trim() ? `${e.notes.trim()} · ${fxNote}` : fxNote,
    });
    resolved += 1;
  }
  return resolved;
}

/** Price any rate-pending expenses when the browser regains connectivity. */
export function initFxAutoResolve(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => void resolvePendingFx());
}

/**
 * Assign each real expense its Transaction# — its 1-based position in trip
 * order. Used only when exporting the master-sheet CSV.
 */
export function assignTransactionNumbers(real: Expense[]): Map<string, number> {
  const map = new Map<string, number>();
  real.forEach((e, i) => map.set(e.id, i + 1));
  return map;
}

/**
 * Flag an obvious local↔GBP mismatch: a non-GBP expense whose implied rate is
 * wildly different from the one recorded. Deliberately loose — just a nudge.
 */
export function looksAnomalous(e: Expense): boolean {
  if (e.skeleton || !e.fxRate || !e.amountLocal || !e.amountGBP) return false;
  if (e.currency === 'GBP') return false;
  const implied = e.amountGBP / e.amountLocal;
  const ratio = implied / e.fxRate;
  return ratio < 0.5 || ratio > 2;
}
