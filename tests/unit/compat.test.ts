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
        outbound: { at: '2026-10-16T06:10', tz: 'Europe/London', hub: 'LGW', journeyMin: 70 },
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
        base: { name: 'Left luggage, Centrale', lat: 44.5, lng: 11.3 },
        exit: { hub: 'BLQ', journeyMin: 25, bufferMin: 90, throughTicket: 'outbound' },
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
        guide: { anchor: 'Anatomical theatre', lookFor: ['coats of arms'] },
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
        createdAt: 9,
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

  it('rejects a moment linked into another trip', () => {
    const s = snapshot();
    s.trips.push({ ...s.trips[0], id: 't2' });
    s.stops[0].tripId = 't2';
    s.stops[0].cityId = null;
    s.moments![0].stopId = 's1';
    expect(() => validateBackup(s)).toThrow(/moment m1/);
  });
});
