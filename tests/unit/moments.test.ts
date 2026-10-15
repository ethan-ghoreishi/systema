import { describe, it, expect } from 'vitest';
import type { City, Moment, Stop } from '../../src/lib/db';
import { visitTimeline } from '../../src/lib/moments';

const city = (id: string, order: number): City => ({
  id,
  tripId: 't',
  name: id,
  currency: 'EUR',
  order,
});
const stop = (id: string, cityId: string, order: number, visitedAt?: number): Stop => ({
  id,
  tripId: 't',
  cityId,
  name: id,
  notes: '',
  checklist: [],
  visited: true,
  visitedAt,
  order,
  createdAt: 0,
});
const moment = (id: string, cityId: string | null, at: number): Moment => ({
  id,
  tripId: 't',
  cityId,
  title: id,
  note: '',
  at,
  stopId: null,
  createdAt: at,
});
const names = (items: ReturnType<typeof visitTimeline>) =>
  items.map((i) => (i.kind === 'stop' ? i.stop.id : `*${i.moment.id}`));

describe('visitTimeline', () => {
  const cities = [city('blq', 0), city('bcn', 1)];

  it('places each moment after the last stop visited before it', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300), stop('c', 'bcn', 2, 500)];
    const moments = [moment('concert', 'blq', 200), moment('missed-bus', 'bcn', 450)];
    expect(names(visitTimeline(stops, moments, cities))).toEqual([
      'a',
      '*concert',
      'b',
      '*missed-bus',
      'c',
    ]);
  });

  it("falls back to the moment's city when stops have no visit times", () => {
    const stops = [stop('a', 'blq', 0), stop('b', 'blq', 1), stop('c', 'bcn', 2)];
    const moments = [moment('courtyard', 'blq', 50), moment('market', 'bcn', 60)];
    expect(names(visitTimeline(stops, moments, cities))).toEqual([
      'a',
      'b',
      '*courtyard',
      'c',
      '*market',
    ]);
  });

  it('leaves out stops not visited', () => {
    const s = { ...stop('skipped', 'blq', 0), visited: false };
    expect(names(visitTimeline([s], [moment('m', 'blq', 1)], cities))).toEqual(['*m']);
  });
});
