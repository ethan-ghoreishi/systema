import { describe, it, expect } from 'vitest';
import {
  compareCities,
  dataQuality,
  hotelNightCost,
  transitRows,
  tripRhythm,
  ukTransferByAirport,
} from '../../src/lib/insights';
import type { City, Expense, Stop, Trip } from '../../src/lib/db';

function trip(over: Partial<Trip>): Trip {
  return {
    id: 't',
    name: '',
    type: 'custom',
    startDate: '',
    endDate: '',
    partySize: 2,
    returnFlightAt: '',
    accommodation: false,
    status: 'done',
    planText: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

let seq = 0;
function exp(over: Partial<Expense>): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    tripId: 't',
    cityId: null,
    date: '2024-10-01',
    destination: 'Vienna',
    category: 'Food',
    subcategory: 'Snacks',
    description: '',
    paymentMethod: '',
    amountGBP: 0,
    amountLocal: 0,
    notes: '',
    currency: 'EUR',
    fxRate: null,
    skeleton: false,
    order: seq,
    createdAt: 0,
    ...over,
  };
}

const city = (over: Partial<City>): City => ({
  id: 'c',
  tripId: 't',
  name: 'Vienna',
  currency: 'EUR',
  order: 0,
  ...over,
});

describe('compareCities', () => {
  // Two-city trip with leg times, plus an imported single-city trip without.
  const trips = [
    trip({ id: 'x', partySize: 2 }),
    trip({ id: 'v', startDate: '2024-10-01', endDate: '2024-10-03' }),
  ];
  const cities = [
    city({
      id: 'blq',
      tripId: 'x',
      name: 'Bologna',
      order: 0,
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T21:00',
      tz: 'Europe/Rome',
    }),
    city({
      id: 'bcn',
      tripId: 'x',
      name: 'Barcelona',
      order: 1,
      arrival: '2026-10-16T22:00',
      departure: '2026-10-17T22:00',
      tz: 'Europe/Madrid',
    }),
    city({ id: 'vie', tripId: 'v', name: 'Vienna' }),
  ];
  const expenses = [
    exp({ tripId: 'x', cityId: 'blq', destination: 'Bologna', amountGBP: 30 }), // half a day
    exp({ tripId: 'x', destination: 'Barcelona', amountGBP: 40 }), // linked by name
    exp({
      tripId: 'x',
      destination: 'Bologna/Barcelona',
      category: 'Transportation',
      subcategory: 'Flight',
      amountGBP: 200,
    }),
    exp({ tripId: 'v', destination: 'Vienna', amountGBP: 90 }),
    exp({
      tripId: 'x',
      cityId: 'bcn',
      category: 'Transportation',
      subcategory: 'Airport Transfer (Abroad)',
      description: 'Aerobús',
      amountGBP: 12,
    }),
  ];

  it('uses real leg time and never splits shared spend into cities', () => {
    const { rows } = compareCities(trips, cities, expenses, [], 'perDay');
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Bologna.value).toBe(60); // £30 over 12 hours
    expect(byName.Barcelona.value).toBe(52); // (£40 + £12) over 24 hours; the £200 flight isn't in it
    expect(byName.Vienna).toMatchObject({ value: 30, approximate: true, thin: true }); // 3 calendar days
  });

  it('names the cities it has no data for, and ranks without calling one best', () => {
    const r = compareCities(trips, cities, expenses, [], 'transferPP');
    expect(r.rows).toEqual([
      { name: 'Barcelona', value: 6, visits: 1, days: 1, thin: true, approximate: false },
    ]);
    expect(r.missing).toEqual(['Bologna', 'Vienna']);
  });

  it('discloses what the numbers rest on', () => {
    const q = dataQuality(trips, cities, [
      ...expenses,
      exp({ tripId: 'v', destination: 'Graz', amountGBP: 5 }),
    ]);
    expect(q.shared).toEqual({ count: 1, total: 200 });
    expect(q.unlinked).toEqual({ count: 1, total: 5 });
    expect(q.legsTimed).toBe(2);
    expect(q.legs).toBe(3);
  });

  it('reports airport transfers per person with the plan beside them', () => {
    const withPlan = cities.map((c) =>
      c.id === 'bcn'
        ? { ...c, exit: { transport: 'Aerobús', journeyMin: 35, notes: 'Buy at the stop' } }
        : c,
    );
    expect(transitRows(trips, withPlan, expenses)).toEqual([
      expect.objectContaining({
        city: 'Barcelona',
        mode: 'Aerobús',
        costPP: 6,
        journeyMin: 35,
        notes: 'Buy at the stop',
      }),
    ]);
  });

  it('reads a trip rhythm: planned against visited, off-plan, rides, slack', () => {
    const stops: Stop[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      tripId: 'x',
      cityId: 'blq',
      name: id,
      notes: '',
      checklist: [],
      visited: i < 2,
      order: i,
      createdAt: 0,
    }));
    const rides = [
      exp({
        tripId: 'x',
        category: 'Transportation',
        subcategory: 'Local Transport (Abroad)',
        amountGBP: 2,
      }),
    ];
    const [r] = tripRhythm(trips, cities, [...expenses, ...rides], stops, [
      {
        id: 'm',
        tripId: 'x',
        cityId: 'blq',
        title: 'Concert',
        note: '',
        at: 1,
        stopId: null,
        createdAt: 1,
      },
      // Part of a planned stop: it happened inside the plan, not off it.
      {
        id: 'm2',
        tripId: 'x',
        cityId: 'blq',
        title: 'The guide stopped mid-sentence',
        note: '',
        at: 2,
        stopId: 'a',
        createdAt: 2,
      },
    ]);
    expect(r).toMatchObject({
      planned: 3,
      visited: 2,
      offPlan: 1,
      rides: 1,
      departures: 2,
      slackMin: 105,
    });
  });
});

