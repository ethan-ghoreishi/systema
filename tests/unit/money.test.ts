import { describe, it, expect } from 'vitest';
import { formatAmount, formatGBP, perPersonNote } from '../../src/lib/money';

describe('formatAmount', () => {
  it('uses a symbol where known', () => {
    expect(formatAmount(30, 'GBP')).toBe('£30');
    expect(formatAmount(4.5, 'EUR')).toBe('€4.5');
  });
  it('falls back to the code', () => {
    expect(formatAmount(120, 'CZK')).toBe('120 CZK');
  });
});

describe('formatGBP', () => {
  it('always shows 2 decimal places', () => {
    expect(formatGBP(156.4)).toBe('£156.40');
    expect(formatGBP(0)).toBe('£0.00');
  });
});

describe('perPersonNote', () => {
  it('splits the total across the party', () => {
    expect(perPersonNote(2, 60, 'GBP')).toBe('2x tickets (£30 each)');
    expect(perPersonNote(2, 9, 'EUR')).toBe('2x tickets (€4.5 each)');
    expect(perPersonNote(2, 240, 'CZK')).toBe('2x tickets (120 CZK each)');
  });
});
