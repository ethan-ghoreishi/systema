import {
  expenseCityId,
  findDuplicate,
  isManualGBP,
  isShared,
  lastPaymentMethod,
  likelySubcategory,
  recentTemplates,
  sharedDestination,
} from '../../src/lib/expense-defaults';
import { describe, it, expect } from 'vitest';
import {
  realExpenses,
  tripTotalGBP,
  categorySummary,
  looksAnomalous,
  assignTransactionNumbers,
  priceEntry,
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

describe('quick capture defaults', () => {
  const base = {
    id: 'x',
    tripId: 't',
    cityId: null,
    date: '2026-10-16',
    destination: 'Bologna',
    category: 'Experiences',
    subcategory: 'Museum',
    description: 'Archiginnasio',
    paymentMethod: 'Cash Payment',
    amountGBP: 4.25,
    amountLocal: 5,
    notes: '',
    currency: 'EUR',
    fxRate: 0.85,
    skeleton: false,
    order: 0,
    createdAt: 1,
  };

  it('offers recent picks, the last payment method, and a likely subcategory', () => {
    const older = {
      ...base,
      id: 'o',
      createdAt: 0,
      category: 'Food',
      subcategory: 'Café',
      description: '',
    };
    expect(recentTemplates([older, base]).map((t) => t.label)).toEqual(['Archiginnasio', 'Café']);
    expect(lastPaymentMethod([base], 'other-trip')).toBe('Cash Payment');
    expect(lastPaymentMethod([], 't')).toBe('Card Payment');
    expect(likelySubcategory('Food', [])).toBe('Grocery Shopping');
    expect(likelySubcategory('Food', [older])).toBe('Café');
  });

  it("reads 'A/B' destinations as trip-wide, and links the rest to their leg", () => {
    const cities = [
      { id: 'blq', tripId: 't', name: 'Bologna', currency: 'EUR', order: 0 },
      { id: 'bcn', tripId: 't', name: 'Barcelona', currency: 'EUR', order: 1 },
    ];
    expect(isShared({ ...base, destination: 'Bologna/Barcelona' })).toBe(true);
    expect(isShared({ ...base, shared: false, destination: 'Bologna/Barcelona' })).toBe(false);
    expect(expenseCityId(base, cities)).toBe('blq');
    expect(expenseCityId({ ...base, destination: 'Somewhere else' }, cities)).toBeNull();
    expect(sharedDestination(cities)).toBe('Bologna/Barcelona');
  });

  it('spots a likely double entry', () => {
    const dup = findDuplicate({ ...base, description: '' }, [base]);
    expect(dup?.id).toBe('x');
    expect(findDuplicate({ ...base, amountLocal: 6 }, [base])).toBeUndefined();
    expect(findDuplicate(base, [base], 'x')).toBeUndefined();
  });
});

describe('isManualGBP', () => {
  const row = {
    currency: 'AMD',
    fxRate: null,
    fxPending: false,
    amountGBP: 4.2,
    skeleton: false,
  };
  it('reads an older non-GBP row with a £ but no rate as typed by hand', () => {
    expect(isManualGBP(row)).toBe(true);
    expect(isManualGBP({ ...row, fxRate: 0.0021 })).toBe(false); // priced from a rate
    expect(isManualGBP({ ...row, fxPending: true, amountGBP: 0 })).toBe(false);
    expect(isManualGBP({ ...row, currency: 'GBP' })).toBe(false);
    expect(isManualGBP({ ...row, gbpManual: false })).toBe(false); // the flag wins
  });
});

// The bug: a booking written by "Book it" stores the £ as a hand-typed one, so
// the capture sheet pre-filled its hidden override field — hidden, because the
// override is only on screen for a foreign currency. Editing the amount then
// saved the override: the original price, straight back over the correction.
describe('what a saved expense’s £ comes to', () => {
  const booked = {
    amount: 22,
    amountGBP: 22,
    currency: 'GBP',
    date: '2026-12-01',
    fxRate: null,
  };

  it('takes a corrected £ amount, on a row a booking made', () => {
    const r = priceEntry({
      amount: 25,
      currency: 'GBP',
      date: '2026-12-01',
      // What the component used to carry invisibly for a row of this kind.
      overrideGBP: 22,
      recorded: booked,
    });
    expect(r.amountGBP).toBe(25);
    expect(r.keepRecorded).toBe(false);
    expect(r.gbpManual).toBe(false);
  });

  it('keeps the £ it was recorded with while nothing that decided it moves', () => {
    const r = priceEntry({ amount: 22, currency: 'GBP', date: '2026-12-01', recorded: booked });
    expect(r.amountGBP).toBe(22);
    expect(r.keepRecorded).toBe(true);
  });

  it('prices a foreign amount at the day’s rate, and keeps what was typed over it', () => {
    const auto = priceEntry({ amount: 50, currency: 'EUR', date: '2026-12-01', rate: 0.86 });
    expect(auto.amountGBP).toBe(43);
    expect(auto.amountLocal).toBe(50);
    expect(auto.fxRate).toBe(0.86);
    expect(auto.autoRate).toBe(0.86);
    expect(auto.gbpManual).toBe(false);

    const typed = priceEntry({
      amount: 50,
      currency: 'EUR',
      date: '2026-12-01',
      rate: 0.86,
      overrideGBP: 44.1,
    });
    expect(typed.amountGBP).toBe(44.1);
    expect(typed.fxRate).toBeNull();
    expect(typed.gbpManual).toBe(true);
    expect(typed.autoRate).toBeNull();
  });

  // A dinar has no ECB rate, ever. It saves with the amount it has and waits.
  it('saves an amount it cannot price, rather than refusing it', () => {
    const r = priceEntry({ amount: 38, currency: 'JOD', date: '2026-12-01', rate: null });
    expect(r.fxPending).toBe(true);
    expect(r.amountGBP).toBe(0);
    expect(r.amountLocal).toBe(38);
  });

  it('re-prices once the amount, the currency or the date changes', () => {
    const recorded = {
      amount: 50,
      amountGBP: 43,
      currency: 'EUR',
      date: '2026-12-01',
      fxRate: 0.86,
    };
    expect(
      priceEntry({ amount: 60, currency: 'EUR', date: '2026-12-01', rate: 0.9, recorded })
        .amountGBP,
    ).toBe(54);
    expect(
      priceEntry({ amount: 50, currency: 'EUR', date: '2026-12-02', rate: 0.9, recorded })
        .amountGBP,
    ).toBe(45);
    expect(
      priceEntry({ amount: 50, currency: 'EUR', date: '2026-12-01', rate: 0.9, recorded })
        .keepRecorded,
    ).toBe(true);
  });
});
