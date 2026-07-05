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

function isoDate(msVal: number): string {
  const d = new Date(msVal);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/** Trip start date ('YYYY-MM-DD'): earliest leg arrival, else the stored fallback. */
export function tripStartIso(trip: Trip, cities: City[]): string {
  const arrivals = tripLegs(cities)
    .map((l) => l.arrivalMs)
    .filter((x): x is number => x != null);
  if (arrivals.length) return isoDate(Math.min(...arrivals));
  return trip.startDate || '';
}

/** Trip end date ('YYYY-MM-DD'): latest leg departure, else the stored fallback. */
export function tripEndIso(trip: Trip, cities: City[]): string {
  const departures = tripLegs(cities)
    .map((l) => l.departureMs)
    .filter((x): x is number => x != null);
  if (departures.length) return isoDate(Math.max(...departures));
  return trip.endDate || trip.startDate || '';
}

/** Countdown target (ms): the last leg departure, else the stored return flight. */
export function tripDepartureMs(trip: Trip, cities: City[]): number | null {
  const departures = tripLegs(cities)
    .map((l) => l.departureMs)
    .filter((x): x is number => x != null);
  if (departures.length) return Math.max(...departures);
  return ms(trip.returnFlightAt) ?? null;
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
          ? Math.max(1, Math.round((l.departureMs - l.arrivalMs) / DAY))
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
