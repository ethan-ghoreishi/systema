import type { Expense } from './db';

/** Existing quotes already keep their original party in their provenance note.
 * Unknown historical quotes stay readable, but never seed a payment amount.
 */
export function quoteMatchesParty(quote: Expense['quote'], partySize: number): boolean {
  const match = quote?.note?.match(/×\s*(\d+), as quoted$/);
  return !!match && Number(match[1]) === partySize;
}
