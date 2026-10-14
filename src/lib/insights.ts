import type { City, Expense, Moment, Stop, Trip } from './db';
import { realExpenses, tripTotalGBP, categorySummary, type CategoryTotal } from './expenses';
import { tripDays, tripDisplayName, tripLegs, tripStartIso } from './trip-shape';
import { expenseCityId, isShared } from './expense-defaults';
import { tripDepartures } from './readiness';

/**
 * Pure, offline aggregation for Insights — built around travel decisions,
 * not generic charts: what a day in a city costs, how airport transfers
 * went, how a trip's rhythm compared with its plan. Every figure carries its
 * sample size; spend shared by several cities is shown apart, never split
 * evenly behind the scenes; nothing is called "best" from thin data.
 */

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

// ---- What the numbers rest on ----

export interface DataQuality {
  trips: number;
  tripsWithSpend: number;
  expenses: number;
  unpriced: number;
  shared: { count: number; total: number };
  unlinked: { count: number; total: number };
  legs: number;
  legsTimed: number;
}

export function dataQuality(trips: Trip[], cities: City[], expenses: Expense[]): DataQuality {
  const real = realExpenses(expenses);
  const citiesOf = byTrip(cities);
  const shared = real.filter((e) => isShared(e));
  const unlinked = real.filter(
    (e) => !isShared(e) && !expenseCityId(e, citiesOf.get(e.tripId) ?? []),
  );
  const legs = tripLegs(cities);
  return {
    trips: trips.length,
    tripsWithSpend: new Set(real.map((e) => e.tripId)).size,
    expenses: real.length,
    unpriced: real.filter((e) => e.fxPending).length,
    shared: { count: shared.length, total: round2(tripTotalGBP(shared)) },
    unlinked: { count: unlinked.length, total: round2(tripTotalGBP(unlinked)) },
    legs: legs.length,
    legsTimed: legs.filter((l) => l.arrivalMs != null && l.departureMs != null).length,
  };
}

function byTrip<T extends { tripId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(r.tripId) ?? m.set(r.tripId, []).get(r.tripId)!).push(r);
  return m;
}

// ---- One visit = one leg of one trip ----

interface Visit {
  tripId: string;
  cityId: string;
  name: string;
  /** Days on the ground: leg hours / 24, or a single-city trip's calendar days. */
  days: number | null;
  daysFromDates: boolean;
  partySize: number;
  spend: number;
  food: number;
  experiences: number;
  transfer: number;
  visitedStops: number;
}

const TRANSFER = 'Airport Transfer (Abroad)';

function visits(trips: Trip[], cities: City[], expenses: Expense[], stops: Stop[]): Visit[] {
  const citiesOf = byTrip(cities);
  const real = realExpenses(expenses).filter((e) => !e.fxPending);
  const out: Visit[] = [];
  for (const trip of trips) {
    const legs = citiesOf.get(trip.id) ?? [];
    const timed = tripLegs(legs);
    const single = new Set(legs.map((c) => c.name.trim().toLowerCase())).size === 1;
    for (const leg of timed) {
      if (!leg.name) continue;
      let days: number | null = null;
      let daysFromDates = false;
      if (leg.arrivalMs != null && leg.departureMs != null && leg.departureMs > leg.arrivalMs)
        days = (leg.departureMs - leg.arrivalMs) / 86_400_000;
      else if (single && timed.length === 1 && tripDays(trip, legs) > 0) {
        days = tripDays(trip, legs);
        daysFromDates = true;
      }
      const mine = real.filter((e) => e.tripId === trip.id && expenseCityId(e, legs) === leg.id);
      const sum = (pred: (e: Expense) => boolean) =>
        mine.filter(pred).reduce((a, e) => a + (e.amountGBP || 0), 0);
      out.push({
        tripId: trip.id,
        cityId: leg.id,
        name: leg.name,
        days,
        daysFromDates,
        partySize: Math.max(1, trip.partySize || 1),
        spend: sum(() => true),
        food: sum((e) => e.category === 'Food'),
        experiences: sum((e) => e.category === 'Experiences'),
        transfer: sum((e) => e.subcategory === TRANSFER),
        visitedStops: stops.filter((s) => s.tripId === trip.id && s.cityId === leg.id && s.visited)
          .length,
      });
    }
  }
  return out;
}

// ---- Compare cities, one question at a time ----

export type CompareMetric = 'perDay' | 'foodPerDay' | 'transferPP' | 'perVisitedStop';

export const METRICS: Record<CompareMetric, { label: string; explain: string }> = {
  perDay: {
    label: 'A day on the ground',
    explain: "The city's own spend (not shared flights or hotels) per day there.",
  },
  foodPerDay: { label: 'Food per day', explain: 'Food spend per day there.' },
  transferPP: {
    label: 'Airport transfer, per person',
    explain: 'Airport transfers abroad per person, per visit that logged one.',
  },
  perVisitedStop: {
    label: 'Per place visited',
    explain: 'Experiences spend (tickets, entries) per stop ticked visited.',
  },
};

export interface CompareRow {
  name: string;
  value: number;
  visits: number;
  days: number;
  /** One visit only: a reading, not a pattern. */
  thin: boolean;
  /** Some days came from trip dates rather than leg times. */
  approximate: boolean;
}

/**
 * Cities ranked on one measure, each with its sample. Cities without the
 * data for that measure are named, not silently dropped.
 */
