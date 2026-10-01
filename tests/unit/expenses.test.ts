import { describe, it, expect } from 'vitest';
import {
  realExpenses,
  tripTotalGBP,
  categorySummary,
  looksAnomalous,
  assignTransactionNumbers,
  withFxNote,
} from '../../src/lib/expenses';
import type { Expense } from '../../src/lib/db';

let seq = 0;
function exp(over: Partial<Expense>): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    tripId: 't',
    cityId: null,
    date: '',
    destination: '',
    category: 'Food',
    subcategory: 'Snacks',
    description: '',
    paymentMethod: '',
    amountGBP: 0,
    amountLocal: 0,
    notes: '',
    currency: '',
    fxRate: null,
    skeleton: false,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

describe('realExpenses', () => {
  it('drops skeletons and sorts by order', () => {
    const list = [
      exp({ order: 2, id: 'b' }),
      exp({ skeleton: true, id: 's' }),
      exp({ order: 1, id: 'a' }),
    ];
    expect(realExpenses(list).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('tripTotalGBP', () => {
  it('sums amountGBP (skeletons contribute 0)', () => {
    expect(
      tripTotalGBP([exp({ amountGBP: 10 }), exp({ amountGBP: 5.5 }), exp({ skeleton: true })]),
    ).toBe(15.5);
  });
});

describe('categorySummary', () => {
  it('totals per category, biggest first', () => {
    const s = categorySummary([
      exp({ category: 'Food', amountGBP: 5 }),
      exp({ category: 'Transportation', amountGBP: 20 }),
      exp({ category: 'Food', amountGBP: 3 }),
    ]);
    expect(s).toEqual([
      { category: 'Transportation', total: 20 },
      { category: 'Food', total: 8 },
    ]);
  });
});

describe('assignTransactionNumbers', () => {
  it('numbers rows 1..n in array order', () => {
    const rows = [exp({ id: 'a' }), exp({ id: 'b' }), exp({ id: 'c' })];
    const map = assignTransactionNumbers(rows);
    expect([map.get('a'), map.get('b'), map.get('c')]).toEqual([1, 2, 3]);
  });
});

describe('looksAnomalous', () => {
  it('flags a ~10x local/GBP mismatch', () => {
    expect(
      looksAnomalous(exp({ currency: 'CZK', amountLocal: 100, amountGBP: 34, fxRate: 0.034 })),
    ).toBe(true);
  });
  it('accepts a sane entry', () => {
    expect(
      looksAnomalous(exp({ currency: 'CZK', amountLocal: 100, amountGBP: 3.4, fxRate: 0.034 })),
    ).toBe(false);
  });
});

describe('withFxNote', () => {
  it('keeps one FX note for the rate used and preserves the rest', () => {
    const priced = withFxNote('2x tickets (€4.5 each)', 'EUR', 0.85);
    expect(priced).toBe('2x tickets (€4.5 each) · FX: 1 EUR = £0.85');
    // Re-pricing after an edit replaces, never stacks.
    expect(withFxNote(priced, 'EUR', 0.86)).toBe('2x tickets (€4.5 each) · FX: 1 EUR = £0.86');
    // A manual £ override or a switch to GBP drops the stale note.
    expect(withFxNote(`FX: 1 CZK = £0.034 · ${priced}`, 'GBP', null)).toBe(
      '2x tickets (€4.5 each)',
    );
    expect(withFxNote('', 'EUR', 0.85)).toBe('FX: 1 EUR = £0.85');
  });
});
