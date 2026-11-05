import { describe, expect, it } from 'vitest';
import { quoteMatchesParty } from '../../src/lib/quotes';

describe('historical quote basis', () => {
  it('offers a quote only when its recorded party matches, without repricing history', () => {
    const quote = { amountGBP: 80, note: '£40 each × 2, as quoted' };
    expect(quoteMatchesParty(quote, 2)).toBe(true);
    expect(quoteMatchesParty(quote, 3)).toBe(false);
    expect(quote.amountGBP).toBe(80);
    expect(quoteMatchesParty({ amountGBP: 80 }, 2)).toBe(false);
  });
});
