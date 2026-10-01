import type { City, SleepKind, Trip } from './db';

/**
 * Everything derived from a trip's legs — pure and testable, so the UI never
 * has to keep name/dates/shape in sync by hand. A "leg" is one city visit in
 * order (the City table); arrival/departure/sleep are optional so older and
 * imported trips (which have none) still resolve sensibly via fallbacks.
 */

const DAY = 86_400_000;

export interface Leg {
  name: string;
  currency: string;
  arrival?: string;
  departure?: string;
  sleep: SleepKind;
  arrivalMs?: number;
  departureMs?: number;
}

export interface TripShape {
  key: 'same-day' | 'airport-sleep' | 'city-break' | 'multi-city' | 'multi-city-break' | 'trip';
  label: string;
}

/** Parse a 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' as local time; undefined if blank/invalid. */
function ms(v?: string): number | undefined {
  if (!v) return undefined;
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

/** Cities in travel order, normalised into legs with parsed times. */
export function tripLegs(cities: City[]): Leg[] {
  return [...cities]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      name: c.name.trim(),
      currency: c.currency,
      arrival: c.arrival,
      departure: c.departure,
      sleep: c.sleep ?? 'none',
      arrivalMs: ms(c.arrival),
      departureMs: ms(c.departure),
    }));
}

/** Distinct, order-preserving city names (collapses a repeated return city). */
export function tripCityNames(cities: City[]): string[] {
  const uniq: string[] = [];
  for (const l of tripLegs(cities)) {
    if (!l.name) continue;
    if (uniq[uniq.length - 1]?.toLowerCase() !== l.name.toLowerCase()) uniq.push(l.name);
  }
  return uniq;
}

/**
 * Leg times, sorted. They are floating local wall-clock strings
 * ('YYYY-MM-DDTHH:mm' in each city's own time), which sort chronologically as
 * text — so derived dates come out the same on every device and time zone.
 */
function legTimes(cities: City[], only?: 'departure'): string[] {
  return cities
    .flatMap((c) => (only ? [c.departure] : [c.arrival, c.departure]))
    .filter((v): v is string => !!v && ms(v) != null)
    .sort();
}

/** Trip start date ('YYYY-MM-DD'): earliest leg time, else the stored fallback. */
export function tripStartIso(trip: Trip, cities: City[]): string {
  return legTimes(cities)[0]?.slice(0, 10) ?? (trip.startDate || '');
}

/** Trip end date ('YYYY-MM-DD'): latest leg time, else the stored fallback. */
export function tripEndIso(trip: Trip, cities: City[]): string {
  return legTimes(cities).at(-1)?.slice(0, 10) ?? (trip.endDate || trip.startDate || '');
}

/** Countdown target: the last leg departure (local wall-clock), else the stored one. */
export function tripDepartureLocal(trip: Trip, cities: City[]): string {
  return legTimes(cities, 'departure').at(-1) ?? trip.returnFlightAt;
}

/**
 * The stored trip fields that mirror the legs, as a patch of only what changed.
 * Legacy/imported trips whose legs carry no dates keep their stored dates —
 * unless `lastDateRemoved`, i.e. this edit cleared the last leg date, in which
 * case the now-stale dates and countdown are cleared too.
 */
export function derivedTripFields(
  trip: Trip,
  cities: City[],
  lastDateRemoved = false,
): Partial<Trip> {
  const times = legTimes(cities);
  const departure = legTimes(cities, 'departure').at(-1);
  const next: Partial<Trip> = {};
  if (times.length) {
    next.startDate = times[0].slice(0, 10);
    next.endDate = times.at(-1)!.slice(0, 10);
  } else if (lastDateRemoved) {
    next.startDate = '';
    next.endDate = '';
  }
  if (departure) next.returnFlightAt = departure;
  else if (lastDateRemoved) next.returnFlightAt = '';
  if (cities.some((c) => c.arrival || c.departure || (c.sleep && c.sleep !== 'none'))) {
    next.accommodation = cities.some((c) => c.sleep === 'hotel');
  }
  return Object.fromEntries(
    Object.entries(next).filter(([k, v]) => trip[k as keyof Trip] !== v),
  ) as Partial<Trip>;
}

/** Whether any leg carries an arrival or departure time. */
export function hasLegDates(cities: City[]): boolean {
  return legTimes(cities).length > 0;
}

