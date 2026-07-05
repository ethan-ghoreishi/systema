import { db, type City, type Trip, type TripType } from './db';
import { presetByType } from './presets';
import { newId } from './ids';
import { seedSkeleton } from './expenses';
import { tripStartIso, tripEndIso, tripDepartureMs } from './trip-shape';

/**
 * Trip + City mutations. Kept as plain async functions over Dexie so the UI
 * stays thin and these are easy to reason about.
 */

export const DEFAULT_PARTY_SIZE = 2;

/** Create a trip from a preset and return its id. */
export async function createTrip(type: TripType): Promise<string> {
  const preset = presetByType(type);
  const now = Date.now();
  const order = await db.trips.count();
  const id = newId();

  const trip: Trip = {
    id,
    name: '', // display name derives from the legs (see tripDisplayName)
    type,
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
  await db.transaction('rw', db.trips, db.cities, db.stops, db.expenses, db.photos, async () => {
    await db.cities.where('tripId').equals(id).delete();
    await db.stops.where('tripId').equals(id).delete();
    await db.expenses.where('tripId').equals(id).delete();
    await db.photos.where('tripId').equals(id).delete();
    await db.trips.delete(id);
  });
}

export async function addCity(tripId: string, name: string, currency: string): Promise<string> {
  const order = await db.cities.where('tripId').equals(tripId).count();
  const id = newId();
  const city: City = { id, tripId, name, currency, order, sleep: 'none' };
  await db.cities.add(city);
  await recomputeTripDerived(tripId);
  return id;
}

export async function updateCity(id: string, patch: Partial<City>): Promise<void> {
  const city = await db.cities.get(id);
  await db.cities.update(id, patch);
  if (city) await recomputeTripDerived(city.tripId);
}

export async function deleteCity(id: string): Promise<void> {
  const city = await db.cities.get(id);
  await db.cities.delete(id);
  if (city) await recomputeTripDerived(city.tripId);
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

function toLocalInput(msVal: number): string {
  const d = new Date(msVal);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Keep the trip's stored startDate / endDate / returnFlightAt / accommodation in
 * step with its legs, so the rest of the app (countdown, exports, backups,
 * sorting) reads consistent values without every screen re-deriving them.
 * Only overwrites a field when the legs actually carry that information.
 */
export async function recomputeTripDerived(tripId: string): Promise<void> {
  const [trip, cities] = await Promise.all([
    db.trips.get(tripId),
    db.cities.where('tripId').equals(tripId).sortBy('order'),
  ]);
  if (!trip) return;

  const patch: Partial<Trip> = {
    startDate: tripStartIso(trip, cities),
    endDate: tripEndIso(trip, cities),
  };

  if (cities.some((c) => c.departure)) {
    const depMs = tripDepartureMs(trip, cities);
    if (depMs != null) patch.returnFlightAt = toLocalInput(depMs);
  }
  if (cities.some((c) => c.arrival || c.departure || (c.sleep && c.sleep !== 'none'))) {
    patch.accommodation = cities.some((c) => c.sleep === 'hotel');
  }

  await db.trips.update(tripId, { ...patch, updatedAt: Date.now() });
}
