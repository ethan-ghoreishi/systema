import { db, type ChecklistItem, type City, type Stop, type StopGuide } from './db';
import { newId } from './ids';
import { cityOfHeading, extractSections, type Section } from './headings';
import { alignToStop, keepMomentDate, zoneOf } from './moments';
import { deletePhotosWhere } from './photos';

/** Stop + checklist mutations over Dexie. */

/**
 * The trip's places with `stop` on the route beside the last place on its own
 * leg — appended, it would read as a leg the trip returns to. A leg with no
 * place yet goes before the first later leg's places when `cities` say which
 * those are, else at the route's end. Places kept off the route stay after it.
 */
function onRoute(others: Stop[], stop: Stop, cities: City[] = []): Stop[] {
  const route = others.filter((s) => !s.offPlan);
  let at = route.map((s) => s.cityId).lastIndexOf(stop.cityId) + 1;
  if (!at) {
    const legOrder = (id: string | null) => cities.find((c) => c.id === id)?.order;
    const mine = legOrder(stop.cityId);
    const later = mine == null ? -1 : route.findIndex((s) => (legOrder(s.cityId) ?? -1) > mine);
    at = later < 0 ? route.length : later;
  }
  route.splice(at, 0, stop);
  return [...route, ...others.filter((s) => s.offPlan)];
}

/**
 * Add a place by hand on its leg's part of the route. Positions are worked
 * out inside the write from the stored list, so places kept off the route,
 * gaps or ties left by older versions, and quick successive adds can't put
 * it out of place or give two places one position.
 */
export async function addStop(
  tripId: string,
  name: string,
  cityId: string | null = null,
): Promise<string> {
  const id = newId();
  await db.transaction('rw', db.stops, db.cities, async () => {
    const others = await db.stops.where('tripId').equals(tripId).sortBy('order');
    const cities = await db.cities.where('tripId').equals(tripId).toArray();
    const stop: Stop = {
      id,
      tripId,
      cityId,
      name: name.trim(),
      notes: '',
      checklist: [],
      visited: false,
      order: 0,
      createdAt: Date.now(),
    };
    const was = new Map(others.map((s) => [s.id, s.order]));
    await db.stops.bulkPut(
      onRoute(others, stop, cities)
        .map((s, order) => ({ ...s, order }))
        .filter((s) => was.get(s.id) !== s.order),
    );
  });
  return id;
}

/** Put a retained place back on the route (see onRoute). */
export async function returnToRoute(id: string): Promise<void> {
  await db.transaction('rw', db.stops, async () => {
    const stop = await db.stops.get(id);
    if (!stop) throw new Error('This stop was deleted elsewhere');
    const others = (await db.stops.where('tripId').equals(stop.tripId).sortBy('order')).filter(
      (s) => s.id !== id,
    );
    await db.stops.bulkPut(
      onRoute(others, { ...stop, offPlan: false }).map((s, order) => ({ ...s, order })),
    );
  });
}

/** Compare only edited fields, inside the write, so sync cannot be overwritten by an old editor. */
function checkDraft(stop: Stop, expected: Partial<Stop>): void {
  if (Object.keys(expected).some((key) => stop[key as keyof Stop] !== expected[key as keyof Stop]))
    throw new Error(
      'This field changed elsewhere. Copy your draft, then reload saved details to review it',
    );
}

export async function updateStop(
  id: string,
  patch: Partial<Stop>,
  expected: Partial<Stop> = {},
): Promise<void> {
  if (!('cityId' in patch)) {
    const changed = await db.stops.update(id, (s) => {
      checkDraft(s, expected);
      Object.assign(s, patch);
    });
    if (!changed)
      throw new Error('This stop was deleted elsewhere. Copy your draft before leaving');
    return;
  }
  // The moments that are part of this stop move legs with it, so a moment is
  // never left saying it belongs to one leg while its stop belongs to another.
  await db.transaction('rw', db.stops, db.moments, db.cities, async () => {
    const changed = await db.stops.update(id, (s) => {
      checkDraft(s, expected);
      Object.assign(s, patch);
    });
    if (!changed)
      throw new Error('This stop was deleted elsewhere. Copy your draft before leaving');
    const stop = await db.stops.get(id);
    const cities = await db.cities.where('tripId').equals(stop!.tripId).toArray();
    if (stop)
      await db.moments
        .where('stopId')
        .equals(id)
        .modify((m) => {
          const oldZone = zoneOf(m, cities);
          alignToStop(m, stop);
          keepMomentDate(m, oldZone, zoneOf(m, cities));
        });
  });
}

