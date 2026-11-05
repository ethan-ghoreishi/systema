/** Small currency helpers (pure). */

export const MONEY_HINT =
  'Use 12.50 or 12,50. For thousands, use 1234.56, 1,234.56 or 1.234,56. A lone separator with three digits after it is ambiguous.';

/** Refuse ambiguous grouping and partial numbers rather than guessing what was paid. */
export function parseMoney(value: string): number | null {
  const v = value
    .trim()
    .replace(/^£\s*/, '')
    .replace(/[\u00a0\u202f]/g, ' ');
  let normal: string;
  if (/^(?:\d+(?:[.,]\d{0,2})?|[.,]\d{1,2})$/.test(v)) normal = v.replace(',', '.');
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(v)) normal = v.replaceAll(',', '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(v))
    normal = v.replaceAll('.', '').replace(',', '.');
  else if (/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(v))
    normal = v.replaceAll(' ', '').replace(',', '.');
  else if (/^\d{1,3}(?:,\d{3}){2,}$/.test(v)) normal = v.replaceAll(',', '');
  else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(v)) normal = v.replaceAll('.', '');
  else return null;
  const n = Number(normal);
  return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER / 100 ? n : null;
}

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
