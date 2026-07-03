import type { Expense, Trip } from './db';
import { SHEET_COLUMNS, expenseToRow, subtotalRow, type SheetRow } from './sheet';
import { assignTransactionNumbers, realExpenses, tripTotalGBP } from './expenses';

/**
 * CSV export in the exact Travel Spending column order — the way the master
 * sheet gets updated now that the app is the ledger: download, open, paste.
 */

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(row: SheetRow): string {
  return row.map(csvCell).join(',');
}

/** One trip's rows in sheet order, closed by its subtotal row. */
export function tripCsvRows(expenses: Expense[]): SheetRow[] {
  const real = realExpenses(expenses).filter((e) => !e.fxPending);
  const numbers = assignTransactionNumbers(real);
  const rows = real.map((e) => expenseToRow(e, numbers.get(e.id) ?? 0));
  if (rows.length) rows.push(subtotalRow(tripTotalGBP(real)));
  return rows;
}

/** CSV for a single trip. */
export function buildTripCsv(expenses: Expense[]): string {
  return [csvLine([...SHEET_COLUMNS]), ...tripCsvRows(expenses).map(csvLine)].join('\n') + '\n';
}

/** CSV for the whole ledger: every trip chronologically, each with a subtotal. */
export function buildAllTripsCsv(trips: Trip[], expenses: Expense[]): string {
  const byTrip = new Map<string, Expense[]>();
  for (const e of expenses) {
    const list = byTrip.get(e.tripId) ?? [];
    list.push(e);
    byTrip.set(e.tripId, list);
  }

  const ordered = [...trips].sort((a, b) =>
    (a.startDate || '9999').localeCompare(b.startDate || '9999'),
  );

  const lines = [csvLine([...SHEET_COLUMNS])];
  for (const trip of ordered) {
    for (const row of tripCsvRows(byTrip.get(trip.id) ?? [])) lines.push(csvLine(row));
  }
  return lines.join('\n') + '\n';
}
