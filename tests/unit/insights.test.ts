import { describe, it, expect } from 'vitest';
import { buildCityInsights } from '../../src/lib/insights';
import type { Expense, Trip } from '../../src/lib/db';

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

describe('buildCityInsights', () => {
  it('ranks cities by total and computes per-day from trip length', () => {
    const trips = [
      trip({ id: 'v', startDate: '2024-10-01', endDate: '2024-10-03' }), // 3 days
      trip({ id: 'p', startDate: '2024-11-01', endDate: '2024-11-01' }), // 1 day
    ];
    const expenses = [
      exp({ tripId: 'v', destination: 'Vienna', amountGBP: 60 }),
      exp({ tripId: 'p', destination: 'Prague', amountGBP: 30 }),
    ];
    const { cities, cheapest, priciest } = buildCityInsights(trips, expenses);

    const vienna = cities.find((c) => c.name === 'Vienna')!;
    const prague = cities.find((c) => c.name === 'Prague')!;
    expect(vienna.total).toBe(60);
    expect(vienna.days).toBe(3);
    expect(vienna.perDay).toBe(20);
    expect(prague.perDay).toBe(30);

    // Best value = lowest per-day; priciest = highest per-day.
    expect(cheapest?.name).toBe('Vienna');
    expect(priciest?.name).toBe('Prague');
  });

  it('splits a combined "A/B" destination evenly and shares the trip days', () => {
    const trips = [trip({ id: 'x', startDate: '2024-10-07', endDate: '2024-10-08' })]; // 2 days
    const expenses = [exp({ tripId: 'x', destination: 'Barcelona/Bologna', amountGBP: 40 })];
    const { cities } = buildCityInsights(trips, expenses);

    const barca = cities.find((c) => c.name === 'Barcelona')!;
    const bologna = cities.find((c) => c.name === 'Bologna')!;
    expect(barca.total).toBe(20);
    expect(bologna.total).toBe(20);
    expect(barca.days).toBe(1); // 2 trip days shared across 2 cities
  });

  it('ignores expenses with no destination', () => {
    const trips = [trip({ id: 't', startDate: '2024-10-01', endDate: '2024-10-01' })];
    const { cities } = buildCityInsights(trips, [exp({ destination: '', amountGBP: 99 })]);
    expect(cities).toHaveLength(0);
  });
});
