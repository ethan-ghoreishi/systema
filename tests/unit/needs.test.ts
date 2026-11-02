import { describe, it, expect } from 'vitest';
import { outstanding, tripNeeds } from '../../src/lib/needs';
import type { City, Expense, Stop, Trip } from '../../src/lib/db';

const NOW = Date.parse('2026-12-01T09:00:00Z');

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: '',
    type: 'weekend',
    startDate: '2026-12-11',
    endDate: '2026-12-12',
    partySize: 2,
    returnFlightAt: '2026-12-12T19:30',
    accommodation: true,
    status: 'planning',
    planText: '',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    outbound: { at: '2026-12-11T06:00', tz: 'Europe/London', hub: 'STN', number: 'FR5767' },
    ...over,
  };
}

function leg(over: Partial<City> = {}): City {
  return {
    id: 'c1',
    tripId: 't1',
    name: 'Faro',
    currency: 'EUR',
    order: 0,
    arrival: '2026-12-11T09:25',
    departure: '2026-12-12T19:30',
    sleep: 'hotel',
    tz: 'Europe/Lisbon',
    exit: { hub: 'FAO', number: 'U22412' },
    ...over,
  };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    tripId: 't1',
    cityId: null,
    date: '2026-11-20',
    destination: 'Faro',
    category: 'Transportation',
    subcategory: 'Flight',
    description: 'Outbound flight',
    paymentMethod: 'Online Payment',
    amountGBP: 38,
    amountLocal: 0,
    notes: '',
    currency: 'GBP',
    fxRate: null,
    skeleton: false,
    order: 0,
    createdAt: 1,
    ...over,
  };
}

function stop(over: Partial<Stop> = {}): Stop {
  return {
    id: 's1',
    tripId: 't1',
    cityId: 'c1',
    name: 'Igreja do Carmo',
    notes: '',
    checklist: [],
    visited: false,
    order: 0,
    createdAt: 1,
    ...over,
  };
}

const keys = (ns: { key: string }[]) => ns.map((n) => n.key);

