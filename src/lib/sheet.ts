import type { Expense } from './db';

/**
 * Formatting rules mirrored from the real Travel Spending tab:
 *  - Date is DD/MM/YYYY.
 *  - Transaction# is the row's 1-based position within the trip (passed in).
 *  - Amount (GBP) is a number (the column is £-formatted in the sheet).
 *  - Amount (Local) is TEXT like "240 CZK"; blank when paid in GBP.
 *  - Subtotal is blank on entry rows; a separate per-trip total row carries it.
 */

export const SHEET_COLUMNS = [
  'Date',
  'Transaction#',
  'Destination',
  'Category',
  'Subcategory',
  'Description',
  'Payment Method',
  'Amount (GBP)',
  'Amount (Local)',
  'Notes',
  'Subtotal',
] as const;

export type SheetCell = string | number;
export type SheetRow = SheetCell[];

/** Today's date as 'YYYY-MM-DD' (local time). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. Passes through anything else unchanged. */
export function formatSheetDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Trim to at most 2 dp without forcing trailing zeros. */
function tidyNumber(n: number): string {
  return Number(round2(n)).toString();
}

/** Amount (Local) cell text, e.g. "240 CZK". Blank when paid in GBP or zero. */
export function formatLocalAmount(amount: number, code: string): string {
  const c = code.trim().toUpperCase();
  if (!c || c === 'GBP' || !Number.isFinite(amount) || amount === 0) return '';
  return `${tidyNumber(amount)} ${c}`;
}

/** Map an expense + its computed transaction number to the 11-column row. */
export function expenseToRow(e: Expense, transactionNo: number): SheetRow {
  return [
    formatSheetDate(e.date),
    transactionNo,
    e.destination,
    e.category,
    e.subcategory,
    e.description,
    e.paymentMethod,
    round2(e.amountGBP),
    formatLocalAmount(e.amountLocal, e.currency),
    e.notes,
    '',
  ];
}

/** The trailing per-trip total row: blanks across, GBP total in Subtotal. */
export function subtotalRow(totalGBP: number): SheetRow {
  return ['', '', '', '', '', '', '', '', '', '', round2(totalGBP)];
}
