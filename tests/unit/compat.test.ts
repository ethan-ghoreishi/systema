import { describe, it, expect } from 'vitest';
import { validateBackup } from '../../src/lib/backup-validation';
import { mergeRecords, type SyncRecords } from '../../src/lib/sync';
import { validateBackup as oldValidate } from './fixtures/old-backup-validation';
import { mergeRecords as oldMerge } from './fixtures/old-sync';
import { BACKUP_JSON, readBackupFile, type Backup } from '../../src/lib/export';
import { revisedStop } from '../../src/lib/plan-revision';
import { extractStopsFromPlan } from '../../src/lib/stops';
import { zip } from '../../src/lib/zip';
import type { Stop } from '../../src/lib/db';

// An iPhone can run the previous version for days (updates wait for Home).
// Everything this version writes must still be readable and mergeable there.

function snapshot(): Backup {
  return {
    app: 'systema',
    version: 1,
    exportedAt: '2026-10-14T10:00:00.000Z',
    trips: [
      {
        id: 't1',
        name: '',
        type: 'weekend',
        preset: 'two-city',
        startDate: '2026-10-16',
        endDate: '2026-10-17',
        partySize: 2,
        returnFlightAt: '2026-10-17T21:00',
        accommodation: true,
        status: 'planning',
        planText: '',
        outbound: {
          at: '2026-10-16T06:10',
          tz: 'Europe/London',
          hub: 'LGW',
          journeyMin: 70,
          checkedIn: true,
        },
        opportunityId: 'opp1',
        optionId: 'opt1',
        homeward: {
          at: '2026-10-17T22:30',
          tz: 'Europe/London',
          hub: 'LGW',
          transport: 'National Express',
          journeyMin: 70,
          transferRef: 'NX-7788',
          payOnDay: true,
        },
        prep: {
          done: ['charge:devices'],
          extra: ['Water the plants'],
          skipped: ['food:back'],
          groups: { 'Water the plants': 'home' },
        },
        order: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    cities: [
      {
        id: 'c1',
        tripId: 't1',
        name: 'Bologna',
        currency: 'EUR',
        order: 0,
        arrival: '2026-10-16T09:00',
        departure: '2026-10-16T19:00',
        sleep: 'none',
        tz: 'Europe/Rome',
        base: { name: 'Left luggage, Centrale', lat: 44.5, lng: 11.3, bookingRef: 'HB-991' },
        entry: { transport: 'Marconi Express', journeyMin: 20, transferRef: 'ME-5' },

        exit: {
          hub: 'BLQ',
          journeyMin: 25,
          bufferMin: 90,
          throughTicket: 'outbound',
          transferRef: 'NX-1',
          // A booked ride's own clock times: new here, ignored on the old build.
          transferAt: '17:05',
          transferArr: '17:30',
          payOnDay: false,
        },
      },
    ],
    stops: [
      {
        id: 's1',
        tripId: 't1',
        cityId: 'c1',
        name: 'Archiginnasio',
        notes: '',
        checklist: [],
        visited: true,
        visitedAt: 5,
        tz: 'Europe/Rome',
        legName: 'Rome',
        guide: { anchor: 'Anatomical theatre', lookFor: ['coats of arms'] },
        bookAhead: 'Timed entry, book a week ahead',
        booked: true,
        bookingRef: 'MU-4412',
        order: 0,
        createdAt: 1,
      },
    ],
    expenses: [
      {
        id: 'e1',
        tripId: 't1',
        cityId: null,
        date: '2026-10-16',
        destination: 'Bologna/Barcelona',
        category: 'Transportation',
        subcategory: 'Flight',
        description: 'Outbound',
        paymentMethod: 'Online Payment',
        amountGBP: 80,
        amountLocal: 0,
        notes: '',
        currency: 'GBP',
        fxRate: null,
        shared: true,
        gbpManual: true,
        need: 'flight:outbound',
        quote: { amountGBP: 80, note: '£40 each × 2, as quoted' },
        skeleton: false,
        order: 0,
        createdAt: 1,
      },
    ],
    moments: [
      {
        id: 'm1',
        tripId: 't1',
        cityId: 'c1',
        title: 'Portico concert',
        note: 'Stumbled into it',
        at: 9,
        stopId: null,
        tz: 'Europe/Rome',
        legName: 'Rome',
        lat: 44.4938,
        lng: 11.3426,
        createdAt: 9,
      },
    ],
    opportunities: [
      {
        id: 'opp1',
        city: 'Bologna',
        country: 'Italy',
        research: 'Marconi Express into town, about 20 minutes.',
        options: [
          {
            id: 'opt1',
            outDate: '2026-10-16',
            backDate: '2026-10-17',
            outRoute: ['LGW', 'BLQ'],
            backRoute: ['BCN', 'LGW'],
            outDep: '06:10',
            outArr: '09:00',
            backDep: '21:00',
            backArr: '22:30',
            outFlights: 'Vueling 8515',
            backFlights: 'Vueling 7642',
            outFarePP: 40,
            backFarePP: 45,
            finderPP: 120,
            usableH: 18.5,
            groundH: 22,
            cities: 'BLQ* 10h + BCN 8h',
            overnight: '1 · out via BLQ, night at the destination',
            paidNights: 1,
            scenario: 1,
            checked: '2026-10-14 10:00',
            outLink: 'https://example.test/out',
            backLink: 'https://example.test/back',
          },
          {
            id: 'opt2',
            source: 'manual',
            outDate: '2026-11-20',
            backDate: '2026-11-22',
            outRoute: ['STN', 'BLQ'],
            backRoute: ['BLQ', 'STN'],
            outFarePP: 22,
            backFarePP: 31,
            // A fare sold in dinars, with the £ beside it.
            backFareLocal: 28,
            backFareCcy: 'JOD',
            paidNights: 2,
            finderAssumptions: {
              travellers: 2,
              destTransferPP: 12,
              hotelPerNight: 60,
              bagStoragePerDay: 6,
              esimPerTrip: 3,
              earlyDepPenalty: 25,
            },
            note: 'Found on Google Flights, fares checked by hand',
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    fxRates: [],
    settings: [],
    photos: [],
    photosMeta: [
      {
        id: 'p1',
        tripId: 't1',
        stopId: null,
        expenseId: null,
        momentId: 'm1',
        kind: 'stop',
        takenAt: 8,
        bytes: 1234,
        sha256: 'ab',
        createdAt: 9,
      },
    ],
  };
}

describe('mixed-version sync', () => {
  it('a snapshot with every new field passes this and the previous validator', () => {
    expect(() => validateBackup(snapshot())).not.toThrow();
    expect(() => oldValidate(snapshot())).not.toThrow();
  });

  it('the previous merge carries the new fields through untouched', () => {
    const s = snapshot();
    const recs = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const local = { ...recs, cities: [{ ...recs.cities[0], name: 'Bologna Centrale' }] };
    const { merged } = oldMerge(recs as any, local as any, recs as any, true);
    expect(merged.cities[0]).toMatchObject({
      name: 'Bologna Centrale',
      tz: 'Europe/Rome',
      exit: { throughTicket: 'outbound' },
    });
    expect(merged.stops[0]).toMatchObject({ guide: { anchor: 'Anatomical theatre' } });
  });

  it("carries a moment's own place and kept zone through a merge", () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const local = JSON.parse(JSON.stringify(base));
    local.moments[0].title = 'Portico concert, second set';
    local.moments[0].updatedAt = 99;
    const { merged } = mergeRecords(base, local, base, true);
    expect(merged.moments![0]).toMatchObject({
      title: 'Portico concert, second set',
      lat: 44.4938,
      lng: 11.3426,
      tz: 'Europe/Rome',
      legName: 'Rome',
    });
  });

  // Taking a pin off the map deletes the fields rather than storing a blank:
  // the previous version's validator only accepts a number or nothing at all,
  // and a null would stop the iPhone syncing until it updated.
  it('a record taken off the map still passes the previous validator', () => {
    const s = snapshot();
    delete s.stops[0].lat;
    delete s.stops[0].lng;
    delete s.moments![0].lat;
    delete s.moments![0].lng;
    expect(() => validateBackup(s)).not.toThrow();
    expect(() => oldValidate(s)).not.toThrow();
    const blanked = snapshot();
    (blanked.stops[0] as Record<string, unknown>).lat = null;
    expect(() => validateBackup(blanked)).toThrow();
  });

  // With a base both sides descend from, removing a pin is attributable: the
  // other device's coordinates must not flow back in.
  it('removing a pin survives a merge against a device that still has it', () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const unplaced = JSON.parse(JSON.stringify(base));
    delete unplaced.stops[0].lat;
    delete unplaced.stops[0].lng;
    unplaced.stops[0].updatedAt = 99;
    const { merged } = mergeRecords(base, unplaced, base, true);
    expect(merged.stops[0].lat).toBeUndefined();
    expect(merged.stops[0].lng).toBeUndefined();
  });

  it("an older device's snapshot (no moments key) deletes no moments", () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const remote = { ...base, moments: undefined };
    const { merged } = mergeRecords(base, base, remote, true);
    expect(merged.moments?.map((m) => m.id)).toEqual(['m1']);
  });

  it('a newer snapshot that has deleted a moment does delete it', () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const { merged } = mergeRecords(base, base, { ...base, moments: [] }, true);
    expect(merged.moments).toEqual([]);
  });

  it("an older device's snapshot (no opportunities key) deletes none of them", () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const remote = { ...base, opportunities: undefined };
    const { merged } = mergeRecords(base, base, remote, true);
    expect(merged.opportunities?.map((o) => o.id)).toEqual(['opp1']);
  });

  it('a newer snapshot that has deleted an opportunity does delete it', () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const { merged } = mergeRecords(base, base, { ...base, opportunities: [] }, true);
    expect(merged.opportunities).toEqual([]);
  });

  // An option added on one device and a different one added on the other: the
  // list is one field, so the newer edit is kept and the other is offered for
  // review rather than quietly dropped.
  it('an option list edited on both devices keeps one and reports the other', () => {
    const s = snapshot();
    const base = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const mine = JSON.parse(JSON.stringify(base));
    mine.opportunities[0].options[0].outFarePP = 38;
    mine.opportunities[0].updatedAt = 99;
    const theirs = JSON.parse(JSON.stringify(base));
    theirs.opportunities[0].options[0].outFarePP = 42;
    theirs.opportunities[0].updatedAt = 50;
    const { merged, conflicts } = mergeRecords(base, mine, theirs, true);
    expect(merged.opportunities![0].options[0].outFarePP).toBe(38);
    expect(conflicts.map((c) => c.table)).toEqual(['opportunities']);
  });

  it('refuses a malformed option rather than storing it', () => {
    const bad = snapshot();
    (bad.opportunities![0].options[0] as Record<string, unknown>).outRoute = 'LGW';
    expect(() => validateBackup(bad)).toThrow(/opportunities/);
    const dupes = snapshot();
    dupes.opportunities![0].options.push({ ...dupes.opportunities![0].options[0] });
    expect(() => validateBackup(dupes)).toThrow(/opportunities/);
  });

  it('rejects a moment linked into another trip', () => {
    const s = snapshot();
    s.trips.push({ ...s.trips[0], id: 't2' });
    s.stops[0].tripId = 't2';
    s.stops[0].cityId = null;
    s.moments![0].stopId = 's1';
    expect(() => validateBackup(s)).toThrow(/moment m1/);
  });
});