/**
 * Put a stop on the map, or take it off again (`null`). Removing deletes the
 * fields rather than storing a blank, so an older device still reads the
 * record and a merge sees the absence for what it is.
 */
export async function placeStop(
  id: string,
  pos: { lat: number; lng: number } | null,
  expected: Pick<Stop, 'lat' | 'lng'> = {},
): Promise<void> {
  const changed = await db.stops.update(id, (s) => {
    checkDraft(s, expected);
    if (pos) Object.assign(s, pos);
    else {
      delete s.lat;
      delete s.lng;
    }
  });
  if (!changed) throw new Error('This stop was deleted elsewhere. Copy your draft before leaving');
}

/**
 * Delete a stop and the photos taken at it. An off-plan moment linked to it is
 * its own record: it stays, with its link cleared, and keeps its own photos —
 * those are indexed under this stop too, so they are explicitly spared.
 */
export async function deleteStop(id: string): Promise<void> {
  await db.transaction('rw', db.stops, db.photos, db.kv, db.moments, async () => {
    await deletePhotosWhere('stopId', id, (p) => !p.momentId);
    // Its place was this stop's pin, which is going: it keeps no stale one.
    await db.moments
      .where('stopId')
      .equals(id)
      .modify((m) => {
        m.stopId = null;
        delete m.lat;
        delete m.lng;
      });
    await db.stops.delete(id);
  });
}

/** Tick a stop visited (recording when, for the visit order) or un-tick it. */
export async function toggleVisited(stop: Stop, at: number | null = Date.now()): Promise<void> {
  await db.stops.update(stop.id, (s) => {
    s.visited = !s.visited;
    if (s.visited && at != null) s.visitedAt = at;
    else delete s.visitedAt;
  });
}

/** Correct a late marking without changing the planned route. */
export async function setVisitTime(id: string, at: number | null): Promise<void> {
  if (at != null && !Number.isFinite(at)) throw new Error('Enter a valid visit time.');
  const changed = await db.stops.update(id, (s) => {
    if (!s.visited)
      throw new Error('This stop is no longer marked visited. Mark it visited first.');
    if (at == null) delete s.visitedAt;
    else s.visitedAt = at;
  });
  if (!changed) throw new Error('This stop was deleted elsewhere');
}

/** Persist `order` to match the given array order. */
export async function reorderStops(ordered: Stop[]): Promise<void> {
  await db.transaction('rw', db.stops, async () => {
    for (let i = 0; i < ordered.length; i += 1) {
      if (ordered[i].order !== i) await db.stops.update(ordered[i].id, { order: i });
    }
  });
}

/** Move a stop up (-1) or down (+1) within the ordered list. */
export async function moveStop(stops: Stop[], index: number, dir: -1 | 1): Promise<void> {
  const target = index + dir;
  if (target < 0 || target >= stops.length) return;
  const arr = [...stops];
  [arr[index], arr[target]] = [arr[target], arr[index]];
  await reorderStops(arr);
}

export async function addChecklistItem(stop: Stop, text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  const item: ChecklistItem = { id: newId(), text: t, done: false };
  // Checklist writes mutate the stored row, not the caller's possibly stale
  // copy, so quick successive taps can't undo each other.
  await db.stops.update(stop.id, (s) => {
    s.checklist.push(item);
  });
}

export async function toggleChecklistItem(stop: Stop, itemId: string): Promise<void> {
  await db.stops.update(stop.id, (s) => {
    const item = s.checklist.find((c) => c.id === itemId);
    if (item) item.done = !item.done;
  });
}

