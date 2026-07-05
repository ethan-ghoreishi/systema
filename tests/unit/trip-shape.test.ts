import { describe, it, expect } from 'vitest';
import type { City, Trip } from '../../src/lib/db';
import {
  tripDisplayName,
  tripDateLabel,
  tripShape,
  tripDays,
  tripHotelNights,
  tripStartIso,
  tripEndIso,
  tripCityNames,
} from '../../src/lib/trip-shape';

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    name: '',
    type: 'custom',
    startDate: '',
    endDate: '',
    partySize: 2,
    returnFlightAt: '',
    accommodation: false,
    status: 'planning',
    planText: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

let seq = 0;
function city(over: Partial<City>): City {
  seq += 1;
  return { id: `c${seq}`, tripId: 't', name: '', currency: 'EUR', order: seq, ...over };
}

describe('tripShape — the real trip archetypes', () => {
  it('same-day dash: one city, out and back the same day, no hotel', () => {
    const t = trip();
    const cities = [
      city({
        name: 'Bruges',
        arrival: '2025-06-14T08:00',
        departure: '2025-06-14T21:30',
        sleep: 'none',
        order: 0,
      }),
    ];
    expect(tripShape(t, cities).label).toBe('same-day dash');
    expect(tripDays(t, cities)).toBe(1);
  });

  it('airport sleep: land in the small hours, doze at the airport, fly out that night', () => {
    const t = trip();
    const cities = [
      city({
        name: 'Larnaca',
        arrival: '2025-03-01T01:00',
        departure: '2025-03-01T23:00',
        sleep: 'airport',
        order: 0,
      }),
    ];
    expect(tripShape(t, cities).label).toBe('airport sleep');
  });

  it('Cairo: arrive Wed afternoon, hotel, fly back Fri night → 2-night city break', () => {
    const t = trip();
    const cities = [
      city({
        name: 'Cairo',
        arrival: '2025-01-15T15:00',
        departure: '2025-01-17T21:45',
        sleep: 'hotel',
        order: 0,
      }),
    ];
    expect(tripShape(t, cities).key).toBe('city-break');
    expect(tripHotelNights(t, cities)).toBe(2);
    expect(tripDays(t, cities)).toBe(3);
  });

  it('Rome → Yerevan: airport doze in Rome, then a hotel night in Yerevan → multi-city break', () => {
    const t = trip();
    const cities = [
      city({
        name: 'Rome',
        arrival: '2025-05-10T01:15',
        departure: '2025-05-10T15:40',
        sleep: 'airport',
        order: 0,
      }),
      city({
        name: 'Yerevan',
        currency: 'AMD',
        arrival: '2025-05-10T22:35',
        departure: '2025-05-11T23:30',
        sleep: 'hotel',
        order: 1,
      }),
    ];
    expect(tripShape(t, cities).key).toBe('multi-city-break');
    expect(tripDisplayName(t, cities)).toBe('Rome → Yerevan');
    expect(tripStartIso(t, cities)).toBe('2025-05-10');
    expect(tripEndIso(t, cities)).toBe('2025-05-11');
  });

  it('Barcelona → Bologna: direct out, indirect return via an overnight in Bologna', () => {
    const t = trip();
    const cities = [
      city({
        name: 'Barcelona',
        arrival: '2024-10-07T10:10',
        departure: '2024-10-07T23:25',
        sleep: 'none',
        order: 0,
      }),
      city({
        name: 'Bologna',
        arrival: '2024-10-08T01:10',
        departure: '2024-10-08T22:35',
        sleep: 'hotel',
        order: 1,
      }),
    ];
    expect(tripShape(t, cities).key).toBe('multi-city-break');
    expect(tripDisplayName(t, cities)).toBe('Barcelona → Bologna');
    expect(tripDateLabel(t, cities)).toBe('Oct 2024');
  });

  it('imported trip: no leg times, falls back to stored dates and city name', () => {
    const t = trip({
      name: 'Bergamo (Sept 2025)',
      type: 'custom',
      startDate: '2025-09-12',
      endDate: '2025-09-12',
    });
    const cities = [city({ name: 'Bergamo', order: 0 })];
    expect(tripDisplayName(t, cities)).toBe('Bergamo');
    expect(tripDateLabel(t, cities)).toBe('Sept 2025'); // en-GB abbreviates September as 'Sept'
    // Single day, no hotel info → same-day dash by fallback.
    expect(tripShape(t, cities).label).toBe('same-day dash');
  });

  it('imported trip with accommodation flag but no leg info → city break', () => {
    const t = trip({
      name: 'Vienna',
      accommodation: true,
      startDate: '2024-11-01',
      endDate: '2024-11-03',
    });
    const cities = [city({ name: 'Vienna', order: 0 })];
    expect(tripShape(t, cities).key).toBe('city-break');
  });
});

describe('naming and labels', () => {
  it('manual override wins over the derived name', () => {
    const t = trip({ nameManual: 'Honeymoon' });
    const cities = [city({ name: 'Rome', order: 0 }), city({ name: 'Florence', order: 1 })];
    expect(tripDisplayName(t, cities)).toBe('Honeymoon');
  });

  it('collapses a repeated return city in the name', () => {
    const t = trip();
    const cities = [
      city({ name: 'Larnaca', order: 0 }),
      city({ name: 'Nicosia', order: 1 }),
      city({ name: 'Larnaca', order: 2 }),
    ];
    expect(tripCityNames(cities)).toEqual(['Larnaca', 'Nicosia', 'Larnaca']);
    expect(tripDisplayName(t, cities)).toBe('Larnaca → Nicosia → Larnaca');
  });

  it('spans months and years in the date label', () => {
    const t = trip();
    const across = [
      city({
        name: 'A',
        arrival: '2024-12-30T10:00',
        departure: '2025-01-02T10:00',
        sleep: 'hotel',
        order: 0,
      }),
    ];
    expect(tripDateLabel(t, across)).toBe('Dec 2024 – Jan 2025');
  });

  it('empty trip name falls back gracefully', () => {
    expect(tripDisplayName(trip(), [])).toBe('New trip');
  });
});
