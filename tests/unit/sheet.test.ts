import { describe, it, expect } from 'vitest';
import { formatSheetDate, formatLocalAmount, expenseToRow, subtotalRow } from '../../src/lib/sheet';
import type { Expense } from '../../src/lib/db';

function exp(over: Partial<Expense>): Expense {
  return {
    id: 'x',
    tripId: 't',
    cityId: null,
    date: '2025-11-15',
    destination: 'Prague',
    category: 'Food',
    subcategory: 'Snacks',
    description: 'Water',
    paymentMethod: 'Card Payment',
    amountGBP: 2.44,
    amountLocal: 60,
    notes: 'x2',
    currency: 'CZK',
    fxRate: 0.034,
    synced: false,
    skeleton: false,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

describe('formatSheetDate', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatSheetDate('2025-11-15')).toBe('15/11/2025');
  });
  it('passes through anything else', () => {
    expect(formatSheetDate('')).toBe('');
  });
});

describe('formatLocalAmount', () => {
  it('formats amount with the currency code', () => {
    expect(formatLocalAmount(240, 'czk')).toBe('240 CZK');
    expect(formatLocalAmount(245.3, 'CZK')).toBe('245.3 CZK');
  });
  it('is blank for GBP or zero', () => {
    expect(formatLocalAmount(10, 'GBP')).toBe('');
    expect(formatLocalAmount(0, 'EUR')).toBe('');
  });
});

describe('expenseToRow', () => {
  it('maps the 11 columns in order, Subtotal blank', () => {
    const row = expenseToRow(exp({}), 3);
    expect(row).toEqual([
      '15/11/2025',
      3,
      'Prague',
      'Food',
      'Snacks',
      'Water',
      'Card Payment',
      2.44,
      '60 CZK',
      'x2',
      '',
    ]);
  });
  it('blanks Amount (Local) for GBP payments', () => {
    const row = expenseToRow(exp({ currency: 'GBP', amountLocal: 0, amountGBP: 60 }), 1);
    expect(row[8]).toBe('');
  });
});

describe('subtotalRow', () => {
  it('is blank across except the Subtotal cell', () => {
    expect(subtotalRow(156.49)).toEqual(['', '', '', '', '', '', '', '', '', '', 156.49]);
  });
});