export async function deleteChecklistItem(stop: Stop, itemId: string): Promise<void> {
  await db.stops.update(stop.id, (s) => {
    s.checklist = s.checklist.filter((c) => c.id !== itemId);
  });
}

export interface Progress {
  done: number;
  total: number;
}

/**
 * A checklist item the plan wrote, marked as such: only an item known to be
 * the plan's own, never ticked, can be retired by a later revision.
 */
export function planItem(item: { text: string; done: boolean }): ChecklistItem {
  return { id: newId(), text: item.text, done: item.done, fromPlan: true };
}

export function checklistProgress(stop: Stop): Progress {
  return { done: stop.checklist.filter((c) => c.done).length, total: stop.checklist.length };
}

/**
 * A trip's legs by name, for matching a plan's `# <City>` blocks to them. A
 * city the trip returns to names every one of its legs: the heading alone
 * can't say which visit it means.
 */
export function cityIds(cities: City[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of cities) {
    const k = c.name.trim().toLowerCase();
    out.set(k, [...(out.get(k) ?? []), c.id]);
  }
  return out;
}

/**
 * How a leg reads in a list of legs: its name, and its place in the trip
 * when another leg has the same name — "Vienna · leg 3". Never a guessed date.
 */
export function legLabel(city: City, cities: City[]): string {
  const name = city.name || 'Unnamed leg';
  const legs = [...cities].sort((a, b) => a.order - b.order);
  const repeats = legs.filter(
    (c) => c.name.trim().toLowerCase() === city.name.trim().toLowerCase(),
  );
  return repeats.length > 1 ? `${name} · leg ${legs.indexOf(city) + 1}` : name;
}

export interface StopCandidate {
  name: string;
  notes: string;
  /** Discovery items parsed from Markdown task lines (`- [ ] …`). */
  checklist: { text: string; done: boolean }[];
  lat?: number;
  lng?: number;
  /** The visit anchor, from labelled lines (Anchor / Minimum visit / Look for / Stretch / Exit rule). */
  guide?: StopGuide;
  /** What must be booked before arriving, from a `Book ahead:` line. */
  bookAhead?: string;
  /** City this stop belongs to, from the plan's `# <City>` heading (multi-city). */
  city?: string;
}

// Section headings that are plan structure, never places.
const NON_STOP =
  /summar|assumption|evidence|character|operating system|strateg|context|insight|reflection|compression|stretch|logistic|food|cost|quality|checklist|overview|introduction|conclusion|itinerary|schedule|timing|transport|budget|booking/i;

const DAY_HEAD = /^day\s*\d+/i;

function cleanName(raw: string): string {
  return raw
    .replace(/^\d+[).:\-–]\s*/, '') // "3) Name" / "3. Name"
    .replace(/^stop\s*\d*[:.\-–]?\s*/i, '') // "Stop 4: Name"
    .replace(/\*\*/g, '')
    .trim();
}

interface ParsedBody {
  notes: string;
  checklist: { text: string; done: boolean }[];
  lat?: number;
  lng?: number;
  guide?: StopGuide;
  /** From a `Book ahead:` line — logistics, so it sits beside the guide. */
  bookAhead?: string;
}

const GUIDE_LABEL =
  /^\s*(?:[-*]\s*)?\**\s*(anchor|minimum(?: viable)? visit|look for|stretch|exit rule|book ahead)\s*\**\s*:\s*\**\s*(.*?)\s*$/i;
const GUIDE_KEY: Record<string, keyof StopGuide> = {
  anchor: 'anchor',
  'minimum visit': 'minimum',
  'minimum viable visit': 'minimum',
  'look for': 'lookFor',
  stretch: 'stretch',
  'exit rule': 'exit',
};

/**
 * Split a stop's body into structured parts:
 *  - `- [ ] …` task lines → tickable discovery-checklist items,
 *  - a `Location: <lat>, <lng>` line → map coordinates,
 *  - bold day/phase markers between stops are dropped,
 *  - everything else stays as notes.
 */
