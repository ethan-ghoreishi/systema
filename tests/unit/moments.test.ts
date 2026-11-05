import { describe, it, expect } from 'vitest';
import type { City, Moment, Stop } from '../../src/lib/db';
import { alignToStop, stopGroups, visitedPlaces } from '../../src/lib/moments';

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
const moment = (
  id: string,
  cityId: string | null,
  at: number,
  stopId: string | null = null,
): Moment => ({
  id,
  tripId: 't',
  cityId,
  title: id,
  note: '',
  at,
  stopId,
  createdAt: at,
});
const alignedWith = (s: Stop, m: Moment): Moment => {
  alignToStop(m, s);
  return m;
};
describe('visitedPlaces', () => {
  const cities = [city('london-out', 0), city('bcn', 1), city('blq', 2), city('london-home', 3)];

  it('keeps a historical multi-city trip readable without inventing visit order', () => {
    const stops = [
      stop('Bologna square', 'blq', 0),
      stop('Barcelona cathedral', 'bcn', 4),
      stop('London home', 'london-home', 2),
      stop('London outbound', 'london-out', 8),
      stop('Barcelona market', 'bcn', 1),
      { ...stop('Skipped', 'blq', 3), visited: false },
    ];
    const result = visitedPlaces(stops, [...cities].reverse());
    expect(result.timed).toEqual([]);
    expect(result.untimed.map((g) => [g.key, ...g.stops.map((s) => s.id)])).toEqual([
      ['london-out', 'London outbound'],
      ['bcn', 'Barcelona market', 'Barcelona cathedral'],
      ['blq', 'Bologna square'],
      ['london-home', 'London home'],
    ]);
    expect(stops.map((s) => s.order)).toEqual([0, 4, 2, 8, 1, 3]);
  });

  it('orders only timed places by their recorded instants across legs, with stable ties', () => {
    const stops = [
      stop('late', 'bcn', 0, 500),
      stop('b', 'blq', 1, 100),
      stop('a', 'bcn', 2, 100),
      stop('unknown', 'blq', 3),
    ];
    expect(visitedPlaces(stops, cities).timed.map((s) => s.id)).toEqual(['a', 'b', 'late']);
    // A late marking can be corrected or cleared without touching planned order.
    const corrected = stops.map((s) => (s.id === 'late' ? { ...s, visitedAt: 50 } : s));
    expect(visitedPlaces(corrected, cities).timed.map((s) => s.id)).toEqual(['late', 'a', 'b']);
    corrected[0] = { ...corrected[0], visitedAt: undefined };
    expect(visitedPlaces(corrected, cities).timed.map((s) => s.id)).toEqual(['a', 'b']);
    expect(corrected.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('keeps untimed visits from deleted legs and unassigned records', () => {
    const gone = { ...stop('Rome', 'old', 1), cityId: null, legName: 'Rome' };
    const unassigned = { ...stop('No leg', '', 0), cityId: null };
    expect(visitedPlaces([gone, unassigned], cities).untimed.map((g) => g.key)).toEqual([
      'gone:Rome',
      null,
    ]);
  });
});

describe('stopGroups', () => {
  const blq = city('blq', 0);
  const bcn = city('bcn', 1);
  const cities = [blq, bcn];
  const shape = (gs: ReturnType<typeof stopGroups>) =>
    gs.map((g) => [
      g.key,
      ...g.items.map((i) => (i.kind === 'stop' ? i.stop.id : `*${i.moment.id}`)),
    ]);

  // A leg can be returned to: Bologna, Barcelona, Bologna again.
  it('keeps a moment with its stop even in an earlier run of the same leg', () => {
    const stops = [stop('a', 'blq', 0), stop('b', 'bcn', 1), stop('c', 'blq', 2)];
    const linked = moment('at-a', 'blq', 500, 'a');
    const loose = moment('loose', 'blq', 10);
    expect(shape(stopGroups(stops, [linked, loose], cities))).toEqual([
      ['blq', 'a', '*at-a'],
      ['bcn', 'b'],
      ['blq', 'c', '*loose'],
    ]);
  });

  it('keeps linked memories at their place without letting their times move the planned route', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300)];
    const ms = [moment('at-b', 'blq', 150, 'b'), moment('loose', 'blq', 200)];
    expect(shape(stopGroups(stops, ms, cities))).toEqual([['blq', 'a', '*loose', 'b', '*at-b']]);
  });

  // These rules used to be tested through the old shared timeline. The planned
  // list still relies on them, so they keep their checks here.
  it('keeps several memories at one place in time order, and places an orphaned one by time', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300)];
    const ms = [moment('second', 'blq', 400, 'a'), moment('first', 'blq', 150, 'a')];
    expect(shape(stopGroups(stops, ms, cities))).toEqual([['blq', 'a', '*first', '*second', 'b']]);
    const orphan = moment('gone', 'blq', 200, 'deleted-stop');
    expect(shape(stopGroups(stops, [orphan], cities))).toEqual([['blq', 'a', '*gone', 'b']]);
  });

  it('never puts a loose memory between a place and its own, whichever was written first', () => {
    const planned = { ...stop('planned', 'blq', 0), visited: false };
    const at = moment('at-planned', 'blq', 100, 'planned');
    const loose = moment('loose', 'blq', 900);
    expect(shape(stopGroups([planned], [at, loose], cities))).toEqual([
      ['blq', 'planned', '*at-planned', '*loose'],
    ]);
    expect(shape(stopGroups([planned], [loose, at], cities))).toEqual([
      ['blq', 'planned', '*at-planned', '*loose'],
    ]);
  });

  it('gives a leg with moments but no stops a group of its own', () => {
    const stops = [stop('a', 'blq', 0)];
    expect(shape(stopGroups(stops, [moment('market', 'bcn', 5)], cities))).toEqual([
      ['blq', 'a'],
      ['bcn', '*market'],
    ]);
  });

  // What a deleted leg leaves behind groups under the name it kept.
  it('groups what a deleted leg left behind under that leg', () => {
    const gone = { ...stop('rome-stop', 'blq', 0), cityId: null, legName: 'Rome' };
    const stops = [gone, stop('dubai-stop', 'bcn', 1)];
    const m = { ...moment('rain', null, 5), legName: 'Rome' };
    expect(shape(stopGroups(stops, [m], [bcn]))).toEqual([
      ['gone:Rome', 'rome-stop', '*rain'],
      ['bcn', 'dubai-stop'],
    ]);
  });

  it('leaves a record that never had a leg unassigned', () => {
    const loose = { ...stop('nowhere', 'blq', 0), cityId: null };
    expect(shape(stopGroups([loose], [moment('m', null, 1)], cities))).toEqual([
      [null, 'nowhere', '*m'],
    ]);
  });
});

