import { describe, it, expect } from 'vitest';
import { compareCities, dataQuality, transitRows, tripRhythm } from '../../src/lib/insights';
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
