import type { City, Expense, KeyValue, Photo, Stop, Trip } from './db';

/**
 * Pure three-way merge for NAS sync between devices (iPhone + Mac).
 *
 * Each device keeps a *base*: the last snapshot it agreed with the NAS. A
 * change is then attributable to a side, so edits on two devices combine
 * field by field instead of "last device wins":
 *  - only one side changed a field → that change is taken;
 *  - both changed it differently → the newer record's value is kept and the
 *    other one is returned as a conflict, so nothing is lost silently;
 *  - a record deleted on one side and untouched on the other is deleted;
 *    edited on the other side, the edit wins (it comes back).
 *
 * Remote deletions are only inferred when the remote snapshot descends from
 * this device's base (lineage). With no base or unknown lineage the merge is
 * a union and never deletes. Photos are union-only: a photo leaves only via an
 * explicit tombstone (`deleted-photo:<id>` kv row), never because a snapshot
 * lacks it — it may be the only copy.
 */

export type PhotoMeta = Omit<Photo, 'blob'>;

/** The record sets that sync between devices (photo blobs travel separately). */
export interface SyncRecords {
  trips: Trip[];
  cities: City[];
  stops: Stop[];
  expenses: Expense[];
  /** Synced key/value rows: conflicts and photo tombstones. Never device settings. */
  kv: KeyValue[];
  photosMeta: PhotoMeta[];
}

export type SyncTable = 'trips' | 'cities' | 'stops' | 'expenses' | 'kv';
export const SYNC_TABLES: SyncTable[] = ['trips', 'cities', 'stops', 'expenses', 'kv'];

type Row = Record<string, unknown>;
const keyOf = (table: SyncTable | 'photosMeta') => (table === 'kv' ? 'key' : 'id');

/** Device-only kv rows: settings, sync state. Everything else in kv syncs. */
export function isLocalKey(key: string): boolean {
  return key === 'settings' || key === 'nasLastDataAt' || key.startsWith('local:');
}

export const TOMBSTONE = 'deleted-photo:';
export const CONFLICT = 'conflict:';

// Bookkeeping and derived fields: never reported as conflicts (the newer
// side's value is taken; derived trip dates are recomputed after a merge).
const QUIET = new Set([
  'updatedAt',
  'order',
  'startDate',
  'endDate',
  'returnFlightAt',
  'accommodation',
]);
// Never part of content equality: a bumped timestamp or upload flag alone is not a change.
const IGNORED = new Set(['updatedAt', 'backedUp']);

/** Key-order-independent JSON, ignoring bookkeeping fields and undefined values. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (k, x) => {
    if (IGNORED.has(k)) return undefined;
    return x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x;
  });
}

export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function byKey(rows: Row[] | undefined, key: string): Map<string, Row> {
  return new Map((rows ?? []).map((r) => [r[key] as string, r]));
}

export interface FieldConflict {
  table: SyncTable;
  recordId: string;
  /** Per field: the value now in place, and the other device's value. */
  fields: Record<string, { kept: unknown; other: unknown }>;
  /** True when this device's version was kept (it was newer). */
  keptLocal: boolean;
}

/** Field-level three-way merge of one record changed on both sides. */
function mergeFields(
  table: SyncTable,
  b: Row | undefined,
  l: Row,
  r: Row,
): { row: Row; conflict: FieldConflict | null } {
  const lt = Number(l.updatedAt ?? 0);
  const rt = Number(r.updatedAt ?? 0);
  const localWins = lt >= rt;
  const row: Row = {};
  const fields: FieldConflict['fields'] = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (k === 'updatedAt') continue;
    const [lv, rv, bv] = [l[k], r[k], b?.[k]];
    let v: unknown;
    if (same(lv, rv)) v = lv;
    else if (b && same(lv, bv)) v = rv;
    else if (b && same(rv, bv)) v = lv;
    else {
      v = localWins ? lv : rv;
      if (!QUIET.has(k)) fields[k] = { kept: v, other: localWins ? rv : lv };
    }
    if (v !== undefined) row[k] = v;
  }
  const t = Math.max(lt, rt);
  if (t) row.updatedAt = t;
  const conflict = Object.keys(fields).length
    ? { table, recordId: String(l[keyOf(table)]), fields, keptLocal: localWins }
    : null;
  return { row, conflict };
}