// The question the traveller has re-answered by hand on every trip: what does
// getting to Stansted cost? No historic trip carries a structured departure,
// so the airport is read from the transfer's own description — exactly as the
// ledger writes it.
describe('what the London airports have cost', () => {
  const trips = [trip({ id: 'a', partySize: 2 }), trip({ id: 'b', partySize: 2 })];
  const rows = [
    exp({
      tripId: 'a',
      subcategory: 'Airport Transfer (UK)',
      description: 'London to Stansted Airport Bus Tickets (Return)',
      amountGBP: 25.16,
    }),
    exp({
      tripId: 'a',
      subcategory: 'Airport Transfer (UK)',
      description: 'Stansted Airport to London Bus Tickets',
      amountGBP: 11.9,
    }),
    exp({
      tripId: 'b',
      subcategory: 'Airport Transfer (UK)',
      description: 'London to Gatwick Airport Train Tickets',
      amountGBP: 21.4,
    }),
    // Names no airport: left out rather than attributed to a guess.
    exp({
      tripId: 'b',
      subcategory: 'Airport Transfer (UK)',
      description: 'Home to Baker Street Station Underground Tickets',
      amountGBP: 5.8,
    }),
  ];

  it('halves a return, divides by the party, and keeps the airport apart', () => {
    const by = ukTransferByAirport(trips, rows);
    // £25.16 return for two = £6.29 each one way; £11.90 one way for two = £5.95.
    expect(by.STN).toMatchObject({ perPerson: 6.12, samples: 2, low: 5.95, high: 6.29 });
    expect(by.LGW).toMatchObject({ perPerson: 10.7, samples: 1 });
    expect(Object.keys(by).sort()).toEqual(['LGW', 'STN']);
  });

  it('uses the departure airport on the trip when the row names none', () => {
    const by = ukTransferByAirport(
      [trip({ id: 'c', partySize: 2, outbound: { hub: 'LTN' } })],
      [
        exp({
          tripId: 'c',
          subcategory: 'Airport Transfer (UK)',
          description: 'Coach to the airport',
          amountGBP: 20.4,
        }),
      ],
    );
    expect(by.LTN?.perPerson).toBe(10.2);
  });

  it('takes the middle, so a voucher or a taxi does not become the usual fare', () => {
    const by = ukTransferByAirport(
      [trip({ id: 'd', partySize: 2 })],
      [7.2, 24.6, 25.16].map((amountGBP) =>
        exp({
          tripId: 'd',
          subcategory: 'Airport Transfer (UK)',
          description: 'London to Luton Airport Train+Shuttle Tickets',
          amountGBP,
        }),
      ),
    );
    expect(by.LTN?.perPerson).toBe(12.3);
  });

  it('has nothing to say with no history, rather than saying zero', () => {
    expect(ukTransferByAirport(trips, [])).toEqual({});
    expect(hotelNightCost(trips, [], [])).toBeNull();
  });
});

describe('what a hotel night has cost', () => {
  it('divides the stay by the nights its legs actually slept', () => {
    const trips = [
      trip({ id: 'h', partySize: 2, accommodation: true }),
      trip({ id: 'i', partySize: 2, accommodation: true }),
    ];
    const legs = [
      city({
        id: 'h1',
        tripId: 'h',
        name: 'Cairo',
        sleep: 'hotel',
        arrival: '2026-01-14T15:00',
        departure: '2026-01-16T18:00',
      }),
      city({ id: 'i1', tripId: 'i', name: 'Fes', sleep: 'hotel' }),
    ];
    const rows = [
      exp({ tripId: 'h', category: 'Accommodation', subcategory: 'Hotel', amountGBP: 43.2 }),
      exp({ tripId: 'i', category: 'Accommodation', subcategory: 'Hotel', amountGBP: 27.4 }),
    ];
    // Cairo: £43.20 over two nights = £21.60; Fes: £27.40 for one.
    expect(hotelNightCost(trips, legs, rows)).toMatchObject({
      perPerson: 24.5,
      samples: 2,
      low: 21.6,
      high: 27.4,
    });
  });
});
