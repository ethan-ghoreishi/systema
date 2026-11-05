import { describe, it, expect } from 'vitest';
import { formatAmount, formatGBP, perPersonNote, parseMoney } from '../../src/lib/money';

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

describe('parseMoney', () => {
  it.each([
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['0,50', 0.5],
    ['.50', 0.5],
    ['12.', 12],
    ['0', 0],
    ['1234', 1234],
    ['£ 1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1 234,56', 1234.56],
    ['1\u202f234.56', 1234.56],
    ['1\u00a0234', 1234],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
  ])('reads %s without changing its magnitude', (value, expected) => {
    expect(parseMoney(value as string)).toBe(expected);
  });
  it.each([
    '',
    '£',
    '1,234',
    '1.234',
    '12,345',
    '12.345',
    '1,23,4',
    '1 2',
    '1,234,56',
    '12abc',
    '1e3',
    '0x10',
    '-12',
    'Infinity',
    'NaN',
    '12.50.00',
    '12\n50',
    '9007199254740992',
    '1,234.567',
  ])('refuses ambiguous, invalid or unsafe input %s', (value) => {
    expect(parseMoney(value)).toBeNull();
  });
});
