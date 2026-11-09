import { db, type City, type Stop, type Trip } from './db';
import { extractStopsFromPlan, planItem, type StopCandidate } from './stops';
import { same } from './sync';
import { newId } from './ids';
import { updateTrip } from './trips';

const key = (name: string) => name.trim().toLocaleLowerCase();

/** The legs this plan text could be speaking about: every leg of that name. */
function planCities(candidate: StopCandidate, cities: City[]): City[] {
  const named = cities.filter((city) => key(city.name) === key(candidate.city ?? ''));
  return named.length ? named : !candidate.city && cities.length === 1 ? cities : [];
}

/** Unlabelled single-city plans are safe to assign; repeated city names need an explicit leg. */
export function planCityId(candidate: StopCandidate, cities: City[]): string | null {
  const named = planCities(candidate, cities);
  return named.length === 1 ? named[0].id : null;
}

/**
 * The existing places each candidate could be: same name (or the name it was
 * imported under), on one of the candidate's legs or on none. A city the trip
 * returns to cannot say which leg a new place belongs on, but an existing
 * place of that name on one of those legs is still that place — and keeps its
 * own leg. A place with no leg of its own can be any leg's: otherwise
 * re-applying the plan that created it would add it a second time. A place
 * that is the only choice for an earlier candidate is no one else's.
 */
export function planChoices(
  candidates: StopCandidate[],
  stops: Stop[],
  cities: City[],
): string[][] {
  const used = new Set<string>();
  return candidates.map((c) => {
    const legs = new Set(planCities(c, cities).map((city) => city.id));
    const named = stops.filter(
      (s) =>
        !used.has(s.id) &&
        [s.name, s.planSource?.name].some((name) => name && key(name) === key(c.name)) &&
        (!s.cityId || legs.has(s.cityId)),
    );
    if (named.length === 1) used.add(named[0].id);
    return named.map((s) => s.id);
  });
}

/** Match only one unambiguous place of that name (see planChoices); '' adds a new place. */
export function planMatches(candidates: StopCandidate[], stops: Stop[], cities: City[]): string[] {
  return planChoices(candidates, stops, cities).map((ids) => (ids.length === 1 ? ids[0] : ''));
}

/**
 * A row the traveller has yet to decide: two or more existing places could
 * be it. Never applied — guessing would move one place's history to another.
 */
export const UNDECIDED = '?';

/** Matches for review: ambiguous rows wait for a decision instead of becoming new places. */
export function reviewMatches(
  candidates: StopCandidate[],
  stops: Stop[],
  cities: City[],
): string[] {
  return planChoices(candidates, stops, cities).map((ids) =>
    ids.length === 1 ? ids[0] : ids.length ? UNDECIDED : '',
  );
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
  // Retire only the plan's own unticked items that the plan wrote exactly so
  // and no longer lists. Ticked items, items added by hand, and items whose
  // origin is unknown (written before items were marked) always stay.
  // An item the plan wrote ticked and is now unticked has been edited: it stays.
  const listed = stop.planSource?.checklist ?? [];
  const untouched = new Set(listed.filter((item) => !item.done).map((item) => item.text));
  const nextKeys = new Set(next.checklist.map((item) => key(item.text)));
  row.checklist = stop.checklist.filter(
    (item) =>
      !(item.fromPlan && !item.done && untouched.has(item.text) && !nextKeys.has(key(item.text))),
  );
  // Add new discoveries once. One the last plan already listed and that is
  // gone from the stop was deleted by hand: it stays deleted.
  const listedKeys = new Set(listed.map((item) => key(item.text)));
  for (const item of next.checklist) {
    if (
      !row.checklist.some((have) => key(have.text) === key(item.text)) &&
      !listedKeys.has(key(item.text))
    )
      row.checklist.push(planItem(item));
  }
  return row;
}

/**
 * What becomes of the places the revised route does not list. A revised route
 * only speaks for the places the plan itself put there: one added by hand was
 * never the plan's to drop, so it stays on the route.
 */
export function planRetained(
  stops: Stop[],
  matches: string[],
  previousText: string,
  cities: City[],
): { personal: Stop[]; offRoute: Stop[] } {
  const previous = extractStopsFromPlan(
    previousText,
    cities.map((c) => c.name),
  );
  const prior = planMatches(previous, stops, cities);
  // Only what the plan in force actually listed. A place put back on the route
  // by hand is the traveller's again, and the next revision leaves it there.
  const fromPlan = (s: Stop) => !!s.offPlan || prior.includes(s.id);
  const unmatched = stops.filter((s) => !matches.includes(s.id));
  return {
    personal: unmatched.filter((s) => !fromPlan(s)),
    offRoute: unmatched.filter(fromPlan),
  };
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
  if (matches.includes(UNDECIDED))
    throw new Error('Choose which existing place each repeated name is, or add it as new');
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
        checklist: c.checklist.map(planItem),
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
      const { personal, offRoute } = planRetained(stops, matches, previousText, cities);
      // A personal place stays with its own leg, never after a later city's
      // stops, where the list would read it as part of a leg it is not on.
      for (const s of personal) {
        const last = rows.map((r) => r.cityId).lastIndexOf(s.cityId);
        rows.splice(last < 0 ? rows.length : last + 1, 0, { ...s, offPlan: false });
      }
      rows.push(...offRoute.map((s) => ({ ...s, offPlan: true })));
      await db.stops.bulkPut(rows.map((s, order) => ({ ...s, order })));
    }
    await updateTrip(trip.id, { planText: text });
  });
}