function parseBody(body: string): ParsedBody {
  const checklist: { text: string; done: boolean }[] = [];
  const kept: string[] = [];
  const guide: StopGuide = {};
  let bookAhead: string | undefined;
  let lat: number | undefined;
  let lng: number | undefined;
  // "Look for:" may list its cues on the following bullet lines — indented
  // under it when the label is itself a bullet.
  let collectingCues = false;
  let cueIndent = 0;

  for (const line of body.split(/\r?\n/)) {
    const task = line.match(/^\s*[-*]\s*\[([ xX])\]\s+(.+)$/);
    if (task) {
      collectingCues = false;
      checklist.push({ text: task[2].trim(), done: task[1].trim() !== '' });
      continue;
    }
    const label = line.match(GUIDE_LABEL);
    if (label) {
      const name = label[1].toLowerCase().replace(/\s+/g, ' ');
      const key = GUIDE_KEY[name];
      const value = label[2].replace(/\*+$/, '').trim();
      if (name === 'book ahead') {
        if (value) bookAhead = value;
        collectingCues = false;
      } else if (key === 'lookFor') {
        guide.lookFor = value
          .split(';')
          .map((v) => v.trim().replace(/\.$/, ''))
          .filter(Boolean);
        collectingCues = !value;
        const indent = line.search(/\S/);
        cueIndent = /^\s*[-*]\s/.test(line) ? indent + 1 : indent;
      } else {
        guide[key] = value;
        collectingCues = false;
      }
      continue;
    }
    if (collectingCues) {
      const cue = line.match(/^\s*[-*]\s+(.+)$/);
      if (cue && line.search(/\S/) >= cueIndent) {
        (guide.lookFor ??= []).push(cue[1].trim().replace(/\.$/, ''));
        continue;
      }
      if (line.trim()) collectingCues = false;
    }
    const loc = line.match(
      /^\s*(?:[-*]\s*)?\**location\s*\**\s*:\s*\**\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i,
    );
    if (loc) {
      const la = Number(loc[1]);
      const ln = Number(loc[2]);
      if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
        lat = la;
        lng = ln;
        continue;
      }
    }
    if (/^\s*\*\*day\b.*\*\*\s*$/i.test(line)) continue;
    kept.push(line);
  }

  const hasGuide = Object.values(guide).some((v) => (Array.isArray(v) ? v.length : v));
  return {
    notes: kept.join('\n').trim(),
    checklist,
    lat,
    lng,
    ...(hasGuide ? { guide } : {}),
    ...(bookAhead ? { bookAhead } : {}),
  };
}

function toCandidate(name: string, body: string): StopCandidate {
  const parsed = parseBody(body);
  return {
    name: cleanName(name),
    notes: parsed.notes,
    checklist: parsed.checklist,
    lat: parsed.lat,
    lng: parsed.lng,
    ...(parsed.guide ? { guide: parsed.guide } : {}),
    ...(parsed.bookAhead ? { bookAhead: parsed.bookAhead } : {}),
  };
}

/** Resolve a `# <heading>` to a known city name (longest match), else the raw text. */
function resolveCity(headingText: string, knownCities: string[]): string | undefined {
  return cityOfHeading(headingText, knownCities) ?? (headingText.trim() || undefined);
}

/**
 * Pull stops out of one city block (or the whole doc). Scans EVERY route-ish
 * section — so two full plans pasted together both contribute — and falls back
 * to deeper non-section headings. Each candidate is tagged with `city`.
 */
