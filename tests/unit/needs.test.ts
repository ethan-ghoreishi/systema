import { describe, it, expect } from 'vitest';
import { outstanding, tripIsOver, tripNeeds } from '../../src/lib/needs';
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
  // The way in from the airport and the way out to it are two journeys: a
  // different direction, a different hour, often a different mode and fare.
  it('asks for both tickets, both London transfers, both city transfers, a bed and a plan', () => {
    const todo = outstanding(tripNeeds(trip(), [leg()], [], [], NOW));
    expect(keys(todo)).toEqual([
      'flight:outbound',
      'flight:inbound',
      'transfer-uk:out',
      'transfer-uk:back',
      'transfer-in:c1',
      'transfer-out:c1',
      'hotel:c1',
      'plan',
    ]);
  });

  it('asks nothing about the way in when the leg has no arrival to get in from', () => {
    const todo = keys(outstanding(tripNeeds(trip(), [leg({ arrival: undefined })], [], [], NOW)));
    expect(todo).not.toContain('transfer-in:c1');
    expect(todo).toContain('transfer-out:c1');
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

  // A ride you buy at the machine is sorted once you know which ride it is —
  // but it is not booked, and the card says so rather than implying a ticket.
  // Picking "Coach" from a list is choosing how to travel, not holding a
  // ticket. Before this, it quietly moved the ride into "already sorted" — and
  // a coach you never booked is a flight you miss.
  it('does not take knowing how as having sorted it', () => {
    const t = trip({
      outbound: { ...trip().outbound, transport: 'National Express', journeyMin: 75 },
    });
    const uk = tripNeeds(t, [leg()], [], [], NOW).find((n) => n.key === 'transfer-uk:out')!;
    expect(uk.state).toBe('planned');
    expect(uk.done).toBe(false);
    expect(uk.detail).toBe('National Express, 75 min — not booked yet');
  });

  it('settles a ride you buy on the day, once you say that is what it is', () => {
    const t = trip({
      outbound: {
        ...trip().outbound,
        transport: 'National Express',
        journeyMin: 75,
        payOnDay: true,
      },
    });
    const uk = tripNeeds(t, [leg()], [], [], NOW).find((n) => n.key === 'transfer-uk:out')!;
    expect(uk.done).toBe(true);
    expect(uk.state).toBe('planned');
    expect(uk.detail).toBe('National Express, 75 min — you pay on the day');
    expect(uk.evidence).toBe('National Express, 75 min — pay on the day');
  });

  // Nobody books a walk or the metro, so saying so twice is friction.
  it('takes a walk or the metro as needing no booking at all', () => {
    const city = tripNeeds(
      trip(),
      [leg({ exit: { hub: 'FAO', transport: 'Metro', journeyMin: 20 } })],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-out:c1')!;
    expect(city.done).toBe(true);
  });

  it.each(['Taxi', 'Uber', 'Cab'])(
    '%s needs an explicit booking or pay-on-day decision',
    (transport) => {
      const needs = (extra = {}) =>
        tripNeeds(
          trip(),
          [leg({ exit: { transport, journeyMin: 30, ...extra } })],
          [],
          [],
          NOW,
        ).find((n) => n.key === 'transfer-out:c1')!;
      expect(needs()).toMatchObject({ state: 'planned', done: false });
      expect(needs({ payOnDay: false }).done).toBe(false);
      expect(needs({ payOnDay: true }).done).toBe(true);
      expect(needs({ transferRef: 'PREBOOKED' })).toMatchObject({ state: 'booked', done: true });
    },
  );

  it('labels the original quote basis even after the party changes', () => {
    const row = expense({
      skeleton: true,
      amountGBP: 0,
      need: 'flight:outbound',
      quote: { amountGBP: 80, note: '£40 each × 2, as quoted' },
    });
    const need = tripNeeds(trip({ partySize: 3 }), [leg()], [row], [], NOW).find(
      (n) => n.key === 'flight:outbound',
    )!;
    expect(need.detail).toContain('historical quote £80 (£40 each × 2, as quoted)');
    expect(need.state).toBe('open');
  });

  // A booked coach has a timetable on the ticket, and the leave-by time should
  // count back from it rather than from a journey length nobody measured.
  it('reads the booked ride’s own clock times', () => {
    const uk = tripNeeds(
      trip({
        outbound: {
          ...trip().outbound,
          transport: 'National Express',
          transferAt: '04:35',
          transferArr: '05:50',
          transferRef: 'NX7788',
        },
      }),
      [leg()],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-uk:out')!;
    expect(uk.state).toBe('booked');
    expect(uk.detail).toContain('the 04:35, in at 05:50');
    expect(uk.evidence).toContain('booking NX7788');
  });

  // The bug this replaces: a coach reference written where the flight's lives
  // meant booking the £22 transfer marked the flight home as booked too.
  it('never reads a transfer’s reference as the flight’s, or the other way round', () => {
    const coach = tripNeeds(
      trip(),
      [leg({ exit: { hub: 'FAO', transferRef: 'NX7788' } })],
      [],
      [],
      NOW,
    );
    expect(coach.find((n) => n.key === 'transfer-out:c1')?.state).toBe('booked');
    expect(coach.find((n) => n.key === 'flight:inbound')?.done).toBe(false);
    const flight = tripNeeds(trip(), [leg({ exit: { hub: 'FAO', ref: 'ZZ99' } })], [], [], NOW);
    expect(flight.find((n) => n.key === 'flight:inbound')?.state).toBe('booked');
    expect(flight.find((n) => n.key === 'transfer-out:c1')?.done).toBe(false);
  });

  // An older version wrote a transfer's reference into the flight's slot. The
  // payment it was recorded against says which it really is, so a booked coach
  // stops reading as a booked flight home — on data already on the phone.
  it('reads a reference an older version put in the flight’s slot as the coach’s', () => {
    const needs = tripNeeds(
      trip(),
      [leg({ exit: { hub: 'FAO', ref: 'NX7788' } })],
      [
        expense({
          need: 'transfer:c1',
          amountGBP: 9,
          subcategory: 'Airport Transfer (Abroad)',
          notes: 'Booking NX7788',
        }),
      ],
      [],
      NOW,
    );
    expect(needs.find((n) => n.key === 'flight:inbound')?.done).toBe(false);
    expect(needs.find((n) => n.key === 'transfer-out:c1')?.state).toBe('paid');
  });

  it('names the airport you get home from, where the option said which', () => {
    const t = trip({ homeward: { hub: 'LGW' } });
    expect(
      tripNeeds(t, [leg()], [], [], NOW).find((n) => n.key === 'transfer-uk:back')?.label,
    ).toBe('Getting home from LGW');
  });

  // A hotel named in the research is a choice; a room is held or it is not.
  it('does not call a chosen hotel a booked one', () => {
    const chosen = tripNeeds(trip(), [leg({ base: { name: 'Hotel Faro' } })], [], [], NOW).find(
      (n) => n.key === 'hotel:c1',
    )!;
    expect(chosen.done).toBe(false);
    expect(chosen.detail).toBe('Hotel Faro — chosen, not booked');
    const held = tripNeeds(
      trip(),
      [leg({ base: { name: 'Hotel Faro', bookingRef: 'HB-991' } })],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'hotel:c1')!;
    expect(held.done).toBe(true);
    expect(held.evidence).toBe('Booking HB-991');
  });

  // Booked before the two directions were told apart: the payment it recorded
  // was the way out, and it still settles that one.
  it('keeps a transfer paid for under the old single key', () => {
    const needs = tripNeeds(
      trip(),
      [leg()],
      [expense({ need: 'transfer:c1', amountGBP: 9, subcategory: 'Airport Transfer (Abroad)' })],
      [],
      NOW,
    );
    expect(needs.find((n) => n.key === 'transfer-out:c1')?.state).toBe('paid');
    expect(needs.find((n) => n.key === 'transfer-in:c1')?.done).toBe(false);
  });

  // A £9 return bus ticket is a ticket for the way back too. The two journeys
  // keep their own lines, but only one of them holds the money — and before
  // this the other read as merely planned once a plain mode stopped settling.
  it('counts the other direction as held when one return ticket covers it', () => {
    const back = tripNeeds(
      trip(),
      [
        leg({
          entry: { transport: 'Próximo bus', journeyMin: 20 },
          exit: {
            hub: 'FAO',
            transport: 'Próximo bus',
            journeyMin: 20,
            coveredBy: 'transfer-in:c1',
          },
        }),
      ],
      [expense({ need: 'transfer-in:c1', amountGBP: 9 })],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-out:c1')!;
    expect(back.state).toBe('booked');
    expect(back.done).toBe(true);
    expect(back.evidence).toContain('on the same return ticket');
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

  // Some reservations cost nothing — a free timed entry, a slot at a library.
  // The ledger only records what was paid, so it can never answer for those;
  // before this they stayed outstanding until the trip was over.
  it('takes a reservation that cost nothing as booked', () => {
    const free = tripNeeds(
      trip(),
      [leg()],
      [],
      [stop({ bookAhead: 'Free timed entry, book ahead', booked: true })],
      NOW,
    ).find((n) => n.key === 'book:s1')!;
    expect(free.done).toBe(true);
    expect(free.evidence).toBe('Reserved');
    const withRef = tripNeeds(
      trip(),
      [leg()],
      [],
      [stop({ bookAhead: 'x', bookingRef: 'MU-4412' })],
      NOW,
    ).find((n) => n.key === 'book:s1')!;
    expect(withRef.evidence).toBe('Booking MU-4412');
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
      outbound: {
        ...trip().outbound,
        ref: 'XY12AB',
        transport: 'National Express',
        journeyMin: 75,
        payOnDay: true,
      },
    });
    const legs = [
      leg({
        entry: { transport: 'Próximo bus', journeyMin: 20, payOnDay: true },
        exit: {
          hub: 'FAO',
          ref: 'ZZ99',
          transport: 'Próximo bus',
          journeyMin: 20,
          payOnDay: true,
        },
        base: { name: 'Hotel Faro', bookingRef: 'HB-991' },
      }),
    ];
    const paid = [expense({ need: 'transfer-uk:back', amountGBP: 22 })];
    expect(outstanding(tripNeeds(t, legs, paid, [], NOW))).toEqual([]);
  });

  // Rows captured before the stamp existed, or typed by hand into Expenses:
  // a flight already paid for must not be asked for again.
  it('reads an unstamped payment with the seeded description as that need met', () => {
    const old = [
      expense({ id: 'o1', description: 'Outbound flight', amountGBP: 57.6 }),
      expense({ id: 'o2', description: 'Inbound flight', amountGBP: 85 }),
    ];
    const needs = tripNeeds(trip(), [leg()], old, [], NOW);
    expect(needs.find((n) => n.key === 'flight:outbound')?.done).toBe(true);
    expect(needs.find((n) => n.key === 'flight:inbound')?.done).toBe(true);
  });

  it('does not let one unstamped row settle a different need', () => {
    const old = [expense({ description: 'Groceries', category: 'Food', amountGBP: 12 })];
    const needs = tripNeeds(trip(), [leg()], old, [], NOW);
    expect(needs.find((n) => n.key === 'flight:outbound')?.done).toBe(false);
  });

  it('says nothing at all for a trip with no legs yet', () => {
    const needs = tripNeeds(trip({ outbound: undefined }), [], [], [], NOW);
    expect(keys(needs)).not.toContain('transfer:c1');
    expect(keys(needs)).toContain('plan');
  });

  // A trip can sit in Planning long after it happened. Asking someone to book
  // a flight they have already taken is worse than saying nothing.
  it('knows a trip is over once every departure is behind us', () => {
    const after = Date.parse('2027-01-01T09:00:00Z');
    expect(tripIsOver(trip(), [leg()], after)).toBe(true);
    expect(tripIsOver(trip(), [leg()], NOW)).toBe(false);
    // No times at all: nothing says it is over, so nothing is assumed.
    expect(tripIsOver(trip({ outbound: undefined }), [leg({ departure: undefined })], after)).toBe(
      false,
    );
  });
});

describe('payment and journey evidence', () => {
  it.each([
    { payOnDay: true },
    { payOnDay: true, journeyMin: 30 },
    { payOnDay: true, transport: 'Coach' },
    { payOnDay: true, transport: 'Coach', journeyMin: 0 },
    { payOnDay: true, transport: 'Coach', transferAt: '05:10' },
  ])('keeps an incomplete pay-on-day ride outstanding: %j', (plan) => {
    const need = tripNeeds(
      trip({ outbound: { ...trip().outbound, ...plan } }),
      [leg()],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-uk:out')!;
    expect(need.done).toBe(false);
  });

  // Nobody books a walk, so asking for a booking is asking for the impossible:
  // what is missing is the duration leave-by counts back from.
  it('asks an unbookable ride for its duration, not for a booking', () => {
    const need = tripNeeds(
      trip({ outbound: { ...trip().outbound, transport: 'Walk' } }),
      [leg()],
      [],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-uk:out')!;
    expect(need.done).toBe(false);
    expect(need.detail).toBe('Walk — add how long it takes');
    expect(need.evidence).toBe('Walk — add how long it takes');
  });

  it('counts a pending foreign-currency payment as paid without inventing GBP', () => {
    const need = tripNeeds(
      trip(),
      [leg()],
      [
        expense({
          need: 'transfer-in:c1',
          amountGBP: 0,
          amountLocal: 12,
          currency: 'EUR',
          fxPending: true,
        }),
      ],
      [],
      NOW,
    ).find((n) => n.key === 'transfer-in:c1')!;
    expect(need.state).toBe('paid');
    expect(need.evidence).toBe('Paid — GBP amount pending');
  });

  it('reopens return coverage when its only payment disappears but preserves a reservation', () => {
    const city = leg({ entry: { transport: 'Bus' }, exit: { coveredBy: 'transfer-in:c1' } });
    const payment = expense({ need: 'transfer-in:c1' });
    const done = (c: City, es: Expense[]) =>
      tripNeeds(trip(), [c], es, [], NOW).find((n) => n.key === 'transfer-out:c1')!.done;
    expect(done(city, [payment])).toBe(true);
    expect(done(city, [])).toBe(false);
    expect(done({ ...city, entry: { ...city.entry, transferRef: 'RETURN' } }, [])).toBe(true);
  });
});

it('does not infer a booking from an explicitly detached payment’s old description', () => {
  const row = expense({ need: '' });
  expect(
    tripNeeds(trip(), [leg()], [row], [], NOW).find((n) => n.key === 'flight:outbound')!.state,
  ).toBe('open');
  const legacy = { ...row };
  delete legacy.need;
  expect(
    tripNeeds(trip(), [leg()], [legacy], [], NOW).find((n) => n.key === 'flight:outbound')!.state,
  ).toBe('paid');
});
