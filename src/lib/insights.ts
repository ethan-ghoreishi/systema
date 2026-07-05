import type { Expense, Trip } from './db';
import { realExpenses, tripTotalGBP, categorySummary, type CategoryTotal } from './expenses';
import { tripDays } from './trip-shape';

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

export interface CitySummary {
  name: string;
  total: number;
  tripCount: number;
  days: number;
  perDay: number;
}

export interface CityInsights {
  cities: CitySummary[];
  cheapest?: CitySummary;
  priciest?: CitySummary;
  maxTotal: number;
  maxPerDay: number;
}

/** A destination string may hold more than one city ("Barcelona/Bologna"). */
function cityParts(dest: string): string[] {
  return dest
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Spend per city across every trip, so cheapest/priciest and per-day value can
 * be compared. Attribution uses each expense's Destination (reliable even for
 * imported data, where expenses aren't linked to city rows); a combined
 * "A/B" destination is split evenly, and a trip's days are shared evenly across
 * the distinct cities that appear in it.
 */
export function buildCityInsights(trips: Trip[], expenses: Expense[]): CityInsights {
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const byTrip = new Map<string, Expense[]>();
  for (const e of realExpenses(expenses)) {
    (byTrip.get(e.tripId) ?? byTrip.set(e.tripId, []).get(e.tripId)!).push(e);
  }

  const acc = new Map<string, { name: string; total: number; trips: Set<string>; days: number }>();
  for (const [tripId, rows] of byTrip) {
    const trip = tripById.get(tripId);
    const days = trip ? tripDays(trip, []) : 0;

    const distinct = new Set<string>();
    for (const e of rows) for (const c of cityParts(e.destination)) distinct.add(c.toLowerCase());
    const perCityDays = distinct.size ? days / distinct.size : 0;

    for (const e of rows) {
      const parts = cityParts(e.destination);
      if (!parts.length) continue;
      const share = e.amountGBP / parts.length;
      for (const name of parts) {
        const k = name.toLowerCase();
        const cur = acc.get(k) ?? { name, total: 0, trips: new Set<string>(), days: 0 };
        cur.total += share;
        cur.trips.add(tripId);
        acc.set(k, cur);
      }
    }
    for (const k of distinct) {
      const cur = acc.get(k);
      if (cur) cur.days += perCityDays;
    }
  }

  const cities: CitySummary[] = [...acc.values()]
    .map((c) => ({
      name: c.name,
      total: round2(c.total),
      tripCount: c.trips.size,
      days: Math.round(c.days),
      perDay: c.days > 0 ? round2(c.total / c.days) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const ranked = [...cities].filter((c) => c.perDay > 0).sort((a, b) => a.perDay - b.perDay);

  return {
    cities,
    cheapest: ranked[0],
    priciest: ranked[ranked.length - 1],
    maxTotal: Math.max(0, ...cities.map((c) => c.total)),
    maxPerDay: Math.max(0, ...cities.map((c) => c.perDay)),
  };
}
