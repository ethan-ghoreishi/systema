import { describe, it, expect } from 'vitest';
import {
  buildTripPack,
  buildJournalingPrompt,
  photoManifest,
  JOURNAL_PROMPT,
  type PackPhoto,
} from '../../src/lib/export';
import type { City, Expense, Moment, Stop, Trip } from '../../src/lib/db';
import { photoRef } from '../../src/lib/photos';

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    name: 'Copenhagen',
    type: 'weekend',
    startDate: '2026-06-26',
    endDate: '2026-06-28',
    partySize: 2,
    returnFlightAt: '',
    accommodation: true,
    status: 'planning',
    planText: '# Thesis\nTrust designed into surfaces.',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function stop(over: Partial<Stop> = {}): Stop {
  return {
    id: 's',
    tripId: 't',
    cityId: null,
    name: 'Carlsberg',
    notes: 'system reading',
    checklist: [{ id: 'i', text: 'inscription', done: true }],
    visited: true,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e',
    tripId: 't',
    cityId: null,
    date: '',
    destination: '',
    category: 'Food',
    subcategory: 'Snacks',
    description: '',
    paymentMethod: '',
    amountGBP: 5,
    amountLocal: 0,
    notes: '',
    currency: 'GBP',
    fxRate: null,
    skeleton: false,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

describe('buildTripPack', () => {
  const twoPhotos: PackPhoto[] = [
    { id: 'p1aaaa00-0000', stopId: 's', kind: 'stop', createdAt: Date.UTC(2026, 5, 27, 14, 32) },
    { id: 'p2bbbb00-0000', stopId: 's', kind: 'stop', createdAt: Date.UTC(2026, 5, 27, 15, 10) },
  ];
  const pack = (over: Partial<Parameters<typeof buildTripPack>[0]> = {}) =>
    buildTripPack({
      trip: trip(),
      cities: [],
      stops: [stop()],
      expenses: [exp()],
      photos: twoPhotos,
      ...over,
    });

  it('includes title, plan, ticked stops with notes, photos and expense total', () => {
    const md = pack();
    expect(md).toContain('# Trip pack: Copenhagen');
    expect(md).toContain('## Plan');
    expect(md).toContain('Trust designed into surfaces.');
    expect(md).toContain('### Carlsberg (visited)');
    expect(md).toContain('- [x] inscription');
    expect(md).toContain('system reading');
    expect(md).toContain(`_2 photos: ${photoRef('p1aaaa00-0000')}, ${photoRef('p2bbbb00-0000')}_`);
    expect(md).toContain('## Photos (attached in this order)');
    expect(md).toContain(`1. [photo: ${photoRef('p1aaaa00-0000')}] Carlsberg,`);
    expect(md).toContain('**Total:** £5.00');
    expect(md).toContain('- Food: £5.00');
  });

  it('omits empty sections', () => {
    const md = pack({ trip: trip({ planText: '' }), stops: [], expenses: [], photos: [] });
    expect(md).not.toContain('## Plan');
    expect(md).not.toContain('## Stops');
    expect(md).not.toContain('## Photos');
    expect(md).not.toContain('## Expenses');
    expect(md).not.toContain('## Unplanned');
  });

  it('weaves off-plan moments into the visit order, with their own photos', () => {
    const cities: City[] = [
      {
        id: 'c',
        tripId: 't',
        name: 'Copenhagen',
        currency: 'DKK',
        order: 0,
        tz: 'Europe/Copenhagen',
      },
    ];
    const moments: Moment[] = [
      {
        id: 'm',
        tripId: 't',
        cityId: 'c',
        title: 'Harbour swim',
        note: 'strangers sharing the ladder',
        at: Date.UTC(2026, 5, 27, 12, 0),
        stopId: null,
        createdAt: 0,
      },
    ];
    const md = pack({
      cities,
      stops: [stop({ cityId: 'c', visitedAt: Date.UTC(2026, 5, 27, 10, 0) })],
      moments,
      photos: [
        ...twoPhotos,
        {
          id: 'm1cccc00-0000',
          stopId: null,
          momentId: 'm',
          kind: 'stop',
          createdAt: Date.UTC(2026, 5, 27, 12, 5),
        },
      ],
    });
    expect(md).toContain('## Visit order');
    expect(md).toContain('1. Sat 27 Jun, 12:00, Carlsberg (Copenhagen)');
    expect(md).toContain('2. Sat 27 Jun, 14:00, off-plan: Harbour swim (Copenhagen)');
    expect(md).toContain('## Unplanned / serendipitous moments (in visit order)');
    expect(md).toContain(
      `- Sat 27 Jun, 14:00, Copenhagen: **Harbour swim**. strangers sharing the ladder [photos: ${photoRef('m1cccc00-0000')}]`,
    );
    // The moment's photo is in the manifest under the moment, not the stop.
    expect(md).toContain(`[photo: ${photoRef('m1cccc00-0000')}] Copenhagen, Harbour swim,`);
  });

  it('does not use em-dashes', () => {
    expect(pack()).not.toContain('—');
  });
});

describe('photoManifest', () => {
  it('numbers photos in the order they were taken, leaving receipts out', () => {
    const m = photoManifest(
      [
        { id: 'late', stopId: null, kind: 'stop', createdAt: 1, takenAt: 300 },
        { id: 'early', stopId: null, kind: 'stop', createdAt: 2, takenAt: 100 },
        { id: 'receipt', stopId: null, kind: 'receipt', createdAt: 0 },
      ],
      [],
      [],
      [],
    );
    expect(m.map((e) => [e.n, e.id])).toEqual([
      [1, 'early'],
      [2, 'late'],
    ]);
  });
});

describe('buildJournalingPrompt', () => {
  it('prefixes the prompt and appends the pack', () => {
    const p = buildJournalingPrompt('PACK_BODY');
    expect(p.startsWith(JOURNAL_PROMPT)).toBe(true);
    expect(p).toContain('PACK_BODY');
    expect(p).not.toContain('—');
  });
});
