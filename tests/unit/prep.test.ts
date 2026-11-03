import { describe, it, expect } from 'vitest';
import { ownPrepSuggestions, prepIsDue, prepItems } from '../../src/lib/prep';
import type { City, Trip } from '../../src/lib/db';

// The note this replaces was the last trip's list every time. The test that
// matters is that two trips of different shapes get different lists.

const NOW = Date.parse('2026-12-10T09:00:00Z');

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: '',
    type: 'weekend',
    startDate: '2026-12-11',
    endDate: '2026-12-12',
    partySize: 2,
    returnFlightAt: '',
    accommodation: true,
    status: 'planning',
    planText: '',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    outbound: { at: '2026-12-11T06:00', tz: 'Europe/London', hub: 'STN' },
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
    ...over,
  };
}

const keys = (t: Trip, c: City[]) => prepItems(t, c).map((i) => i.key);

describe('getting yourself ready', () => {
  it('feeds and packs a same-day dash nothing like a city break', () => {
    const dash = keys(trip({ accommodation: false }), [
      leg({ sleep: 'none', departure: '2026-12-11T21:00' }),
    ]);
    expect(dash).toContain('pack:day');
    expect(dash).toContain('food:take');
    expect(dash).not.toContain('pack:nights');
    expect(dash).not.toContain('home:leaving');

    const breakAway = keys(trip(), [leg()]);
    expect(breakAway).toContain('pack:nights');
    expect(breakAway).not.toContain('pack:day');
  });

  it('gives a night at the airport what only that night needs', () => {
    const k = keys(trip({ accommodation: false }), [leg({ sleep: 'airport' })]);
    expect(k).toContain('pack:airport-night');
    expect(k).toContain('food:make');
    expect(
      prepItems(trip({ accommodation: false }), [leg({ sleep: 'airport' })]).find(
        (i) => i.key === 'devices:charge',
      )?.label,
    ).toContain('battery pack');
  });

  it('tells a multi-city break to pack one bag that moves', () => {
    const items = prepItems(trip(), [leg(), leg({ id: 'c2', name: 'Seville', order: 1 })]);
    expect(items.find((i) => i.key === 'pack:nights')?.because).toContain('repack');
  });

  // Buy it, make it, take it — in that order, and only where the step before
  // it is a step this trip has.
  it('keeps the food in order, and lets a lone step stand alone', () => {
    const early = prepItems(trip(), [leg()]);
    expect(early.find((i) => i.key === 'food:take')?.after).toBe('food:make');
    expect(early.find((i) => i.key === 'food:make')?.after).toBe('food:buy');
    // A midday departure buys and takes, but has no night-before step.
    const later = prepItems(
      trip({ outbound: { at: '2026-12-11T13:00', tz: 'Europe/London' }, accommodation: false }),
      [leg({ sleep: 'none', departure: '2026-12-11T21:00' })],
    );
    expect(later.find((i) => i.key === 'food:make')).toBeUndefined();
    expect(later.find((i) => i.key === 'food:take')?.after).toBeUndefined();
  });

  // The standing items the real note carried every time, and the ones it only
  // carried when the trip called for them.
  it('keeps the standing items and earns the rest', () => {
    const k = keys(trip(), [leg()]);
    expect(k).toContain('devices:camera');
    expect(k).toContain('papers:pills');
    expect(k).toContain('papers:cards');
    expect(keys(trip(), [leg({ currency: 'GBP' })])).not.toContain('papers:cards');
  });

  it('says why each line is here, in this trip’s own facts', () => {
    const items = prepItems(trip(), [leg()]);
    expect(items.find((i) => i.key === 'food:buy')?.because).toContain('03:30');
    expect(items.every((i) => i.because.length > 0)).toBe(true);
  });

  it('takes a tick from the trip, and anything added by hand', () => {
    const t = trip({ prep: { done: ['food:buy'], extra: ['Pick up the parcel'] } });
    const items = prepItems(t, [leg()]);
    expect(items.find((i) => i.key === 'food:buy')?.done).toBe(true);
    expect(items.find((i) => i.own)?.label).toBe('Pick up the parcel');
  });

  // Everything you added landed under "The flat", whatever it was about — the
  // one section it almost never belonged in.
  it('puts a line of your own in the section you filed it under', () => {
    const t = trip({
      prep: {
        extra: ['Defrost the chicken', 'Pick up the parcel'],
        groups: { 'Defrost the chicken': 'food' },
      },
    });
    const items = prepItems(t, [leg()]);
    expect(items.find((i) => i.label === 'Defrost the chicken')?.group).toBe('food');
    expect(items.find((i) => i.label === 'Pick up the parcel')?.group).toBe('other');
  });

  // A rule that does not fit this trip is put down, not deleted: change the
  // trip and it is still there to come back.
  it('keeps a line put aside, flagged rather than dropped', () => {
    const t = trip({ prep: { skipped: ['food:buy'] } });
    const items = prepItems(t, [leg()]);
    expect(items.find((i) => i.key === 'food:buy')?.skipped).toBe(true);
    // And the step that followed it no longer waits on something set aside.
    expect(items.find((i) => i.key === 'food:make')?.after).toBeUndefined();
  });

  it('names what a line is waiting for, instead of just dimming it', () => {
    const make = prepItems(trip(), [leg()]).find((i) => i.key === 'food:make')!;
    expect(make.after).toBe('food:buy');
    expect(make.afterLabel).toContain('Buy the food');
  });

  // A standing item is a standing item. Typing it again every trip is the
  // Notes list this is meant to replace.
  it('offers what you added on other trips, and never what is already here', () => {
    const trips = [
      trip({ id: 'a', updatedAt: 10, prep: { extra: ['Water the plants'] } }),
      trip({ id: 'b', updatedAt: 20, prep: { extra: ['Pick up the parcel'] } }),
      trip({ id: 'here', prep: { extra: ['Water the plants'] } }),
    ];
    expect(ownPrepSuggestions(trips, 'here')).toEqual(['Pick up the parcel']);
  });

  // The fridge question is about when you get back, and the trip now knows it.
  it('reads the real landing time at home, not just the last flight out', () => {
    const late = trip({
      homeward: { at: '2026-12-12T23:40', tz: 'Europe/London', hub: 'STN' },
    });
    const item = prepItems(late, [leg()]).find((i) => i.key === 'food:back');
    expect(item?.because).toContain('23:40');
  });

  // Eight lines three months out is clutter; the night before they are the
  // difference between eating on the plane and not.
  it('waits until the trip is close, and goes once it is done', () => {
    expect(prepIsDue(trip(), [leg()], NOW)).toBe(true);
    expect(prepIsDue(trip(), [leg()], Date.parse('2026-10-01T09:00:00Z'))).toBe(false);
    expect(prepIsDue(trip({ status: 'done' }), [leg()], NOW)).toBe(false);
    expect(prepIsDue(trip({ status: 'active' }), [leg()], NOW)).toBe(true);
    expect(prepIsDue(trip({ outbound: undefined }), [leg({ departure: undefined })], NOW)).toBe(
      false,
    );
  });
});
