import { db, type City, type Moment, type Stop } from './db';
import { newId } from './ids';
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
  stopId?: string | null;
}

export async function addMoment(input: MomentInput): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.moments.add({
    id,
    tripId: input.tripId,
    cityId: input.cityId,
    title: input.title.trim(),
    note: (input.note ?? '').trim(),
    at: input.at ?? now,
    stopId: input.stopId ?? null,
    createdAt: now,
  });
  return id;
}

export async function updateMoment(id: string, patch: Partial<Moment>): Promise<void> {
  await db.moments.update(id, patch);
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

export type TimelineItem =
  | { kind: 'stop'; stop: Stop; at?: number }
  | { kind: 'moment'; moment: Moment; at: number };

/**
 * What happened, in the order it happened: stops in route order, with each
 * moment placed where it belongs — at the stop it is part of, else after the
 * last stop visited before it. Stops ticked by older versions have no visit
 * time; a moment then goes after its own city's stops. Pure.
 *
 * `visitedOnly` (the default) keeps the trip pack to places actually visited;
 * the Stops list passes false, so the same rule orders the list you tick.
 */
export function visitTimeline(
  stops: Stop[],
  moments: Moment[],
  cities: City[],
  { visitedOnly = true }: { visitedOnly?: boolean } = {},
): TimelineItem[] {
  const cityRank = new Map([...cities].sort((a, b) => a.order - b.order).map((c, i) => [c.id, i]));
  const rank = (cityId: string | null) => cityRank.get(cityId ?? '') ?? Infinity;
  const out: TimelineItem[] = [...stops]
    .filter((s) => !visitedOnly || s.visited)
    .sort((a, b) => a.order - b.order)
    .map((stop) => ({ kind: 'stop', stop, at: stop.visitedAt }));

  // A moment sitting at its stop is out of time order by design, so it never
  // decides where a later one goes.
  const atAStop = (m: Moment) =>
    !!m.stopId && out.some((it) => it.kind === 'stop' && it.stop.id === m.stopId);
  for (const m of [...moments].sort((a, b) => a.at - b.at)) {
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
      if (it.kind === 'moment' && it.at <= m.at && !atAStop(it.moment)) idx = Math.max(idx, i);
    });
    out.splice(idx + 1, 0, { kind: 'moment', moment: m, at: m.at });
  }
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
  await db.moments.update(id, (m) => {
    if (pos) Object.assign(m, pos);
    else {
      delete m.lat;
      delete m.lng;
    }
  });
}
