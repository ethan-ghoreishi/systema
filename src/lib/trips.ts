import { db, type City, type Trip } from './db';
import { presetByKey } from './presets';
import { newId } from './ids';
import { seedSkeleton } from './expenses';
import { deletePhotosWhere } from './photos';
import {
  derivedTripFields,
  hasLegDates,
  legOrderProblem,
  scenarioPattern,
  type StopoverScenario,
} from './trip-shape';

/**
 * Trip + City mutations. Kept as plain async functions over Dexie so the UI
 * stays thin and these are easy to reason about.
 */

export const DEFAULT_PARTY_SIZE = 2;

/** Create a trip from a preset (by key: 'same-day', 'two-city', …) and return its id. */
export async function createTrip(key: string): Promise<string> {
  const preset = presetByKey(key);
  const now = Date.now();
  const order = await db.trips.count();
  const id = newId();

  const trip: Trip = {
    id,
    name: '', // display name derives from the legs (see tripDisplayName)
    type: preset.type,
    ...(preset.key !== preset.type ? { preset: preset.key } : {}),
    startDate: '',
    endDate: '',
    partySize: DEFAULT_PARTY_SIZE,
    returnFlightAt: '',
    accommodation: preset.accommodation,
    status: 'planning',
    planText: '',
    order,
    createdAt: now,
    updatedAt: now,
  };

  await db.trips.add(trip);
  // Pre-seed this trip's skeleton expense rows so only the variable items remain.
  await seedSkeleton(trip);
  return id;
}

export async function updateTrip(id: string, patch: Partial<Trip>): Promise<void> {
  await db.trips.update(id, { ...patch, updatedAt: Date.now() });
}

/** Delete a trip and everything that belongs to it. */
export async function deleteTrip(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.trips, db.cities, db.stops, db.expenses, db.photos, db.kv, db.moments],
    async () => {
      await db.cities.where('tripId').equals(id).delete();
      await db.moments.where('tripId').equals(id).delete();
      await db.stops.where('tripId').equals(id).delete();
      await db.expenses.where('tripId').equals(id).delete();
      await deletePhotosWhere('tripId', id);
      await db.trips.delete(id);
    },
  );
}

export async function addCity(
  tripId: string,
  name: string,
  currency: string,
  extra: Partial<City> = {},
): Promise<string> {
  const order = await db.cities.where('tripId').equals(tripId).count();
  const id = newId();
  const city: City = { id, tripId, name, currency, order, sleep: 'none', ...extra };
  await db.cities.add(city);
  await recomputeTripDerived(tripId);
  return id;
}

async function legsHaveDates(tripId: string): Promise<boolean> {
  return hasLegDates(await db.cities.where('tripId').equals(tripId).toArray());
}

/** A save refused because the result wouldn't make sense; `message` says how to repair it. */
export class LegError extends Error {}

/**
 * Update a leg. A departure before its own arrival is never saved — checked
 * here, against the stored row, so no screen (or sync-free script) can store
 * one. Cross-leg chronology is reported, not refused (see legIssues): the
 * traveller may be halfway through moving several legs.
 */
export async function updateCity(id: string, patch: Partial<City>): Promise<void> {
  // Check and write in one transaction: two edits in flight (an arrival and a
  // departure changed in quick succession) are serialised, so the second is
  // checked against the first instead of both passing on the old leg.
  const { city, hadDates } = await db.transaction('rw', db.cities, async () => {
    const city = await db.cities.get(id);
    if (city) {
      const problem = legOrderProblem({ ...city, ...patch });
      if (problem) throw new LegError(problem);
    }
    const hadDates = city ? await legsHaveDates(city.tripId) : false;
    await db.cities.update(id, patch);
    return { city, hadDates };
  });
  if (city) await recomputeTripDerived(city.tripId, hadDates);
}

/**
 * Lay out a two-city stopover: the stopover and destination cities as two
 * legs in the scenario's order, the hotel night where it falls, and the hop
 * marked as part of the outbound or return ticket. Existing legs with the same
 * names are reused (keeping their times); nothing else is touched.
 */
export async function applyStopoverScenario(
  tripId: string,
  scenario: StopoverScenario,
  stopover: { name: string; currency: string },
  destination: { name: string; currency: string },
): Promise<void> {
  const pattern = scenarioPattern(scenario);
  const [first, second] =
    pattern.order === 'stopover-first' ? [stopover, destination] : [destination, stopover];
  await db.transaction('rw', db.cities, db.trips, async () => {
    const legs = await db.cities.where('tripId').equals(tripId).sortBy('order');
    const find = (name: string) =>
      legs.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    const rows = [first, second].map((spec, i) => {
      const existing = find(spec.name);
      const sleep = (pattern.nightIn === 'first') === (i === 0) ? 'hotel' : 'none';
      const exit =
        i === 0
          ? { ...existing?.exit, throughTicket: pattern.ticket }
          : existing?.exit && { ...existing.exit, throughTicket: undefined };
      return {
        ...(existing ?? { id: newId(), tripId, currency: spec.currency, name: spec.name.trim() }),
        order: i,
        sleep,
        ...(exit ? { exit } : {}),
      } as City;
    });
    const keep = new Set(rows.map((r) => r.id));
    const others = legs.filter((c) => !keep.has(c.id));
    await db.cities.bulkPut(rows);
    await Promise.all(others.map((c, i) => db.cities.update(c.id, { order: 2 + i })));
    await db.trips.update(tripId, { preset: 'two-city' });
  });
  await recomputeTripDerived(tripId);
}

export async function deleteCity(id: string): Promise<void> {
  const city = await db.cities.get(id);
  const hadDates = city ? await legsHaveDates(city.tripId) : false;
  await db.cities.delete(id);
  if (city) await recomputeTripDerived(city.tripId, hadDates);
}

/** Reorder a trip's legs so `id` moves by `delta` (-1 up, +1 down). */
export async function moveCity(id: string, delta: number): Promise<void> {
  const city = await db.cities.get(id);
  if (!city) return;
  const legs = await db.cities.where('tripId').equals(city.tripId).sortBy('order');
  const i = legs.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= legs.length) return;
  [legs[i], legs[j]] = [legs[j], legs[i]];
  await db.transaction('rw', db.cities, async () => {
    await Promise.all(legs.map((c, idx) => db.cities.update(c.id, { order: idx })));
  });
  await recomputeTripDerived(city.tripId);
}

/**
 * Keep the trip's stored startDate / endDate / returnFlightAt / accommodation in
 * step with its legs, so the rest of the app (countdown, exports, backups,
 * sorting) reads consistent values without every screen re-deriving them.
 * `hadLegDates`: whether the legs carried dates before this edit — if the edit
 * removed the last one, the stale derived dates are cleared.
 */
export async function recomputeTripDerived(tripId: string, hadLegDates = false): Promise<void> {
  const [trip, cities] = await Promise.all([
    db.trips.get(tripId),
    db.cities.where('tripId').equals(tripId).sortBy('order'),
  ]);
  if (!trip) return;
  const patch = derivedTripFields(trip, cities, hadLegDates && !hasLegDates(cities));
  if (Object.keys(patch).length) await db.trips.update(tripId, { ...patch, updatedAt: Date.now() });
}
