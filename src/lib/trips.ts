import { db, type City, type Trip, type TripType } from './db';
import { presetByType } from './presets';
import { newId } from './ids';
import { seedSkeleton } from './expenses';

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
    name: preset.label,
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
  const city: City = { id, tripId, name, currency, order };
  await db.cities.add(city);
  return id;
}

export async function updateCity(id: string, patch: Partial<City>): Promise<void> {
  await db.cities.update(id, patch);
}

export async function deleteCity(id: string): Promise<void> {
  await db.cities.delete(id);
}
