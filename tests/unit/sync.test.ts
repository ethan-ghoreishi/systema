import { describe, expect, it } from 'vitest';
import type { Stop, Trip } from '../../src/lib/db';
import {
  countDifferences,
  mergeRecords,
  same,
  type PhotoMeta,
  type SyncRecords,
} from '../../src/lib/sync';

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: '',
    type: 'custom',
    startDate: '',
    endDate: '',
    partySize: 2,
    returnFlightAt: '',
    accommodation: false,
    status: 'planning',
    planText: 'Base plan',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function stop(over: Partial<Stop> = {}): Stop {
  return {
    id: 's1',
    tripId: 't1',
    cityId: null,
    name: 'Belvedere',
    notes: '',
    checklist: [],
    visited: false,
    order: 0,
    createdAt: 1,
    ...over,
  };
}

function photo(id: string): PhotoMeta {
  return { id, tripId: 't1', stopId: null, expenseId: null, kind: 'cover', createdAt: 1 };
}

function recs(over: Partial<SyncRecords> = {}): SyncRecords {
  return { trips: [], cities: [], stops: [], expenses: [], kv: [], photosMeta: [], ...over };
}

const base = recs({ trips: [trip()], stops: [stop()] });

describe('mergeRecords — combining two devices against their common base', () => {
  it('takes one-sided changes from each side without conflict', () => {
    const local = recs({ trips: [trip()], stops: [stop({ visited: true, updatedAt: 5 })] });
    const remote = recs({ trips: [trip({ planText: 'Mac plan', updatedAt: 9 })], stops: [stop()] });
    const { merged, conflicts } = mergeRecords(base, local, remote, true);
    expect(conflicts).toEqual([]);
    expect(merged.trips[0].planText).toBe('Mac plan');
    expect(merged.stops[0].visited).toBe(true);
  });

  it('merges different fields of the same record edited on both devices', () => {
    const local = recs({ trips: [trip()], stops: [stop({ visited: true, updatedAt: 5 })] });
    const remote = recs({ trips: [trip()], stops: [stop({ notes: 'Mac notes', updatedAt: 9 })] });
    const { merged, conflicts } = mergeRecords(base, local, remote, true);
    expect(conflicts).toEqual([]);
    expect(merged.stops[0]).toMatchObject({ visited: true, notes: 'Mac notes', updatedAt: 9 });
  });

  it('keeps the newer value of a field edited on both, and returns the other as a conflict', () => {
    const local = recs({ trips: [trip({ planText: 'Phone plan', updatedAt: 20 })] });
    const remote = recs({ trips: [trip({ planText: 'Mac plan', updatedAt: 10 })] });
    const { merged, conflicts } = mergeRecords(base, local, remote, true);
    expect(merged.trips[0].planText).toBe('Phone plan');
    expect(conflicts).toEqual([
      {
        table: 'trips',
        recordId: 't1',
        fields: { planText: { kept: 'Phone plan', other: 'Mac plan' } },
        keptLocal: true,
      },
    ]);
    const flipped = mergeRecords(base, remote, local, true);
    expect(flipped.merged.trips[0].planText).toBe('Phone plan');
    expect(flipped.conflicts[0].keptLocal).toBe(false);
  });

  it('reports no conflict when both made the same edit, or only bookkeeping differs', () => {
    const local = recs({ trips: [trip({ planText: 'Same', order: 3, updatedAt: 20 })] });
    const remote = recs({ trips: [trip({ planText: 'Same', order: 7, updatedAt: 10 })] });
    expect(mergeRecords(base, local, remote, true).conflicts).toEqual([]);
    expect(same(trip({ updatedAt: 1 }), trip({ updatedAt: 99 }))).toBe(true);
  });

  it('keeps a local deletion when the remote copy is unchanged', () => {
    const local = recs({ trips: [trip()] });
    const { merged } = mergeRecords(base, local, base, true);
    expect(merged.stops).toEqual([]);
  });

  it('brings back a record deleted here but edited on the other device (edit wins)', () => {
    const local = recs({ trips: [trip()] });
    const remote = recs({ trips: [trip()], stops: [stop({ notes: 'Edited on Mac' })] });
    expect(mergeRecords(base, local, remote, true).merged.stops[0].notes).toBe('Edited on Mac');
  });

  it('applies a remote deletion only when the remote descends from the base', () => {
    const remote = recs({ trips: [trip()] });
    expect(mergeRecords(base, base, remote, true).merged.stops).toEqual([]);
    // Unknown lineage (legacy snapshot, collision, history cap): union, never delete.
    expect(mergeRecords(base, base, remote, false).merged.stops).toHaveLength(1);
  });

  it('keeps a local edit when the other device deleted the record', () => {
    const local = recs({ trips: [trip()], stops: [stop({ notes: 'Phone notes' })] });
    const remote = recs({ trips: [trip()] });
    expect(mergeRecords(base, local, remote, true).merged.stops[0].notes).toBe('Phone notes');
  });

  it('unions everything with no base, conflicting only on fields that differ', () => {
    const local = recs({ trips: [trip({ planText: 'Phone', updatedAt: 5 })], stops: [stop()] });
    const remote = recs({
      trips: [trip({ planText: 'Mac', updatedAt: 9 }), trip({ id: 't2' })],
    });
    const { merged, conflicts } = mergeRecords(null, local, remote, false);
    expect(merged.trips.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(merged.stops).toHaveLength(1);
    expect(merged.trips.find((t) => t.id === 't1')!.planText).toBe('Mac');
    expect(conflicts.map((c) => Object.keys(c.fields))).toEqual([['planText']]);
  });

  it('a fresh device simply receives everything', () => {
    const { merged, conflicts } = mergeRecords(null, recs(), base, false);
    expect(conflicts).toEqual([]);
    expect(countDifferences(merged, base)).toBe(0);
  });

  it('is a no-op when nothing changed anywhere', () => {
    const { merged, conflicts } = mergeRecords(base, base, base, true);
    expect(conflicts).toEqual([]);
    expect(countDifferences(merged, base)).toBe(0);
  });

  it('never deletes a photo because a snapshot lacks it; only a tombstone removes it', () => {
    const local = recs({ photosMeta: [photo('p1'), photo('p2')] });
    const withPhotos = recs({ photosMeta: [photo('p1'), photo('p2')] });
    const remote = recs({ photosMeta: [photo('p3')] });
    expect(
      mergeRecords(withPhotos, local, remote, true)
        .merged.photosMeta.map((p) => p.id)
        .sort(),
    ).toEqual(['p1', 'p2', 'p3']);
    const tombstoned = recs({
      photosMeta: [photo('p3')],
      kv: [{ key: 'deleted-photo:p1', value: 5 }],
    });
    expect(
      mergeRecords(withPhotos, local, tombstoned, true)
        .merged.photosMeta.map((p) => p.id)
        .sort(),
    ).toEqual(['p2', 'p3']);
  });

  it('keeps a trip deleted on one device if the other added data to it meanwhile', () => {
    const local = recs(); // trip and stop deleted here
    const remote = recs({ trips: [trip()], stops: [stop(), stop({ id: 's2', name: 'New' })] });
    const { merged } = mergeRecords(base, local, remote, true);
    expect(merged.trips.map((t) => t.id)).toEqual(['t1']);
    expect(merged.stops.map((s) => s.id)).toEqual(['s2']);
  });

  it('counts differing records for the unsynced-changes indicator', () => {
    const local = recs({ trips: [trip({ planText: 'Edited' })], stops: [] });
    expect(countDifferences(local, base)).toBe(2);
    expect(countDifferences(base, null)).toBe(2);
  });
});
