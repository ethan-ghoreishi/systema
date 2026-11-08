import { db, type City, type Moment, type Stop } from './db';
import { instantToWall, wallLabel, wallToInstant } from './tz';
import { activeLegId, tripEndIso } from './trip-shape';
import type { Trip } from './db';
import { newId } from './ids';
import { same } from './sync';
import { hasPin } from './maps';
import { deletePhotosWhere } from './photos';

/**
 * Off-plan moments: a place found by accident, a changed plan, a missed
 * train, an encounter. Their own records — not journal text, not forced into
 * the planned route — optionally linked to a stop.
 */

export interface MomentInput {
  tripId: string;
  cityId: string | null;
  title: string;
  note?: string;
  at?: number;
  timePrecision?: Moment['timePrecision'];
  stopId?: string | null;
  lat?: number;
  lng?: number;
}

/**
 * A moment that is part of a planned stop belongs where that stop does, and
 * its place is that stop's own pin, so it keeps no coordinates. The stop
 * answers for the leg wherever it knows one: a stop on no leg knows less than
 * the moment does, so it never empties the moment's own answer — the two are
 * left differing only where neither contradicts the other. Applied on every
 * write of either side, so a leg changed on one can't drift from the other.
 * Pure.
 */
export function alignToStop(
  moment: Pick<Moment, 'cityId'> & Partial<Moment>,
  stop: Stop | undefined,
): void {
  if (!stop) return;
  if (stop.cityId) moment.cityId = stop.cityId;
  else if (!moment.cityId) {
    // Both off the legs: what the stop kept when its leg was deleted.
    if (stop.tz) moment.tz = stop.tz;
    if (stop.legName) moment.legName = stop.legName;
  }
  delete moment.lat;
  delete moment.lng;
}

export async function addMoment(input: MomentInput): Promise<string> {
  const id = newId();
  const now = Date.now();
  const stopId = input.stopId ?? null;
  const row: Moment = {
    id,
    tripId: input.tripId,
    cityId: input.cityId,
    title: input.title.trim(),
    note: (input.note ?? '').trim(),
    at: input.at ?? now,
    ...(input.timePrecision ? { timePrecision: input.timePrecision } : {}),
    stopId,
    lat: input.lat,
    lng: input.lng,
    createdAt: now,
  };
  validateMoment(row);
  alignToStop(row, stopId ? await db.stops.get(stopId) : undefined);
  await db.moments.add(row);
  return id;
}

function validateMoment(m: Pick<Moment, 'at' | 'lat' | 'lng'>) {
  if (!Number.isFinite(m.at)) throw new Error('Enter a valid event date and time');
  if ((m.lat != null || m.lng != null) && !hasPin(m))
    throw new Error('Enter valid latitude and longitude');
}

/** A calendar date is not an instant: moving a date-only memory to another city keeps its date. */
export function keepMomentDate(
  m: Moment,
  oldZone: string | undefined,
  newZone: string | undefined,
): void {
  // Nothing to keep when the zone has not moved: an unrelated edit (ticking a
  // checklist item) must not rewrite a saved instant or churn the sync.
  if (oldZone === newZone) return;
  if (m.timePrecision !== 'date' && m.timePrecision !== 'approximate') return;
  const date = instantToWall(m.at, oldZone).slice(0, 10);
  const at = wallToInstant(`${date}T12:00`, newZone);
  if (at == null || instantToWall(at, newZone).slice(0, 10) !== date)
    throw new Error('This calendar date does not exist in the chosen city');
  m.at = at;
}

export async function updateMoment(
  id: string,
  patch: Partial<Moment>,
  expected?: Moment,
): Promise<void> {
  await db.transaction('rw', db.moments, db.stops, db.cities, db.photos, async () => {
    const current = await db.moments.get(id);
    if (!current)
      throw new Error('This Moment was deleted elsewhere. Copy your draft before leaving');
    if (expected && !same(current, expected))
      throw new Error('This Moment changed elsewhere. Copy your draft, then reopen it');
    if (
      current.timePrecision &&
      !patch.timePrecision &&
      'timePrecision' in patch &&
      !('at' in patch)
    )
      throw new Error('Enter the exact event date and time');
    const next = { ...current, ...patch };
    const cities = await db.cities.where('tripId').equals(current.tripId).toArray();
    const stop = next.stopId ? await db.stops.get(next.stopId) : undefined;
    if (current.stopId && !next.stopId && patch.lat == null && patch.lng == null) {
      delete next.lat;
      delete next.lng;
    }
    alignToStop(next, stop);
    if (!('at' in patch)) keepMomentDate(next, zoneOf(current, cities), zoneOf(next, cities));
    validateMoment(next);
    await db.moments.put(next);
    if (next.stopId !== current.stopId)
      await db.photos.where('momentId').equals(id).modify({ stopId: next.stopId });
  });
}

