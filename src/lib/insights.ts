import type { Expense, Trip } from './db';
import { realExpenses, tripTotalGBP, categorySummary, type CategoryTotal } from './expenses';

/** Pure aggregation for the all-trips Insights dashboard. */

export interface TripSummary {
  trip: Trip;
  total: number;
  byCategory: CategoryTotal[];
  count: number;
}

export interface Overview {
  tripCount: number;
  total: number;
  average: number;
  byCategory: CategoryTotal[];
  trips: TripSummary[];
  maxTripTotal: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Summarise every trip plus the whole ledger. Trips ordered newest first. */
export function buildOverview(trips: Trip[], expenses: Expense[]): Overview {
  const byTrip = new Map<string, Expense[]>();
  for (const e of expenses) {
    const list = byTrip.get(e.tripId) ?? [];
    list.push(e);
    byTrip.set(e.tripId, list);
  }

  const summaries: TripSummary[] = trips
    .map((trip) => {
      const rows = realExpenses(byTrip.get(trip.id) ?? []);
      return {
        trip,
        total: tripTotalGBP(rows),
        byCategory: categorySummary(rows),
        count: rows.length,
      };
    })
    .filter((s) => s.count > 0 || s.trip.status !== 'planning')
    .sort((a, b) => (b.trip.startDate || '9999').localeCompare(a.trip.startDate || '9999'));

  const all = realExpenses(expenses);
  const total = tripTotalGBP(all);
  const withSpend = summaries.filter((s) => s.total > 0);

  return {
    tripCount: summaries.length,
    total,
    average: withSpend.length ? round2(total / withSpend.length) : 0,
    byCategory: categorySummary(all),
    trips: summaries,
    maxTripTotal: Math.max(0, ...summaries.map((s) => s.total)),
  };
}
