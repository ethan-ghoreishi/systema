import { db, type Expense, type Trip } from './db';
import { presetFor } from './presets';
import { newId } from './ids';
import { getRateForDate } from './fx';
import { deletePhotosWhere } from './photos';

/**
 * Expense mutations + pure summaries. Transaction numbers are derived from row
 * order (sequential, no gaps) rather than stored, matching how the sheet reads.
 */

export interface ExpenseInput {
  cityId: string | null;
  shared?: boolean;
  fxDate?: string;
  gbpManual?: boolean;
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
  await db.transaction('rw', db.expenses, async () => {
    const current = await db.expenses.get(id);
    if (!current) throw new Error('This expense no longer exists.');
    // A reclassified payment no longer pays for its old booking.
    const moved = (['category', 'subcategory', 'cityId', 'shared'] as const).some(
      (key) => key in patch && (patch[key] ?? false) !== (current[key] ?? false),
    );
    // An empty key means deliberately detached; an absent key permits legacy matching.
    await db.expenses.update(id, { ...patch, ...(moved ? { need: '' } : {}) });
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.photos, db.kv, async () => {
    await deletePhotosWhere('expenseId', id);
    await db.expenses.delete(id);
  });
}

/** Seed the preset's skeleton rows for a trip, unless it already has expenses. */
export async function seedSkeleton(trip: Trip): Promise<number> {
  const existing = await db.expenses.where('tripId').equals(trip.id).count();
  if (existing > 0) return 0;

  const preset = presetFor(trip);
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
    ...(s.need ? { need: s.need } : {}),
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

/**
 * Notes carrying exactly one auto FX note, for the rate actually used (none
 * when `rate` is null). Re-pricing an edited expense replaces the old note
 * instead of stacking another one into the sheet's Notes column.
 */
export function withFxNote(notes: string, currency: string, rate: number | null): string {
  const parts = notes
    .split(' · ')
    .map((p) => p.trim())
    .filter((p) => p && !/^FX: 1 [A-Z]{3} = £\S+$/.test(p));
  if (rate != null) parts.push(`FX: 1 ${currency} = £${rate}`);
  return parts.join(' · ');
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** What was typed into the capture sheet, before anything is decided about it. */
export interface AmountEntry {
  /** The amount as typed, in `currency`. */
  amount: number;
  currency: string;
  date: string;
  /**
   * A £ equivalent typed by hand. Ignored when `currency` is GBP: the amount
   * *is* the £ then. Reading a hidden override instead is how editing a
   * booking-made row used to save its original price straight back over the
   * correction — the override field is only on screen for a foreign currency,
   * but it was still deciding the figure.
   */
  overrideGBP?: number | null;
  /** The day's rate for `currency`, where one is known. */
  rate?: number | null;
  /** The row as stored, when an existing one is being edited. */
  recorded?: {
    amount: number;
    amountGBP: number;
    currency: string;
    date: string;
    fxRate: number | null;
    fxPending?: boolean;
    skeleton?: boolean;
  };
}

export interface PricedEntry {
  amountGBP: number;
  amountLocal: number;
  currency: string;
  fxRate: number | null;
  fxPending: boolean;
  /** The row keeps the £ it was recorded with: nothing that decides it changed. */
  keepRecorded: boolean;
  /** The rate actually used, for the Notes line and `fxDate`. Null when none was. */
  autoRate: number | null;
  /** The £ was typed by hand, so nothing may re-price it later. */
  gbpManual: boolean;
}

/**
 * The one place a saved expense's £ figure is decided — from the amount, its
 * currency, the day's rate and any £ typed by hand.
 *
 * A row already recorded keeps its £ unless something that decided it moved
 * (the amount, the currency, the date, or the £ itself): a rate fetched months
 * later must never rewrite what was actually paid.
 */
export function priceEntry(e: AmountEntry): PricedEntry {
  const currency = e.currency.trim().toUpperCase() || 'GBP';
  const isGBP = currency === 'GBP';
  const override = isGBP ? null : (e.overrideGBP ?? null);
  const r = e.recorded;
  const keepRecorded =
    !!r &&
    !r.skeleton &&
    !r.fxPending &&
    currency === r.currency &&
    e.amount === r.amount &&
    e.date === r.date &&
    override == null;
  if (keepRecorded)
    return {
      amountGBP: r.amountGBP,
      amountLocal: isGBP ? 0 : e.amount,
      currency,
      fxRate: r.fxRate,
      fxPending: false,
      keepRecorded: true,
      autoRate: null,
      gbpManual: false,
    };
  const rate = e.rate ?? null;
  const autoRate = isGBP || override != null ? null : rate;
  // No £ and no rate: it saves anyway and prices itself from its own date's
  // rate once online — or stays for a hand-typed £, for a currency the ECB
  // does not publish.
  const unpriced = !isGBP && override == null && rate == null;
  const amountGBP = isGBP
    ? round2(e.amount)
    : override != null
      ? round2(override)
      : rate != null
        ? round2(e.amount * rate)
        : 0;
  return {
    amountGBP,
    amountLocal: isGBP ? 0 : e.amount,
    currency,
    fxRate: isGBP ? null : override != null ? null : rate,
    fxPending: unpriced,
    keepRecorded: false,
    autoRate,
    gbpManual: override != null,
  };
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
    const found = await getRateForDate(e.currency, e.date);
    if (found == null) continue;
    const rate = found.rate;
    await db.transaction('rw', db.expenses, async () => {
      const current = await db.expenses.get(e.id);
      if (
        !current?.fxPending ||
        current.skeleton ||
        current.currency !== e.currency ||
        current.date !== e.date ||
        current.amountLocal !== e.amountLocal ||
        current.gbpManual
      )
        return;
      await db.expenses.update(e.id, {
        amountGBP: round2(current.amountLocal * rate),
        fxRate: rate,
        fxDate: found.date,
        fxPending: false,
        notes: withFxNote(current.notes, current.currency, rate),
      });
      resolved += 1;
    });
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