/** Delete a moment and its photos (tombstoned, so the deletion syncs). */
export async function deleteMoment(id: string): Promise<void> {
  await db.transaction('rw', db.moments, db.photos, db.kv, async () => {
    await deletePhotosWhere('momentId', id);
    await db.moments.delete(id);
  });
}

/**
 * The zone a stop's or moment's time is read in: its leg's, or the one kept on
 * the record itself when that leg was deleted (see deleteCity).
 */
export function zoneOf(
  record: { cityId: string | null; tz?: string },
  cities: Pick<City, 'id' | 'tz'>[],
): string | undefined {
  return cities.find((c) => c.id === record.cityId)?.tz ?? record.tz;
}

/** Retrospective capture never guesses an event time from the creation time. */
export function retrospective(trip: Trip, cities: City[], now = Date.now()): boolean {
  const end = tripEndIso(trip, cities);
  const zone = cities.find((c) => c.id === activeLegId(cities, now))?.tz;
  return trip.status === 'done' || !!(end && end < instantToWall(now, zone).slice(0, 10));
}

/** Untimed memories follow timed ones; creation order is only a stable display order. */
export function compareMoments(a: Moment, b: Moment): number {
  return (
    Number(a.timePrecision === 'unknown') - Number(b.timePrecision === 'unknown') ||
    (a.timePrecision === 'unknown' ? a.createdAt - b.createdAt : a.at - b.at) ||
    a.id.localeCompare(b.id)
  );
}

export function momentWhen(
  m: Pick<Moment, 'at' | 'timePrecision' | 'cityId' | 'tz'>,
  cities: City[],
  short = false,
): string {
  if (m.timePrecision === 'unknown') return 'Event time unknown';
  const wall = instantToWall(m.at, zoneOf(m, cities));
  if (m.timePrecision === 'approximate') return `Around ${wallLabel(wall.slice(0, 10))}`;
  if (m.timePrecision === 'date') return `${wallLabel(wall.slice(0, 10))} · time unknown`;
  return short ? wall.slice(11, 16) : wallLabel(wall);
}

export type TimelineItem =
  | { kind: 'stop'; stop: Stop; at?: number }
  | { kind: 'moment'; moment: Moment; at?: number };

/** Places actually visited. Unknown times are grouped by leg, never inferred from Moments. */
export function visitedPlaces(stops: Stop[], cities: City[]) {
  const visited = stops.filter((s) => s.visited);
  const timed = visited
    .filter((s) => s.visitedAt != null)
    .sort((a, b) => a.visitedAt! - b.visitedAt! || a.id.localeCompare(b.id));
  const untimed = visited.filter((s) => s.visitedAt == null);
  const keys = [
    ...new Set([
      ...[...cities].sort((a, b) => a.order - b.order).map((c) => c.id),
      ...untimed.map((s) => groupKey(s, cities)),
    ]),
  ];
  return {
    timed,
    untimed: keys
      .map((key) => ({
        key,
        stops: untimed
          .filter((s) => groupKey(s, cities) === key)
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
      }))
      .filter((g) => g.stops.length),
  };
}

