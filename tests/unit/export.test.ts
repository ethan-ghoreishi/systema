import { describe, it, expect } from 'vitest';
import {
  buildTripPack,
  buildJournalingPrompt,
  photoManifest,
  blankFieldPatch,
  descendsFrom,
  mergeClocks,
  JOURNAL_PROMPT,
  type Backup,
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

describe('blankFieldPatch', () => {
  it('offers only the fields this device left blank, and never identity', () => {
    const existing = {
      id: 'keep',
      tripId: 'trip-1',
      createdAt: 1,
      updatedAt: 2,
      journalText: '',
      planText: 'mine, written here',
      notes: undefined as string | undefined,
      checklist: [] as string[],
      visited: false,
      order: 0,
    };
    const incoming = {
      ...existing,
      id: 'other',
      tripId: 'trip-2',
      createdAt: 9,
      updatedAt: 9,
      journalText: 'reconstructed journal',
      planText: 'the backup plan',
      notes: 'recovered note',
      checklist: ['one'],
      visited: true,
      order: 7,
    };
    expect(blankFieldPatch(existing, incoming)).toEqual({
      journalText: 'reconstructed journal',
      notes: 'recovered note',
      checklist: ['one'],
    });
  });

  it('proposes nothing when the backup itself has nothing to add', () => {
    expect(blankFieldPatch({ journalText: 'here' }, { journalText: '' })).toEqual({});
    expect(blankFieldPatch({ journalText: '' }, { journalText: '' })).toEqual({});
  });
});

describe('descendsFrom', () => {
  const snap = (id: string, history: string[] = []): Backup =>
    ({
      sync: { id, device: 'd', deviceName: 'Phone', at: 1, history },
    }) as unknown as Backup;

  it('recognises the same snapshot and a descendant of it', () => {
    expect(descendsFrom(snap('a'), snap('a'))).toBe(true);
    expect(descendsFrom(snap('a'), snap('c', ['a', 'b']))).toBe(true);
  });

  // Two devices pushing from one snapshot: neither push descends from the
  // other, so neither may be read as having everything the other has.
  it('rejects a sibling snapshot and a lineage-less one', () => {
    expect(descendsFrom(snap('s1', ['s0']), snap('s2', ['s0']))).toBe(false);
    expect(descendsFrom(snap('a'), null)).toBe(false);
    expect(descendsFrom(snap('a'), {} as Backup)).toBe(false);
    expect(descendsFrom({} as Backup, snap('a'))).toBe(false);
  });

  it('accepts the identical object, for a backup with no lineage at all', () => {
    const legacy = {} as Backup;
    expect(descendsFrom(legacy, legacy)).toBe(true);
  });

  // The counters answer the same question as the history list, but for an
  // absence of any length. Saying "yes" wrongly would delete records, so it
  // only ever says yes when every device's count is reached.
  const clocked = (id: string, clock: Record<string, number>): Backup =>
    ({
      sync: { id, device: 'd', deviceName: 'n', at: 1, history: [], clock },
    }) as unknown as Backup;

  it('reads the counters when the history no longer reaches back', () => {
    const away = clocked('old', { phone: 3, mac: 10 });
    expect(descendsFrom(away, clocked('now', { phone: 3, mac: 510 }))).toBe(true);
    expect(descendsFrom(away, clocked('now', { phone: 3, mac: 10 }))).toBe(true);
    // Behind on any one device is not ahead.
    expect(descendsFrom(away, clocked('now', { phone: 2, mac: 999 }))).toBe(false);
    expect(descendsFrom(away, clocked('now', { mac: 999 }))).toBe(false);
    // Siblings: each has work the other has not seen.
    expect(descendsFrom(clocked('s1', { phone: 1 }), clocked('s2', { mac: 1 }))).toBe(false);
  });

  it('will not guess when either side keeps no counters', () => {
    const plain = { sync: { id: 'a', device: 'd', deviceName: 'n', at: 1, history: [] } };
    expect(descendsFrom(clocked('old', { phone: 1 }), plain as unknown as Backup)).toBe(false);
    expect(descendsFrom(plain as unknown as Backup, clocked('new', { phone: 9 }))).toBe(false);
  });

  it('carries every device forward at its highest count', () => {
    expect(mergeClocks({ phone: 2, mac: 1 }, { phone: 1, mac: 7 }, undefined)).toEqual({
      phone: 2,
      mac: 7,
    });
    expect(mergeClocks(undefined)).toEqual({});
    // A snapshot that arrives with nonsense in it cannot raise a count.
    expect(mergeClocks({ phone: 2 }, { phone: NaN, mac: 'x' } as never)).toEqual({ phone: 2 });
  });
});
