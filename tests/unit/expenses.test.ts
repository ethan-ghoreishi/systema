import { describe, it, expect } from 'vitest';
import {
  realExpenses,
  tripTotalGBP,
  categorySummary,
  looksAnomalous,
  assignTransactionNumbers,
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
