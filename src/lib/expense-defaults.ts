import type { City, Expense } from './db';
import { subcategories } from './vocab';

/**
 * Quick capture: the likely category from a template or a recent expense,
 * and everything else defaulted — so a metro ticket is amount + one tap.
 * Pure; the taxonomy stays the Travel Spending sheet's (vocab.ts).
 */

export interface ExpenseTemplate {
  key: string;
  label: string;
  category: string;
  subcategory: string;
  description?: string;
  paymentMethod?: string;
  /** Trip-wide by default (flights, the UK end of an airport run). */
  shared?: boolean;
}

export const TEMPLATES: ExpenseTemplate[] = [
  {
    key: 'local',
    label: 'Metro / bus / tram',
    category: 'Transportation',
    subcategory: 'Local Transport (Abroad)',
  },
  { key: 'groceries', label: 'Groceries', category: 'Food', subcategory: 'Grocery Shopping' },
  { key: 'museum', label: 'Museum', category: 'Experiences', subcategory: 'Museum' },
  {
    key: 'cathedral',
    label: 'Cathedral / church',
    category: 'Experiences',
    subcategory: 'Cathedral',
  },
  { key: 'landmark', label: 'Landmark', category: 'Experiences', subcategory: 'Landmark' },
  {
    key: 'transfer',
    label: 'Airport transfer',
    category: 'Transportation',
    subcategory: 'Airport Transfer (Abroad)',
  },
  {
    key: 'train',
    label: 'Regional train',
    category: 'Transportation',
    subcategory: 'Regional Train (Abroad)',
  },
  {
    key: 'transfer-uk',
    label: 'Airport transfer (UK)',
    category: 'Transportation',
    subcategory: 'Airport Transfer (UK)',
    shared: true,
  },
  {
    key: 'flight',
    label: 'Flight',
    category: 'Transportation',
    subcategory: 'Flight',
    paymentMethod: 'Online Payment',
    shared: true,
  },
  {
    key: 'hotel',
    label: 'Hotel',
    category: 'Accommodation',
    subcategory: 'Hotel',
    paymentMethod: 'Online Payment',
  },
];

// The likeliest subcategory when only the category is tapped (grocery-first).
const LIKELY: Record<string, string> = {
  Transportation: 'Local Transport (Abroad)',
  Accommodation: 'Hotel',
  Experiences: 'Museum',
  Food: 'Grocery Shopping',
  'Personal & Financial Expenses': 'Other Personal Items',
};

const newestFirst = (expenses: Expense[]) =>
  expenses.filter((e) => !e.skeleton).sort((a, b) => b.createdAt - a.createdAt);

/** The last few distinct things captured (any trip), as one-tap picks. */
export function recentTemplates(expenses: Expense[], n = 4): ExpenseTemplate[] {
  const seen = new Set<string>();
  const out: ExpenseTemplate[] = [];
  for (const e of newestFirst(expenses)) {
    const desc = e.description.trim();
    const key = `${e.category}|${e.subcategory}|${desc.toLowerCase()}`;
    if (!e.category || !e.subcategory || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key: `recent:${key}`,
      label: desc || e.subcategory,
      category: e.category,
      subcategory: e.subcategory,
      description: desc || undefined,
      paymentMethod: e.paymentMethod || undefined,
      shared: e.shared,
    });
    if (out.length >= n) break;
  }
  return out;
}

/** The payment method used last — in this trip if any, else anywhere. */
export function lastPaymentMethod(expenses: Expense[], tripId: string): string {
  const all = newestFirst(expenses);
  return (
    all.find((e) => e.tripId === tripId && e.paymentMethod)?.paymentMethod ??
    all.find((e) => e.paymentMethod)?.paymentMethod ??
    'Card Payment'
  );
}

/** The subcategory to preselect for a category: the last one used with it, else the likeliest. */
export function likelySubcategory(category: string, expenses: Expense[]): string {
  const used = newestFirst(expenses).find((e) => e.category === category)?.subcategory;
  const valid = subcategories[category] ?? [];
  if (used && valid.includes(used)) return used;
  return LIKELY[category] ?? valid[0] ?? '';
}

/**
 * Trip-wide rather than one city's spend. Older rows have no flag: the
 * sheet's convention, a 'CityA/CityB' destination, reads as shared.
 */
export function isShared(e: Pick<Expense, 'shared' | 'cityId' | 'destination'>): boolean {
  return e.shared ?? (!e.cityId && e.destination.includes('/'));
}

/** The sheet's Destination text for a trip-wide expense: 'Bologna/Barcelona'. */
export function sharedDestination(cities: City[]): string {
  const names: string[] = [];
  for (const c of [...cities].sort((a, b) => a.order - b.order)) {
    const n = c.name.trim();
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names.join('/');
}

/**
 * The leg an expense belongs to: its own link, else (older and imported rows)
 * the trip's city its Destination names exactly. Shared ones belong to none.
 */
export function expenseCityId(
  e: Pick<Expense, 'shared' | 'cityId' | 'destination'>,
  cities: City[],
): string | null {
  if (isShared(e)) return null;
  if (e.cityId) return e.cityId;
  const dest = e.destination.trim().toLowerCase();
  return cities.find((c) => c.name.trim().toLowerCase() === dest)?.id ?? null;
}

/**
 * An expense this one would probably duplicate: same trip, same date, same
 * amount in the same currency, and the same subcategory or description.
 */
export function findDuplicate(
  candidate: Pick<
    Expense,
    'tripId' | 'date' | 'currency' | 'amountLocal' | 'amountGBP' | 'subcategory' | 'description'
  >,
  expenses: Expense[],
  ignoreId?: string,
): Expense | undefined {
  const gbp = candidate.currency === 'GBP';
  return expenses.find(
    (e) =>
      e.id !== ignoreId &&
      !e.skeleton &&
      e.tripId === candidate.tripId &&
      e.date === candidate.date &&
      e.currency === candidate.currency &&
      (gbp ? e.amountGBP === candidate.amountGBP : e.amountLocal === candidate.amountLocal) &&
      (e.subcategory === candidate.subcategory ||
        (!!candidate.description.trim() &&
          e.description.trim().toLowerCase() === candidate.description.trim().toLowerCase())),
  );
}

/**
 * The £ was typed by hand: never re-priced from a rate. Older rows have no
 * flag — a non-GBP row with a £ amount but no rate behind it (a hand entry,
 * or a sheet import) reads as manual.
 */
export function isManualGBP(
  e: Pick<Expense, 'gbpManual' | 'currency' | 'fxRate' | 'fxPending' | 'amountGBP' | 'skeleton'>,
): boolean {
  if (e.skeleton) return false;
  return (
    e.gbpManual ?? (e.currency !== 'GBP' && e.fxRate == null && !e.fxPending && e.amountGBP > 0)
  );
}
