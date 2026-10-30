import { describe, it, expect } from 'vitest';
import type { City, Moment, Stop } from '../../src/lib/db';
import { stopGroups, visitTimeline } from '../../src/lib/moments';

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

  // A moment that is part of a planned stop belongs with that stop, whatever
  // its clock time says — it is the same visit, not a separate event.
  it('puts a moment linked to a stop with that stop', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300), stop('c', 'bcn', 2, 500)];
    const linked = moment('inside-b', 'blq', 900, 'b');
    expect(names(visitTimeline(stops, [linked], cities))).toEqual(['a', 'b', '*inside-b', 'c']);
  });

  it('keeps several moments at one stop in their own time order', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300)];
    const moments = [moment('second', 'blq', 400, 'a'), moment('first', 'blq', 150, 'a')];
    expect(names(visitTimeline(stops, moments, cities))).toEqual(['a', '*first', '*second', 'b']);
  });

  // A moment at its stop is out of time order by design; it must not drag a
  // later unlinked one along with it.
  it('does not let a moment at a stop displace a later one', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300)];
    const moments = [moment('at-b', 'blq', 150, 'b'), moment('loose', 'blq', 200)];
    expect(names(visitTimeline(stops, moments, cities))).toEqual(['a', '*loose', 'b', '*at-b']);
  });

  it('falls back to time when the linked stop is not in the list', () => {
    const stops = [stop('a', 'blq', 0, 100), stop('b', 'blq', 1, 300)];
    const orphan = moment('gone', 'blq', 200, 'deleted-stop');
    expect(names(visitTimeline(stops, [orphan], cities))).toEqual(['a', '*gone', 'b']);
  });

  // The Stops list orders by the same rule, but shows what is not ticked yet.
  it('keeps unvisited stops when asked (the Stops list)', () => {
    const stops = [
      { ...stop('a', 'blq', 0, 100) },
      { ...stop('planned', 'blq', 1), visited: false },
    ];
    const moments = [moment('linked', 'blq', 50, 'planned'), moment('loose', 'blq', 900)];
    // 'loose' follows the last stop with a visit time; 'planned' has none, so
    // it anchors nothing — only the moment that is part of it.
    expect(names(visitTimeline(stops, moments, cities, { visitedOnly: false }))).toEqual([
      'a',
      '*loose',
      'planned',
      '*linked',
    ]);
    // The pack keeps only visited stops, so the linked one falls back to time.
    expect(names(visitTimeline(stops, moments, cities))).toEqual(['*linked', 'a', '*loose']);
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
