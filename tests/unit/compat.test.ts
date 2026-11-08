import { describe, it, expect } from 'vitest';
import { validateBackup } from '../../src/lib/backup-validation';
import { mergeRecords, type SyncRecords } from '../../src/lib/sync';
import { validateBackup as oldValidate } from './fixtures/old-backup-validation';
import { mergeRecords as oldMerge } from './fixtures/old-sync';
import type { Backup } from '../../src/lib/export';

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