export interface MergeResult {
  merged: SyncRecords;
  conflicts: FieldConflict[];
}

/**
 * Merge `local` with `remote` against their common `base`. `descends` says
 * whether `remote` is known to include everything in `base` (lineage); only
 * then may an absence on the remote side delete a local record.
 */
export function mergeRecords(
  base: SyncRecords | null,
  local: SyncRecords,
  remote: SyncRecords | null,
  descends: boolean,
): MergeResult {
  const merged = { photosMeta: [] } as unknown as SyncRecords;
  const conflicts: FieldConflict[] = [];

  for (const table of SYNC_TABLES) {
    const key = keyOf(table);
    const B = byKey(base?.[table] as Row[] | undefined, key);
    const L = byKey(local[table] as unknown as Row[], key);
    const R = byKey(remote?.[table] as Row[] | undefined, key);
    const out: Row[] = [];
    for (const id of new Set([...L.keys(), ...R.keys()])) {
      const [b, l, r] = [B.get(id), L.get(id), R.get(id)];
      if (!r) {
        // Remote lacks it: deleted there (only provable via lineage), or new here.
        if (l && !(b && descends && same(l, b))) out.push(l);
      } else if (!l) {
        // Local lacks it: deleted here (remote untouched since), or new/edited there.
        if (!(b && same(r, b))) out.push(r);
      } else if (same(l, r)) {
        out.push(Number(r.updatedAt ?? 0) > Number(l.updatedAt ?? 0) ? r : l);
      } else {
        const { row, conflict } = mergeFields(table, b, l, r);
        out.push(row);
        if (conflict) conflicts.push(conflict);
      }
    }
    (merged as unknown as Record<string, Row[]>)[table] = out;
  }

  // Photos: union, minus explicit tombstones.
  const dead = new Set(
    merged.kv.filter((r) => r.key.startsWith(TOMBSTONE)).map((r) => r.key.slice(TOMBSTONE.length)),
  );
  const photos = byKey(remote?.photosMeta as Row[] | undefined, 'id');
  for (const p of local.photosMeta) photos.set(p.id, p as unknown as Row);
  merged.photosMeta = [...photos.values()].filter(
    (p) => !dead.has(p.id as string),
  ) as unknown as PhotoMeta[];

  // A record may outlive its trip (added on one device while the trip was
  // deleted on another). Keep the trip rather than orphan the new data.
  const tripIds = new Set(merged.trips.map((t) => t.id));
  const allTrips = [...(remote?.trips ?? []), ...(base?.trips ?? []), ...local.trips];
  for (const row of [...merged.cities, ...merged.stops, ...merged.expenses, ...merged.photosMeta]) {
    if (tripIds.has(row.tripId)) continue;
    const trip = allTrips.find((t) => t.id === row.tripId);
    if (trip) {
      merged.trips.push(trip);
      tripIds.add(trip.id);
    }
  }

  return { merged, conflicts };
}

/** How many records differ between two record sets (for "unsynced changes"). */
export function countDifferences(a: SyncRecords, b: SyncRecords | null): number {
  let n = 0;
  for (const table of [...SYNC_TABLES, 'photosMeta'] as const) {
    const key = keyOf(table);
    const A = byKey(a[table] as unknown as Row[], key);
    const B = byKey(b?.[table] as Row[] | undefined, key);
    for (const id of new Set([...A.keys(), ...B.keys()])) {
      if (!same(A.get(id), B.get(id))) n += 1;
    }
  }
  return n;
}
