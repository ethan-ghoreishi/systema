import type { City, SleepKind, Trip } from './db';
import { HOME_TZ, wallLabel, wallToInstant } from './tz';

/**
 * Everything derived from a trip's legs — pure and testable, so the UI never
 * has to keep name/dates/shape in sync by hand. A "leg" is one city visit in
 * order (the City table); arrival/departure/sleep are optional so older and
 * imported trips (which have none) still resolve sensibly via fallbacks.
 */

const DAY = 86_400_000;

export interface Leg {
  id: string;
  name: string;
  currency: string;
  arrival?: string;
  departure?: string;
  sleep: SleepKind;
  tz?: string;
  /** Real instants, read in the leg's own zone (device zone if it has none). */
  arrivalMs?: number;
  departureMs?: number;
}

export interface TripShape {
  key:
    | 'same-day'
    | 'airport-sleep'
    | 'city-break'
    | 'multi-city'
    | 'multi-city-break'
    | 'two-city'
    | 'trip';
  label: string;
}

/** Calendar days between two 'YYYY-MM-DD' dates (UTC maths: DST can't skew it). */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
}

/** Cities in travel order, normalised into legs with zone-aware instants. */
export function tripLegs(cities: City[]): Leg[] {
  return [...cities]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      id: c.id,
      name: c.name.trim(),
      currency: c.currency,
      arrival: c.arrival,
      departure: c.departure,
      sleep: c.sleep ?? 'none',
      tz: c.tz,
      arrivalMs: wallToInstant(c.arrival, c.tz),
      departureMs: wallToInstant(c.departure, c.tz),
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
 * Leg times as wall-clock strings (each city's own time), in real
 * chronological order: sorted by instant, so a westward hop sorts right. The
 * dates derived from them are the dates on the tickets, the same on every
 * device.
 */
function legTimes(cities: City[], only?: 'departure'): string[] {
  return cities
    .flatMap((c) =>
      (only ? [c.departure] : [c.arrival, c.departure]).map((v) => ({
        v,
        t: wallToInstant(v, c.tz),
      })),
    )
    .filter((x): x is { v: string; t: number } => !!x.v && x.t != null)
    .sort((a, b) => a.t - b.t || a.v.localeCompare(b.v))
    .map((x) => x.v);
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
  return Math.max(1, dayDiff(s, e) + 1);
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
          ? Math.max(1, dayDiff(l.arrival!, l.departure!))
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

  const stopover = stopoverShape(trip, cities);
  if (stopover) return { key: 'two-city', label: stopover.label };
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

// ---- Two-City Stopover ----

/**
 * The four Two-City Stopover scenarios (from the flight finder), in the
 * traveller's order of preference. Land in the first city by ~11:00; move on
 * that evening (after ~18:00) or next morning (before ~10:00); fly home from
 * the second city after ~18:00. One ticket stops in the stopover city, so the
 * hop between the cities is a protected connection; the other is nonstop.
 */
export const STOPOVER_SCENARIOS = {
  1: 'Stopover on the way out: a day there, fly on in the evening, night at the destination',
  2: 'Stopover on the way out: a day and a night there, fly on early next morning',
  3: 'Stopover on the way back: fly there in the evening, night there, home next evening',
  4: 'Night at the destination, fly on early next morning to a day in the stopover city',
} as const;

export type StopoverScenario = keyof typeof STOPOVER_SCENARIOS;

export interface StopoverShape {
  /** Undefined until the hop's ticket is known (scenarios 1/3 and 2/4 share a leg pattern). */
  scenario?: StopoverScenario;
  first: string;
  second: string;
  stopover?: string;
  destination?: string;
  nightIn: string;
  hop: 'evening' | 'morning';
  label: string;
}

/**
 * A two-city stopover, derived from the legs (never stored, so it can't
 * disagree with them): two cities, one hotel night in one of them, and — to
 * tell the scenarios apart — which ticket the hop between them belongs to
 * (`exit.throughTicket` on the first leg). Undefined for other trips.
 */
export function stopoverShape(trip: Trip, cities: City[]): StopoverShape | undefined {
  const sorted = [...cities].sort((a, b) => a.order - b.order);
  if (sorted.length !== 2) return undefined;
  const [a, b] = sorted;
  const ticket = a.exit?.throughTicket;
  if (!ticket && trip.preset !== 'two-city') return undefined;
  if (!a.name.trim() || !b.name.trim()) return undefined;
  if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) return undefined;
  const sa = a.sleep ?? 'none';
  const sb = b.sleep ?? 'none';
  const nightInFirst = sa === 'hotel' && sb !== 'hotel';
  const nightInSecond = sb === 'hotel' && sa !== 'hotel';
  if (!nightInFirst && !nightInSecond) {
    return {
      first: a.name.trim(),
      second: b.name.trim(),
      nightIn: '',
      hop: 'evening',
      label: 'two-city stopover',
    };
  }
  const first = a.name.trim();
  const second = b.name.trim();
  const hop = nightInFirst ? 'morning' : 'evening';
  const nightIn = nightInFirst ? first : second;
  let scenario: StopoverScenario | undefined;
  if (ticket === 'outbound') scenario = nightInFirst ? 2 : 1;
  if (ticket === 'return') scenario = nightInFirst ? 4 : 3;
  const stopover = ticket === 'outbound' ? first : ticket === 'return' ? second : undefined;
  const destination = ticket === 'outbound' ? second : ticket === 'return' ? first : undefined;
  const via = stopover
    ? `${ticket === 'outbound' ? 'out' : 'back'} via ${stopover}, night in ${nightIn}`
    : `${first} → ${second}, night in ${nightIn}`;
  return {
    scenario,
    first,
    second,
    stopover,
    destination,
    nightIn,
    hop,
    label: `two-city stopover${scenario ? ` ${scenario}` : ''} · ${via}`,
  };
}

/** The leg pattern a scenario implies, for laying out a new two-city trip. */
export function scenarioPattern(n: StopoverScenario): {
  order: 'stopover-first' | 'destination-first';
  nightIn: 'first' | 'second';
  ticket: 'outbound' | 'return';
} {
  return {
    1: { order: 'stopover-first', nightIn: 'second', ticket: 'outbound' },
    2: { order: 'stopover-first', nightIn: 'first', ticket: 'outbound' },
    3: { order: 'destination-first', nightIn: 'second', ticket: 'return' },
    4: { order: 'destination-first', nightIn: 'first', ticket: 'return' },
  }[n] as ReturnType<typeof scenarioPattern>;
}

// ---- Chronology ----

export interface LegIssue {
  cityId: string;
  /** 'order': departs before it arrives (refused on save). Others are warnings. */
  kind: 'order' | 'overlap' | 'outbound' | 'pattern';
  message: string;
}

/**
 * Departure before arrival within one leg: the reason a save is refused, as
 * the guidance to show. Undefined when the times are fine (or incomplete).
 */
export function legOrderProblem(c: Pick<City, 'name' | 'arrival' | 'departure' | 'tz'>):
  | string
  | undefined {
  const arr = wallToInstant(c.arrival, c.tz);
  const dep = wallToInstant(c.departure, c.tz);
  if (arr == null || dep == null || dep >= arr) return undefined;
  return `${c.name || 'This leg'}: departure (${wallLabel(c.departure!)}) is before arrival (${wallLabel(c.arrival!)}). Change the one that's wrong — if you're moving both later, set the departure first.`;
}

/**
 * Everything that doesn't add up across the itinerary, with repair guidance.
 * Compared on real instants, so a westward hop that "lands before it left" on
 * the clock is fine.
 */
export function legIssues(trip: Trip, cities: City[]): LegIssue[] {
  const legs = tripLegs(cities);
  const out: LegIssue[] = [];
  for (const c of cities) {
    const problem = legOrderProblem(c);
    if (problem) out.push({ cityId: c.id, kind: 'order', message: problem });
  }
  for (let i = 1; i < legs.length; i += 1) {
    const prev = legs[i - 1];
    const cur = legs[i];
    if (prev.departureMs != null && cur.arrivalMs != null && cur.arrivalMs < prev.departureMs) {
      out.push({
        cityId: cur.id,
        kind: 'overlap',
        message: `${cur.name || 'Leg ' + (i + 1)} arrives (${wallLabel(cur.arrival!)}) before ${prev.name || 'the leg before'} is left (${wallLabel(prev.departure!)}). Check the order of the legs or one of the times.`,
      });
    }
  }
  const out0 = trip.outbound;
  const firstLeg = legs[0];
  const outAt = wallToInstant(out0?.at, out0?.tz ?? HOME_TZ);
  if (outAt != null && firstLeg?.arrivalMs != null && firstLeg.arrivalMs < outAt) {
    out.push({
      cityId: firstLeg.id,
      kind: 'outbound',
      message: `${firstLeg.name} arrival (${wallLabel(firstLeg.arrival!)}) is before you leave home (${wallLabel(out0!.at!)}). Check the date of either.`,
    });
  }
  return out;
}

/**
 * Gentle notes when a two-city trip drifts from its pattern (land by ~11:00,
 * hop after ~18:00 or before ~10:00, home after ~18:00). Information, never a
 * block: plans change.
 */
export function stopoverNotes(trip: Trip, cities: City[]): LegIssue[] {
  const shape = stopoverShape(trip, cities);
  if (!shape?.nightIn) return [];
  const [a, b] = [...cities].sort((x, y) => x.order - y.order);
  const hhmm = (v?: string) => (v && v.length >= 16 ? v.slice(11, 16) : '');
  const notes: LegIssue[] = [];
  const land = hhmm(a.arrival);
  if (land && land > '11:30')
    notes.push({
      cityId: a.id,
      kind: 'pattern',
      message: `Landing in ${a.name} at ${land} leaves a shorter first day than the pattern's ~11:00.`,
    });
  const hop = hhmm(a.departure);
  if (hop && shape.hop === 'evening' && hop < '17:30')
    notes.push({
      cityId: a.id,
      kind: 'pattern',
      message: `Leaving ${a.name} at ${hop} cuts the day there short (the pattern hops after ~18:00).`,
    });
  if (hop && shape.hop === 'morning' && hop > '10:30')
    notes.push({
      cityId: a.id,
      kind: 'pattern',
      message: `A ${hop} hop eats into the day in ${b.name} (the pattern leaves before ~10:00).`,
    });
  const home = hhmm(b.departure);
  if (home && home < '17:30')
    notes.push({
      cityId: b.id,
      kind: 'pattern',
      message: `Flying home from ${b.name} at ${home} shortens the last day (the pattern leaves after ~18:00).`,
    });
  return notes;
}

/**
 * The leg you're in (or about to start) at `now`: the one whose arrival →
 * departure window holds now, else the next to begin, else the last. Legs
 * without times count as current in order. Undefined for no legs.
 */
export function activeLegId(cities: City[], now = Date.now()): string | undefined {
  const legs = tripLegs(cities);
  if (!legs.length) return undefined;
  const timed = legs.filter((l) => l.arrivalMs != null || l.departureMs != null);
  if (!timed.length) return legs[0].id;
  for (const l of legs) {
    const start = l.arrivalMs ?? -Infinity;
    const end = l.departureMs ?? Infinity;
    if (now >= start && now < end) return l.id;
  }
  const next = legs.find((l) => (l.arrivalMs ?? Infinity) > now);
  return (next ?? legs[legs.length - 1]).id;
}