it('an explicit payment detachment stays readable and mergeable by the previous version', () => {
  const s = snapshot();
  s.expenses[0].need = '';
  expect(() => oldValidate(s)).not.toThrow();
  expect(() => validateBackup(s)).not.toThrow();
  const records = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
  const merged = oldMerge(records as any, records as any, records as any, true).merged;
  expect(merged.expenses[0].need).toBe('');
});

it.each(['date', 'approximate', 'unknown'] as const)(
  'keeps %s Moment precision when an older device returns a snapshot',
  (timePrecision) => {
    const s = snapshot();
    s.moments![0].timePrecision = timePrecision;
    expect(() => oldValidate(s)).not.toThrow();
    expect(() => validateBackup(s)).not.toThrow();
    const records = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
    const merged = oldMerge(records as any, records as any, records as any, true).merged;
    const reconciled = mergeRecords(
      records,
      records,
      merged as unknown as SyncRecords,
      true,
    ).merged;
    expect(reconciled.moments![0].timePrecision).toBe(timePrecision);
    (s.moments![0] as Record<string, unknown>).timePrecision = 'made-up';
    expect(() => validateBackup(s)).toThrow(/moments/);
  },
);

it('retains reviewed-route metadata through the previous validator and merge', () => {
  const s = snapshot();
  s.stops[0].offPlan = true;
  s.stops[0].planSource = { name: 'Archiginnasio', notes: 'Imported research', checklist: [] };
  expect(() => oldValidate(s)).not.toThrow();
  expect(() => validateBackup(s)).not.toThrow();
  const records = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
  const merged = oldMerge(records as any, records as any, records as any, true).merged;
  expect(merged.stops[0]).toMatchObject({ offPlan: true, planSource: s.stops[0].planSource });
  (s.stops[0].planSource as any).checklist = [{ text: 'Bad', done: 'yes' }];
  expect(() => validateBackup(s)).toThrow(/stops/);
});