function extractFromBlock(sections: Section[], city: string | undefined): StopCandidate[] {
  const out: StopCandidate[] = [];

  const routeIdxs: number[] = [];
  sections.forEach((s, i) => {
    if (s.depth <= 2 && /^(?:(?:the|walking)\s+)?(?:route|stops|day-by-day|walk)\b/i.test(s.text))
      routeIdxs.push(i);
  });

  for (const routeIdx of routeIdxs) {
    const routeDepth = sections[routeIdx].depth;
    const inner: Section[] = [];
    for (let i = routeIdx + 1; i < sections.length; i += 1) {
      if (sections[i].depth <= routeDepth) break;
      inner.push(sections[i]);
    }
    // If the route is grouped by day headings with stops nested one level
    // deeper, keep only the deeper (actual stop) level.
    const dayDepths = inner.filter((s) => DAY_HEAD.test(s.text)).map((s) => s.depth);
    const stopLevel = dayDepths.length ? Math.min(...dayDepths) + 1 : null;
    for (const [index, s] of inner.entries()) {
      if (
        DAY_HEAD.test(s.text) ||
        (stopLevel === null && s.depth !== routeDepth + 1) ||
        (stopLevel !== null && s.depth !== stopLevel)
      )
        continue;
      let body = s.body;
      for (let j = index + 1; j < inner.length && inner[j].depth > s.depth; j += 1)
        body += `\n\n${'#'.repeat(inner[j].depth)} ${inner[j].text}\n${inner[j].body}`;
      out.push({ ...toCandidate(s.text, body), city });
    }
  }

  // Fallback: deepest-level headings that don't look like plan sections.
  if (out.length === 0) {
    for (const depth of [3, 2]) {
      const cands = sections
        .filter((s) => s.depth === depth && !NON_STOP.test(s.text) && !DAY_HEAD.test(s.text))
        .map((s) => ({ ...toCandidate(s.text, s.body), city }));
      if (cands.length) {
        out.push(...cands);
        break;
      }
    }
  }

  return out;
}

/**
 * Deterministic stop extraction from the pasted plan — no AI, just structure.
 *
 * Preferred shape (what the research-prompt builder asks Claude for): a
 * `## Route` section where every stop is a `###` heading with its notes below.
 * For multi-city trips the plan is split into `# <City>` blocks (one per city,
 * possibly generated in separate phases and pasted together) and every block is
 * scanned, so no city is ever dropped. Falls back to deeper headings that don't
 * look like plan sections. Misreads are edited by hand.
 */
export function extractStopsFromPlan(
  planText: string,
  knownCities: string[] = [],
): StopCandidate[] {
  const sections = extractSections(planText);
  if (sections.length === 0) return [];

  const candidates: StopCandidate[] = [];

  if (sections.some((s) => s.depth === 1)) {
    // Split into `# <City>` blocks; content before the first h1 is city-less.
    let currentCity: string | undefined;
    let block: Section[] = [];
    const flush = () => {
      if (block.length) candidates.push(...extractFromBlock(block, currentCity));
      block = [];
    };
    for (const s of sections) {
      if (s.depth === 1) {
        flush();
        currentCity = resolveCity(s.text, knownCities);
      } else {
        block.push(s);
      }
    }
    flush();
  } else {
    candidates.push(...extractFromBlock(sections, undefined));
  }

  return candidates.filter((c) => c.name.length > 0);
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * The stop already in the list that a plan candidate is, if any. Same name,
 * and — where the plan says which city — on one of that city's legs: two
 * cities can each have a Duomo, and neither should swallow the other. A stop
 * that doesn't say which leg it is on (added before the trip had legs, or on
 * a single-city trip) can stand for a candidate from any city, but only for
 * one of them: `taken` carries the stops already spoken for. Two equally good
 * stops — a city the trip returns to, with that place on two of its legs —
 * are 'ambiguous': the place is there, but which record it is can't be said.
 */
function matchStop(
  c: StopCandidate,
  existing: Stop[],
  legsByName: Map<string, string[]>,
  taken: Set<string>,
): Stop | 'ambiguous' | undefined {
  // A named city with no leg of that name (deleted, or not a city) matches only places with no leg.
  const legs = c.city ? (legsByName.get(key(c.city)) ?? []) : undefined;
  const named = existing.filter((s) => !taken.has(s.id) && key(s.name) === key(c.name));
  // The stop on the candidate's own leg first; only then one with no leg.
  for (const tier of [
    named.filter((s) => !!legs && !!s.cityId && legs.includes(s.cityId)),
    named.filter((s) => !legs || !s.cityId),
  ]) {
    if (tier.length === 1) return tier[0];
    if (tier.length > 1) return 'ambiguous';
  }
  return undefined;
}

