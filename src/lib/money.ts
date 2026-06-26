/** Small currency-display helpers (pure). */

const SYMBOLS: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  JPY: '¥',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code.trim().toUpperCase()] ?? '';
}

function tidy(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** "£30", "€4.5", or "120 CZK" for currencies without a known symbol. */
export function formatAmount(amount: number, code: string): string {
  const c = code.trim().toUpperCase();
  const sym = currencySymbol(c);
  return sym ? `${sym}${tidy(amount)}` : `${tidy(amount)} ${c}`;
}

/** Always-2dp GBP, for totals. */
export function formatGBP(amount: number): string {
  return `£${tidy(amount).toFixed(2)}`;
}

/** The per-person breakdown that goes into Notes, e.g. "2x tickets (€4.5 each)". */
export function perPersonNote(party: number, totalAmount: number, code: string): string {
  const each = party > 0 ? totalAmount / party : totalAmount;
  return `${party}x tickets (${formatAmount(each, code)} each)`;
}