// Plan-generated checklist provenance. Top level: the acceptance check names this test alone.
const texts = (s: Stop) => s.checklist.map((c) => [c.text, c.done, !!c.fromPlan]);
const plan = (...items: string[]) =>
  extractStopsFromPlan(
    `## Route\n### Duomo\nNotes\n${items.map((t) => `- [ ] ${t}`).join('\n')}`,
  )[0];

it('repeated plan revisions retire only proven untouched generated checklist items', () => {
  const written = plan(
    'Buy tickets',
    'Find the crypt',
    'See the cloister',
    'Ask for the roof',
    'Old cue',
    'Light a candle',
  );
  // The plan also wrote one item already ticked.
  const rev0 = {
    ...written,
    checklist: [...written.checklist, { text: 'Pre-booked', done: true }],
  };
  // As the traveller left it: one ticked, one deleted, one recreated by hand,
  // own additions (one with the plan's own wording), one edited, and one
  // from before items were marked (its origin unknown).
  const start: Stop = {
    id: 'duomo',
    tripId: 't1',
    cityId: null,
    name: 'Duomo',
    notes: 'Notes',
    visited: false,
    order: 0,
    createdAt: 1,
    planSource: rev0,
    checklist: [
      { id: 'buy', text: 'Buy tickets', done: true, fromPlan: true },
      { id: 'crypt', text: 'Find the crypt', done: false, fromPlan: true },
      { id: 'cloister', text: 'See the cloister', done: false, fromPlan: true },
      { id: 'legacy', text: 'Old cue', done: false },
      { id: 'candle', text: 'Light a candle', done: false },
      { id: 'water', text: 'Bring water', done: false },
      { id: 'tower', text: 'Check the tower', done: false },
      { id: 'edited', text: 'Find the crypt door', done: false, fromPlan: true },
      // Written ticked, unticked since: edited, so it stays.
      { id: 'unticked', text: 'Pre-booked', done: false, fromPlan: true },
    ],
  };

  const rev1 = plan('See the cloister', 'Check the tower', 'Climb the dome');
  const one = revisedStop(start, rev1);
  expect(texts(one)).toEqual([
    ['Buy tickets', true, true],
    ['See the cloister', false, true],
    ['Old cue', false, false],
    ['Light a candle', false, false],
    ['Bring water', false, false],
    ['Check the tower', false, false],
    ['Find the crypt door', false, true],
    ['Pre-booked', false, true],
    ['Climb the dome', false, true],
  ]);
  // Surviving items keep their identity and tick.
  expect(one.checklist.slice(0, 8).map((c) => c.id)).toEqual([
    'buy',
    'cloister',
    'legacy',
    'candle',
    'water',
    'tower',
    'edited',
    'unticked',
  ]);

  const rev2 = plan('Climb the dome', 'Ask for the roof');
  const two = revisedStop(one, rev2);
  expect(texts(two)).toEqual([
    ['Buy tickets', true, true],
    ['Old cue', false, false],
    ['Light a candle', false, false],
    ['Bring water', false, false],
    ['Check the tower', false, false],
    ['Find the crypt door', false, true],
    ['Pre-booked', false, true],
    ['Climb the dome', false, true],
    ['Ask for the roof', false, true],
  ]);
  const dome = two.checklist.find((c) => c.text === 'Climb the dome')!;
  expect(dome.id).toBe(one.checklist.find((c) => c.text === 'Climb the dome')!.id);
  // Deleted by hand while this plan still lists it: it stays deleted.
  const pruned = {
    ...two,
    checklist: two.checklist.filter((c) => c.text !== 'Ask for the roof'),
  };
  expect(texts(revisedStop(pruned, rev2)).map(([t]) => t)).not.toContain('Ask for the roof');

  // Ticked after the second revision: a ticked item is never retired.
  const ticked = {
    ...two,
    checklist: two.checklist.map((c) => (c.id === dome.id ? { ...c, done: true } : c)),
  };
  const rev3 = plan('Ask for the roof');
  const three = revisedStop(ticked, rev3);
  expect(texts(three)).toEqual([
    ['Buy tickets', true, true],
    ['Old cue', false, false],
    ['Light a candle', false, false],
    ['Bring water', false, false],
    ['Check the tower', false, false],
    ['Find the crypt door', false, true],
    ['Pre-booked', false, true],
    ['Climb the dome', true, true],
    ['Ask for the roof', false, true],
  ]);
  // Re-applying the same plan changes nothing.
  expect(revisedStop(three, rev3)).toEqual(three);

  // A later plan happens to list the edited item's text and the unticked one,
  // unticked: they stay, and are the traveller's from now on.
  const rev4 = plan('Find the crypt door', 'Pre-booked', 'Ask for the roof');
  const four = revisedStop(three, rev4);
  expect(texts(four)).toEqual([
    ['Buy tickets', true, true],
    ['Old cue', false, false],
    ['Light a candle', false, false],
    ['Bring water', false, false],
    ['Check the tower', false, false],
    ['Find the crypt door', false, false],
    ['Pre-booked', false, false],
    ['Climb the dome', true, true],
    ['Ask for the roof', false, true],
  ]);
  expect(revisedStop(four, rev4)).toEqual(four);
  // The next plan drops all three: only the untouched generated one goes.
  const roof = three.checklist.find((c) => c.text === 'Ask for the roof')!.id;
  const five = revisedStop(four, plan());
  expect(five.checklist.map((c) => c.id)).toEqual([
    'buy',
    'legacy',
    'candle',
    'water',
    'tower',
    'edited',
    'unticked',
    dome.id,
  ]);
  // Negative control: before the plan dropped it, the untouched one was there.
  expect(four.checklist.map((c) => c.id)).toContain(roof);

  // No planSource (a record from an older version): nothing is retired, even
  // when the previous plan text lists the item.
  const legacy = { ...start, planSource: undefined };
  expect(revisedStop(legacy, rev1, rev0).checklist.map((c) => c.id)).toEqual(
    expect.arrayContaining(['crypt', 'cloister', 'legacy', 'candle']),
  );

  // The mark survives this and the previous validator, the previous merge,
  // this merge, and a ZIP backup read back.
  const s = snapshot();
  s.stops = [{ ...three, tripId: s.trips[0].id }];
  expect(() => validateBackup(s)).not.toThrow();
  expect(() => oldValidate(s)).not.toThrow();
  const bad = snapshot();
  bad.stops = [
    { ...three, checklist: [{ id: 'x', text: 'x', done: false, fromPlan: 'yes' as any }] },
  ];
  expect(() => validateBackup(bad)).toThrow();
  const recs = { ...s, kv: [], photosMeta: s.photosMeta! } as unknown as SyncRecords;
  const renamed = { ...recs, stops: [{ ...recs.stops[0], notes: 'Edited elsewhere' }] };
  for (const merge of [oldMerge, mergeRecords] as const) {
    const { merged } = merge(recs as any, renamed as any, recs as any, true);
    expect(merged.stops[0].checklist).toEqual(three.checklist);
    expect(merged.stops[0].notes).toBe('Edited elsewhere');
  }
});

it('a ZIP backup carries checklist provenance back unchanged', async () => {
  const s = snapshot();
  const stop = {
    ...s.stops[0],
    checklist: [{ id: 'g', text: 'Climb', done: false, fromPlan: true }],
  };
  s.stops = [stop];
  const file = await zip([{ name: BACKUP_JSON, data: new Blob([JSON.stringify(s)]) }]);
  const { backup } = await readBackupFile(file);
  expect(backup.stops[0].checklist).toEqual(stop.checklist);
});
