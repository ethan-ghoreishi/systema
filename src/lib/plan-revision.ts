import { db, type City, type Stop, type Trip } from './db';
import { extractStopsFromPlan, type StopCandidate } from './stops';
import { same } from './sync';
import { newId } from './ids';
import { updateTrip } from './trips';

const key = (name: string) => name.trim().toLocaleLowerCase();

/** Unlabelled single-city plans are safe to assign; repeated city names need an explicit leg. */
export function planCityId(candidate: StopCandidate, cities: City[]): string | null {
  const named = cities.filter((city) => key(city.name) === key(candidate.city ?? ''));
  return named.length === 1
    ? named[0].id
    : !candidate.city && cities.length === 1
      ? cities[0].id
      : null;
}

/** Match only one unambiguous place in the same city. Renames need the traveller's choice. */
export function planMatches(candidates: StopCandidate[], stops: Stop[], cities: City[]): string[] {
  const used = new Set<string>();
  return candidates.map((c) => {
    const cityId = planCityId(c, cities);
    const named = stops.filter(
      (s) =>
        !used.has(s.id) &&
        [s.name, s.planSource?.name].some((name) => name && key(name) === key(c.name)) &&
        (cityId
          ? s.cityId === cityId || (!s.cityId && cities.length === 1)
          : !c.city && cities.length <= 1),
    );
    const id = named.length === 1 ? named[0].id : '';
    if (id) used.add(id);
    return id;
  });
}

/** Update only content still identical to the previous plan; all personal fields stay put. */
export function revisedStop(stop: Stop, next: StopCandidate, previous?: StopCandidate): Stop {
  const source = stop.planSource ?? previous;
  const row = { ...stop, offPlan: false, planSource: next };
  for (const field of ['name', 'notes', 'bookAhead'] as const) {
    if (source && same(stop[field] ?? '', source[field] ?? ''))
      Object.assign(row, { [field]: next[field] ?? (field === 'bookAhead' ? undefined : '') });
  }
  const guide = { ...stop.guide };
  for (const field of ['anchor', 'minimum', 'lookFor', 'stretch', 'exit'] as const) {
    if (source && same(stop.guide?.[field], source.guide?.[field]))
      Object.assign(guide, { [field]: next.guide?.[field] });
  }
  if (Object.values(guide).some(Boolean)) row.guide = guide;
  else delete row.guide;
  // Existing pins may be corrections. Even an unchanged imported pin is kept.
  if (stop.lat == null && stop.lng == null && next.lat != null && next.lng != null) {
    row.lat = next.lat;
    row.lng = next.lng;
  }
  // Keep ticked discoveries and personal additions; add new discoveries once.
  row.checklist = [...stop.checklist];
  for (const item of next.checklist) {
    if (!row.checklist.some((have) => key(have.text) === key(item.text)))
      row.checklist.push({ id: newId(), ...item });
  }
  return row;
}

export async function savePlanRevision(
  trip: Trip,
  text: string,
  candidates: StopCandidate[],
  matches: string[],
  stops: Stop[],
  cities: City[],
  previousText = trip.planText,
): Promise<void> {
  if (
    matches.length !== candidates.length ||
    new Set(matches.filter(Boolean)).size !== matches.filter(Boolean).length
  )
    throw new Error('Each existing place can only be used once. Review the matches');
  if (matches.some((id) => id && !stops.some((s) => s.id === id)))
    throw new Error('A matched stop no longer exists');
  const previous = extractStopsFromPlan(
    previousText,
    cities.map((c) => c.name),
  );
  const priorMatches = planMatches(previous, stops, cities);
  await db.transaction('rw', db.trips, db.stops, db.cities, async () => {
    const currentTrip = await db.trips.get(trip.id);
    const currentStops = await db.stops.where('tripId').equals(trip.id).sortBy('order');
    const currentCities = await db.cities.where('tripId').equals(trip.id).sortBy('order');
    if (
      currentTrip?.planText !== trip.planText ||
      !same(stops, currentStops) ||
      !same(cities, currentCities)
    )
      throw new Error(
        'The plan or places changed elsewhere. Close this review and reopen it to see the saved changes',
      );
    const rows = candidates.map((c, order): Stop => {
      const stop = stops.find((s) => s.id === matches[order]);
      if (stop) return { ...revisedStop(stop, c, previous[priorMatches.indexOf(stop.id)]), order };
      return {
        id: newId(),
        tripId: trip.id,
        cityId: planCityId(c, cities),
        name: c.name,
        notes: c.notes,
        checklist: c.checklist.map((item) => ({ id: newId(), ...item })),
        lat: c.lat,
        lng: c.lng,
        guide: c.guide,
        bookAhead: c.bookAhead,
        planSource: c,
        offPlan: false,
        visited: false,
        order,
        createdAt: Date.now(),
      };
    });
    // No extraction means an unstructured plan, never an instruction to empty the route.
    if (candidates.length) {
      const retained = stops.filter((s) => !matches.includes(s.id));
      rows.push(...retained.map((s, i) => ({ ...s, offPlan: true, order: rows.length + i })));
      await db.stops.bulkPut(rows);
    }
    await updateTrip(trip.id, { planText: text });
  });
}