export function compareCities(
  trips: Trip[],
  cities: City[],
  expenses: Expense[],
  stops: Stop[],
  metric: CompareMetric,
): { rows: CompareRow[]; missing: string[] } {
  const groups = new Map<string, Visit[]>();
  for (const v of visits(trips, cities, expenses, stops)) {
    const k = v.name.toLowerCase();
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(v);
  }
  const rows: CompareRow[] = [];
  const missing: string[] = [];
  for (const vs of groups.values()) {
    const name = vs[vs.length - 1].name;
    let used: Visit[];
    let value: number | null;
    if (metric === 'perDay' || metric === 'foodPerDay') {
      used = vs.filter((v) => v.days && (metric === 'perDay' ? v.spend : v.food) > 0);
      const days = used.reduce((a, v) => a + v.days!, 0);
      const amount = used.reduce((a, v) => a + (metric === 'perDay' ? v.spend : v.food), 0);
      value = days > 0 ? amount / days : null;
    } else if (metric === 'transferPP') {
      used = vs.filter((v) => v.transfer > 0);
      value = used.length
        ? used.reduce((a, v) => a + v.transfer / v.partySize, 0) / used.length
        : null;
    } else {
      used = vs.filter((v) => v.visitedStops > 0 && v.experiences > 0);
      const n = used.reduce((a, v) => a + v.visitedStops, 0);
      value = n ? used.reduce((a, v) => a + v.experiences, 0) / n : null;
    }
    if (value == null) {
      missing.push(name);
      continue;
    }
    rows.push({
      name,
      value: round2(value),
      visits: used.length,
      days: Math.round(used.reduce((a, v) => a + (v.days ?? 0), 0) * 10) / 10,
      thin: used.length < 2,
      approximate: used.some((v) => v.daysFromDates),
    });
  }
  rows.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
  return { rows, missing: missing.sort() };
}

// ---- Getting to and from airports ----

export interface TransitRow {
  key: string;
  city: string;
  trip: string;
  date: string;
  mode: string;
  costPP: number | null;
  journeyMin: number | null;
  notes: string;
}

/** Each visit's airport transfer: how, what it cost per person, how long, and what to remember. */
export function transitRows(trips: Trip[], cities: City[], expenses: Expense[]): TransitRow[] {
  const citiesOf = byTrip(cities);
  const real = realExpenses(expenses);
  const out: TransitRow[] = [];
  for (const trip of trips) {
    const legs = citiesOf.get(trip.id) ?? [];
    for (const c of legs) {
      const paid = real.filter(
        (e) =>
          e.tripId === trip.id && e.subcategory === TRANSFER && expenseCityId(e, legs) === c.id,
      );
      const exit = c.exit ?? {};
      if (!paid.length && !exit.transport && exit.journeyMin == null) continue;
      const described = [...new Set(paid.map((e) => e.description.trim()).filter(Boolean))];
      const total = paid.reduce((a, e) => a + (e.amountGBP || 0), 0);
      out.push({
        key: `${trip.id}:${c.id}`,
        city: c.name,
        trip: tripDisplayName(trip, legs),
        date: tripStartIso(trip, legs),
        mode: exit.transport || described.join(', ') || 'not noted',
        costPP: paid.length ? round2(total / Math.max(1, trip.partySize || 1)) : null,
        journeyMin: exit.journeyMin ?? null,
        notes: exit.notes ?? '',
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.city.localeCompare(b.city));
}

// ---- Trip rhythm ----

export interface RhythmRow {
  tripId: string;
  name: string;
  date: string;
  days: number;
  planned: number;
  visited: number;
  offPlan: number;
  rides: number;
  departures: number;
  /** Average buffer + contingency planned before each departure (minutes). */
  slackMin: number | null;
  perVisitedStop: number | null;
}

const RIDES = new Set([
  'Local Transport (Abroad)',
  'Regional Train (Abroad)',
  'Regional Bus (Abroad)',
  'Ferry / Boat',
  'Lift / Funicular',
]);

/** How each trip actually went against its plan. */
export function tripRhythm(
  trips: Trip[],
  cities: City[],
  expenses: Expense[],
  stops: Stop[],
  moments: Moment[],
): RhythmRow[] {
  const citiesOf = byTrip(cities);
  const real = realExpenses(expenses);
  return trips
    .map((trip) => {
      const legs = citiesOf.get(trip.id) ?? [];
      const mine = stops.filter((s) => s.tripId === trip.id);
      const visited = mine.filter((s) => s.visited).length;
      const spent = real.filter((e) => e.tripId === trip.id);
      const experiences = spent
        .filter((e) => e.category === 'Experiences' && !e.fxPending)
        .reduce((a, e) => a + (e.amountGBP || 0), 0);
      const deps = tripDepartures(trip, legs);
      return {
        tripId: trip.id,
        name: tripDisplayName(trip, legs),
        date: tripStartIso(trip, legs),
        days: tripDays(trip, legs),
        planned: mine.length,
        visited,
        offPlan: moments.filter((m) => m.tripId === trip.id).length,
        rides: spent.filter((e) => RIDES.has(e.subcategory)).length,
        departures: deps.length,
        slackMin: deps.length
          ? Math.round(deps.reduce((a, d) => a + d.bufferMin + d.contingencyMin, 0) / deps.length)
          : null,
        perVisitedStop: visited && experiences ? round2(experiences / visited) : null,
      };
    })
    .filter((r) => r.planned || r.offPlan || r.rides)
    .sort((a, b) => b.date.localeCompare(a.date));
}