describe('alignToStop', () => {
  it("takes the stop's leg, and no place of its own", () => {
    const m = { ...moment('busker', 'bcn', 10, 'a'), lat: 1, lng: 2 };
    alignToStop(m, stop('a', 'blq', 0));
    expect(m.cityId).toBe('blq');
    expect('lat' in m).toBe(false);
    expect('lng' in m).toBe(false);
  });

  it('never empties the leg a moment has for a stop that is on none', () => {
    const loose = { ...stop('a', '', 0), cityId: null };
    const m = alignedWith(loose, moment('busker', 'bcn', 10, 'a'));
    expect(m.cityId).toBe('bcn');
    // Both off the legs: what the stop kept when its leg was deleted.
    const gone = { ...stop('a', '', 0), cityId: null, tz: 'Europe/Rome', legName: 'Rome' };
    const kept = alignedWith(gone, moment('busker', null, 10, 'a'));
    expect([kept.cityId, kept.tz, kept.legName]).toEqual([null, 'Europe/Rome', 'Rome']);
    // An unvisited stop from that leg kept no zone: the moment's own stands.
    const unvisited = { ...stop('a', '', 0), cityId: null, legName: 'Rome' };
    const own = alignedWith(unvisited, { ...moment('busker', null, 10, 'a'), tz: 'Europe/Rome' });
    expect([own.cityId, own.tz, own.legName]).toEqual([null, 'Europe/Rome', 'Rome']);
  });

  it('leaves a moment that is part of nothing alone', () => {
    const m = { ...moment('busker', 'bcn', 10), lat: 1, lng: 2 };
    alignToStop(m, undefined);
    expect([m.cityId, m.lat, m.lng]).toEqual(['bcn', 1, 2]);
  });
});