describe('what is left before a trip', () => {
  it('asks for both tickets, both London transfers, the city transfer, a bed and a plan', () => {
    const todo = outstanding(tripNeeds(trip(), [leg()], [], [], NOW));
    expect(keys(todo)).toEqual([
      'flight:outbound',
      'flight:inbound',
      'transfer-uk:out',
      'transfer-uk:back',
      'transfer:c1',
      'hotel:c1',
      'plan',
    ]);
  });

  it('asks for no bed when no night is paid for', () => {
    const todo = outstanding(tripNeeds(trip(), [leg({ sleep: 'none' })], [], [], NOW));
    expect(keys(todo)).not.toContain('hotel:c1');
  });

  // Derived, not ticked: a booking reference *is* the booked flight.
  it('reads a booking reference as the ticket being booked', () => {
    const t = trip({ outbound: { ...trip().outbound, ref: 'XY12AB' } });
    const needs = tripNeeds(t, [leg({ exit: { hub: 'FAO', ref: 'ZZ99' } })], [], [], NOW);
    const done = needs.filter((n) => n.done);
    expect(keys(done)).toContain('flight:outbound');
    expect(keys(done)).toContain('flight:inbound');
    expect(needs.find((n) => n.key === 'flight:outbound')?.evidence).toBe('Booking XY12AB');
  });

  // The brief's rule: relevant transfer data exists, so stop asking for it.
  it('reads a chosen way to the airport as the transfer being settled', () => {
    const t = trip({
      outbound: { ...trip().outbound, transport: 'National Express', journeyMin: 75 },
    });
    const needs = tripNeeds(t, [leg()], [], [], NOW);
    const uk = needs.find((n) => n.key === 'transfer-uk:out')!;
    expect(uk.done).toBe(true);
    expect(uk.detail).toBe('National Express, 75 min');
    const city = tripNeeds(
      trip(),
      [leg({ exit: { hub: 'FAO', transport: 'Próximo bus', journeyMin: 20 } })],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'transfer:c1')!;
    expect(city.done).toBe(true);
  });

  // The £22 coach: one payment settles the requirement and is the expense.
  it('reads a payment stamped with the need as that need being met', () => {
    const paid = [
      expense({ id: 'e1', need: 'transfer-uk:back', amountGBP: 22 }),
      expense({ id: 'e2', need: 'hotel:c1', amountGBP: 60, category: 'Accommodation' }),
    ];
    const needs = tripNeeds(trip(), [leg()], paid, [], NOW);
    expect(needs.find((n) => n.key === 'transfer-uk:back')?.done).toBe(true);
    expect(needs.find((n) => n.key === 'transfer-uk:back')?.evidence).toBe('£22');
    expect(needs.find((n) => n.key === 'hotel:c1')?.done).toBe(true);
  });

  // A skeleton row is a placeholder, not a payment, and never resolves anything.
  it('ignores an unfilled skeleton row', () => {
    const skeletons = [expense({ need: 'flight:outbound', amountGBP: 0, skeleton: true })];
    const needs = tripNeeds(trip(), [leg()], skeletons, [], NOW);
    expect(needs.find((n) => n.key === 'flight:outbound')?.done).toBe(false);
  });

  it('wants a plan per city on a multi-city trip, and knows which one is written', () => {
    const legs = [leg(), leg({ id: 'c2', name: 'Seville', order: 1 })];
    const t = trip({ planText: '# Faro\n\n## Route\n\n### Igreja do Carmo\n' });
    const needs = tripNeeds(t, legs, [], [], NOW);
    expect(needs.find((n) => n.key === 'plan:c1')?.done).toBe(true);
    expect(needs.find((n) => n.key === 'plan:c2')?.done).toBe(false);
    expect(needs.find((n) => n.key === 'plan')).toBeUndefined();
  });

  it('carries a place the plan says to book ahead, until it is paid for or visited', () => {
    const stops = [stop({ bookAhead: 'Timed entry, book a week ahead' })];
    const needs = tripNeeds(trip(), [leg()], [], stops, NOW);
    const book = needs.find((n) => n.key === 'book:s1')!;
    expect(book.done).toBe(false);
    expect(book.detail).toBe('Timed entry, book a week ahead');
    expect(
      tripNeeds(
        trip(),
        [leg()],
        [expense({ need: 'book:s1', amountGBP: 14, category: 'Experiences' })],
        stops,
        NOW,
      ).find((n) => n.key === 'book:s1')?.done,
    ).toBe(true);
    expect(
      keys(tripNeeds(trip(), [leg()], [], [stop({ bookAhead: 'x', visited: true })], NOW)),
    ).not.toContain('book:s1');
    expect(keys(tripNeeds(trip(), [leg()], [], [stop()], NOW))).not.toContain('book:s1');
  });

  // The one thing nothing in the data can answer — and only worth asking late.
  it('asks about checking in only once the flight is close, and takes the tick', () => {
    expect(keys(tripNeeds(trip(), [leg()], [], [], NOW))).not.toContain('checkin:outbound');
    const close = Date.parse('2026-12-10T08:00:00Z');
    const needs = tripNeeds(trip(), [leg()], [], [], close);
    expect(keys(needs)).toContain('checkin:outbound');
    expect(needs.find((n) => n.key === 'checkin:outbound')?.done).toBe(false);
    const ticked = trip({ outbound: { ...trip().outbound, checkedIn: true } });
    expect(
      tripNeeds(ticked, [leg()], [], [], close).find((n) => n.key === 'checkin:outbound')?.done,
    ).toBe(true);
  });

  it('empties itself completely once the trip is together', () => {
    const t = trip({
      planText: '## Route\n\n### Igreja do Carmo\n',
      outbound: { ...trip().outbound, ref: 'XY12AB', transport: 'National Express' },
    });
    const legs = [
      leg({
        exit: { hub: 'FAO', ref: 'ZZ99', transport: 'Próximo bus', journeyMin: 20 },
        base: { name: 'Hotel Faro' },
      }),
    ];
    const paid = [expense({ need: 'transfer-uk:back', amountGBP: 22 })];
    expect(outstanding(tripNeeds(t, legs, paid, [], NOW))).toEqual([]);
  });

  it('says nothing at all for a trip with no legs yet', () => {
    const needs = tripNeeds(trip({ outbound: undefined }), [], [], [], NOW);
    expect(keys(needs)).not.toContain('transfer:c1');
    expect(keys(needs)).toContain('plan');
  });
});