/** Candidates not already present as stops (by name, within their own city). */
export function newStopCandidates(
  planText: string,
  existing: Stop[],
  knownCities: string[] = [],
  cityIdByName: Map<string, string[]> = new Map(),
): StopCandidate[] {
  const taken = new Set<string>();
  return extractStopsFromPlan(planText, knownCities).filter((c) => {
    const match = matchStop(c, existing, cityIdByName, taken);
    if (match && match !== 'ambiguous') taken.add(match.id);
    return !match;
  });
}

/**
 * Stops already in the list whose visit anchor the plan now fills in: only
 * empty guide fields are filled — never a word the traveller wrote.
 */
export function guideBackfill(
  planText: string,
  existing: Stop[],
  knownCities: string[] = [],
  cityIdByName: Map<string, string[]> = new Map(),
) {
  const out: {
    id: string;
    patch: { guide?: StopGuide; bookAhead?: string; lat?: number; lng?: number };
  }[] = [];
  const taken = new Set<string>();
  for (const c of extractStopsFromPlan(planText, knownCities)) {
    const stop = matchStop(c, existing, cityIdByName, taken);
    // Which of two same-named places it means is unknown: fill neither.
    if (!stop || stop === 'ambiguous') continue;
    taken.add(stop.id);
    const patch: { guide?: StopGuide; bookAhead?: string; lat?: number; lng?: number } = {};
    if (stop.lat == null && stop.lng == null && c.lat != null && c.lng != null) {
      patch.lat = c.lat;
      patch.lng = c.lng;
    }
    if (c.guide) {
      const have = stop.guide ?? {};
      const merged: StopGuide = { ...have };
      let changed = false;
      for (const k of Object.keys(c.guide) as (keyof StopGuide)[]) {
        const empty = Array.isArray(have[k]) ? !(have[k] as string[]).length : !have[k];
        if (empty && c.guide[k]) {
          (merged as Record<string, unknown>)[k] = c.guide[k];
          changed = true;
        }
      }
      if (changed) patch.guide = merged;
    }
    // A re-researched plan may now say a place has to be booked. Filling an
    // empty field adds the obligation; it never overwrites what was written.
    if (c.bookAhead && !stop.bookAhead?.trim()) patch.bookAhead = c.bookAhead;
    if (Object.keys(patch).length) out.push({ id: stop.id, patch });
  }
  return out;
}

/**
 * Import the not-yet-present candidates as stops (with notes, anchor and
 * city), and fill empty anchors on stops already there. Returns how many
 * stops were added.
 */
export async function importStopsFromPlan(
  tripId: string,
  planText: string,
  existing: Stop[],
  cities: City[] = [],
): Promise<number> {
  return db.transaction('rw', db.stops, async () => {
    existing = await db.stops.where('tripId').equals(tripId).toArray();
    const names = cities.map((c) => c.name);
    const cityIdByName = cityIds(cities);
    const fresh = newStopCandidates(planText, existing, names, cityIdByName);
    const backfill = guideBackfill(planText, existing, names, cityIdByName);
    for (const b of backfill) await db.stops.update(b.id, b.patch);
    if (fresh.length === 0) return 0;

    // After every stored position: a count can repeat one when an order has gaps.
    const base = Math.max(-1, ...existing.map((s) => s.order)) + 1;
    const now = Date.now();
    const legOf = (c: StopCandidate) => {
      // One leg of that name, or none: a city the trip returns to can't say which visit.
      const legs = c.city ? cityIdByName.get(key(c.city)) : undefined;
      return legs?.length === 1 ? legs[0] : null;
    };
    const rows: Stop[] = fresh.map((c, i) => ({
      id: newId(),
      tripId,
      cityId: legOf(c),
      name: c.name,
      planSource: c,
      notes: c.notes,
      checklist: c.checklist.map(planItem),
      visited: false,
      lat: c.lat,
      lng: c.lng,
      ...(c.guide ? { guide: c.guide } : {}),
      ...(c.bookAhead ? { bookAhead: c.bookAhead } : {}),
      order: base + i,
      createdAt: now,
    }));

    await db.stops.bulkAdd(rows);
    return rows.length;
  });
}
