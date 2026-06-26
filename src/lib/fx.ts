import { db } from './db';
import { todayIso } from './sheet';

/**
 * Free, no-key FX via Frankfurter (ECB rates). Rates are cached per currency in
 * IndexedDB so conversion works offline. ECB covers ~30 major currencies — for
 * anything else (e.g. MAD, AMD) `getRate` returns null and the UI falls back to
 * a manual GBP entry.
 */

const FRANKFURTER = 'https://api.frankfurter.app';

export interface FxResult {
  rate: number; // multiply local by this to get GBP
  date: string; // ECB date the rate is for
  cached: boolean;
  stale: boolean; // true if not today's rate
}

export function convertToGBP(localAmount: number, rate: number): number {
  return Math.round((localAmount * rate + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve the local→GBP rate for a currency. Tries today's cache, then the
 * network, then any stale cache. Returns null if unavailable (offline with no
 * cache, or an ECB-unsupported currency).
 */
export async function getRate(code: string): Promise<FxResult | null> {
  const c = code.trim().toUpperCase();
  if (!c || c === 'GBP') {
    return { rate: 1, date: todayIso(), cached: true, stale: false };
  }

  const today = todayIso();
  const cached = await db.fxRates.get(c);
  if (cached && cached.date === today) {
    return { rate: cached.rate, date: cached.date, cached: true, stale: false };
  }

  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const res = await fetch(`${FRANKFURTER}/latest?from=${encodeURIComponent(c)}&to=GBP`);
      if (res.ok) {
        const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
        const rate = data.rates?.GBP;
        if (typeof rate === 'number' && Number.isFinite(rate)) {
          const date = data.date ?? today;
          await db.fxRates.put({ code: c, rate, date, fetchedAt: Date.now() });
          return { rate, date, cached: false, stale: false };
        }
      }
    } catch {
      // network failed — fall through to stale cache
    }
  }

  if (cached) {
    return { rate: cached.rate, date: cached.date, cached: true, stale: cached.date !== today };
  }

  return null;
}