/** Inclusive day span of the trip (1 for a same-day trip; 0 if no dates at all). */
export function tripDays(trip: Trip, cities: City[]): number {
  const s = tripStartIso(trip, cities);
  if (!s) return 0;
  const e = tripEndIso(trip, cities) || s;
  return Math.max(1, Math.round((ms(e)! - ms(s)!) / DAY) + 1);
}

/** Hotel nights: summed from hotel legs when times exist, else inferred from the span. */
export function tripHotelNights(trip: Trip, cities: City[]): number {
  const legs = tripLegs(cities);
  let nights = 0;
  let haveInfo = false;
  for (const l of legs) {
    if (l.sleep === 'hotel') {
      haveInfo = true;
      nights +=
        l.arrivalMs != null && l.departureMs != null
          ? Math.max(
              1,
              Math.round(
                (Date.parse(l.departure!.slice(0, 10)) - Date.parse(l.arrival!.slice(0, 10))) / DAY,
              ),
            )
          : 1;
    }
  }
  if (haveInfo) return nights;
  if (trip.accommodation) return Math.max(1, tripDays(trip, cities) - 1);
  return 0;
}

function hasLegInfo(cities: City[]): boolean {
  return tripLegs(cities).some((l) => l.sleep !== 'none' || l.arrival || l.departure);
}

/**
 * The trip's shape, derived from its legs (with graceful fallbacks). This is
 * the single source of truth for the "type" shown everywhere — so it can never
 * disagree with the actual itinerary the way a hand-picked type could.
 */
export function tripShape(trip: Trip, cities: City[]): TripShape {
  const legs = tripLegs(cities).filter((l) => l.name);
  const distinctCities = new Set(legs.map((l) => l.name.toLowerCase())).size;
  const multi = distinctCities >= 2;
  const legInfo = hasLegInfo(cities);
  const hasHotel = legs.some((l) => l.sleep === 'hotel') || (!legInfo && trip.accommodation);
  const hasAirportSleep = legs.some((l) => l.sleep === 'airport');
  const startIso = tripStartIso(trip, cities);
  const endIso = tripEndIso(trip, cities);
  const sameDay = !!startIso && startIso === endIso && !hasHotel;

  if (multi && hasHotel) return { key: 'multi-city-break', label: 'multi-city break' };
  if (multi) return { key: 'multi-city', label: 'multi-city dash' };
  if (hasHotel) {
    const n = tripHotelNights(trip, cities);
    return { key: 'city-break', label: n > 0 ? `${n}-night city break` : 'city break' };
  }
  if (hasAirportSleep) return { key: 'airport-sleep', label: 'airport sleep' };
  if (sameDay) return { key: 'same-day', label: 'same-day dash' };

  const byType: Record<string, string> = {
    'same-day': 'same-day dash',
    'airport-sleep': 'airport sleep',
    weekend: 'city break',
    custom: 'trip',
  };
  return { key: 'trip', label: byType[trip.type] ?? 'trip' };
}

/** Standardised display name: manual override → arrow-joined cities → legacy name. */
export function tripDisplayName(trip: Trip, cities: City[]): string {
  if (trip.nameManual?.trim()) return trip.nameManual.trim();
  const names = tripCityNames(cities);
  if (names.length) return names.join(' → ');
  return trip.name?.trim() || 'New trip';
}

/** Compact date label: 'Oct 2024', 'Oct–Nov 2024', or 'Dec 2024 – Jan 2025'. */
export function tripDateLabel(trip: Trip, cities: City[]): string {
  const s = tripStartIso(trip, cities);
  if (!s) return '';
  const e = tripEndIso(trip, cities) || s;
  const sd = new Date(`${s}T00:00:00`);
  const ed = new Date(`${e}T00:00:00`);
  const mon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' });
  const yr = (d: Date) => d.getFullYear();
  if (mon(sd) === mon(ed) && yr(sd) === yr(ed)) return `${mon(sd)} ${yr(sd)}`;
  if (yr(sd) === yr(ed)) return `${mon(sd)}–${mon(ed)} ${yr(sd)}`;
  return `${mon(sd)} ${yr(sd)} – ${mon(ed)} ${yr(ed)}`;
}

/** The card sub-line: 'Oct 2024 · multi-city break' (spend appended by the caller). */
export function tripMetaLabel(trip: Trip, cities: City[]): string {
  const parts = [tripDateLabel(trip, cities), tripShape(trip, cities).label].filter(Boolean);
  return parts.join(' · ');
}