/** Planned route with linked Moments beside their stop and loose Moments in their leg. */
function plannedTimeline(stops: Stop[], moments: Moment[], cities: City[]): TimelineItem[] {
  const cityRank = new Map([...cities].sort((a, b) => a.order - b.order).map((c, i) => [c.id, i]));
  const rank = (cityId: string | null) => cityRank.get(cityId ?? '') ?? Infinity;
  const out: TimelineItem[] = [...stops]
    .sort((a, b) => a.order - b.order)
    .map((stop) => ({ kind: 'stop', stop, at: stop.visitedAt }));

  // A moment sitting at its stop is out of time order by design, so it never
  // decides where a later one goes.
  const atAStop = (m: Moment) =>
    !!m.stopId && out.some((it) => it.kind === 'stop' && it.stop.id === m.stopId);
  for (const m of [...moments].sort(compareMoments)) {
    // Part of a planned stop: with it, after anything already placed there.
    const linked = atAStop(m)
      ? out.findIndex((it) => it.kind === 'stop' && it.stop.id === m.stopId)
      : -1;
    if (linked >= 0) {
      let at = linked;
      while (
        out[at + 1]?.kind === 'moment' &&
        (out[at + 1] as { moment: Moment }).moment.stopId === m.stopId
      )
        at += 1;
      out.splice(at + 1, 0, { kind: 'moment', moment: m, at: m.at });
      continue;
    }
    if (m.timePrecision) {
      out.push({ kind: 'moment', moment: m });
      continue;
    }
    let idx = -1;
    let afterTimedStop = false;
    out.forEach((it, i) => {
      if (it.kind === 'stop' && it.at != null && it.at <= m.at) {
        idx = i;
        afterTimedStop = true;
      }
    });
    if (!afterTimedStop) {
      // No timed stop before it: after its city's stops (before a later city's).
      const r = rank(m.cityId);
      out.forEach((it, i) => {
        if (it.kind === 'stop' && it.at == null && rank(it.stop.cityId) <= r) idx = i;
      });
    }
    // Moments keep their own time order.
    out.forEach((it, i) => {
      if (it.kind === 'moment' && it.at != null && it.at <= m.at && !atAStop(it.moment))
        idx = Math.max(idx, i);
    });
    // Never land between a stop and the moments that are part of it.
    while (out[idx + 1]?.kind === 'moment' && atAStop((out[idx + 1] as { moment: Moment }).moment))
      idx += 1;
    out.splice(idx + 1, 0, { kind: 'moment', moment: m, at: m.at });
  }
  return out;
}

/** Prefix of the group key for records kept from a leg that was deleted. */
export const GONE = 'gone:';

/**
 * The group a record belongs to in the Stops list: its leg; the leg whose
 * name it kept when that leg was deleted; or nothing.
 */
export function groupKey(
  record: { cityId: string | null; legName?: string },
  cities: Pick<City, 'id'>[],
): string | null {
  if (record.cityId && cities.some((c) => c.id === record.cityId)) return record.cityId;
  return record.legName ? GONE + record.legName : null;
}

/**
 * The Stops list: runs of consecutive stops in one group, as the list already
 * orders them, each with the moments that belong to it — one that is part of
 * a planned stop joins the run holding that stop, wherever that is; the rest
 * join their own group's last run. Groups with only moments come after.
 * Within a run, `plannedTimeline` decides the order. Pure.
 */
export function stopGroups(
  stops: Stop[],
  moments: Moment[],
  cities: City[],
): { key: string | null; items: TimelineItem[] }[] {
  const runs: { key: string | null; stops: Stop[] }[] = [];
  for (const stop of stops) {
    const key = groupKey(stop, cities);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.stops.push(stop);
    else runs.push({ key, stops: [stop] });
  }
  // A group returned to later holds its loose moments once, at the end.
  const lastRun = new Map(runs.map((r, i) => [r.key, i]));
  const runOf = (m: Moment) => {
    const atStop = m.stopId ? runs.findIndex((r) => r.stops.some((s) => s.id === m.stopId)) : -1;
    return atStop >= 0 ? atStop : (lastRun.get(groupKey(m, cities)) ?? -1);
  };
  const out = runs.map((run, i) => ({
    key: run.key,
    items: plannedTimeline(
      run.stops,
      moments.filter((m) => runOf(m) === i),
      cities,
    ),
  }));
  // Groups with no stops of their own still have their place.
  const loose = moments.filter((m) => runOf(m) < 0);
  for (const key of [...new Set(loose.map((m) => groupKey(m, cities)))])
    out.push({
      key,
      items: loose
        .filter((m) => groupKey(m, cities) === key)
        .sort(compareMoments)
        .map((moment) => ({
          kind: 'moment' as const,
          moment,
          at: moment.timePrecision === 'unknown' ? undefined : moment.at,
        })),
    });
  return out;
}

/**
 * Put a moment on the map, or take it off again (`null`). Removing deletes
 * the fields rather than storing a blank, so an older device still reads the
 * record and a merge sees the absence for what it is.
 */
export async function placeMoment(
  id: string,
  pos: { lat: number; lng: number } | null,
): Promise<void> {
  if (pos && !hasPin(pos)) throw new Error('Enter valid latitude and longitude');
  const changed = await db.moments.update(id, (m) => {
    if (pos) Object.assign(m, pos);
    else {
      delete m.lat;
      delete m.lng;
    }
  });
  if (!changed) throw new Error('This Moment was deleted elsewhere');
}
