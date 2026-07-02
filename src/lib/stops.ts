import { db, type ChecklistItem, type Stop } from './db';
import { newId } from './ids';
import { extractSections } from './headings';

/** Stop + checklist mutations over Dexie. */

export async function addStop(
  tripId: string,
  name: string,
  cityId: string | null = null,
): Promise<string> {
  const order = await db.stops.where('tripId').equals(tripId).count();
  const id = newId();
  const stop: Stop = {
    id,
    tripId,
    cityId,
    name: name.trim(),
    notes: '',
    checklist: [],
    visited: false,
    order,
    createdAt: Date.now(),
  };
  await db.stops.add(stop);
  return id;
}

export async function updateStop(id: string, patch: Partial<Stop>): Promise<void> {
  await db.stops.update(id, patch);
}

export async function deleteStop(id: string): Promise<void> {
  await db.transaction('rw', db.stops, db.photos, async () => {
    await db.photos.where('stopId').equals(id).delete();
    await db.stops.delete(id);
  });
}

export async function toggleVisited(stop: Stop): Promise<void> {
  await db.stops.update(stop.id, { visited: !stop.visited });
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
  await db.stops.update(stop.id, { checklist: [...stop.checklist, item] });
}

export async function toggleChecklistItem(stop: Stop, itemId: string): Promise<void> {
  const checklist = stop.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
  await db.stops.update(stop.id, { checklist });
}

export async function deleteChecklistItem(stop: Stop, itemId: string): Promise<void> {
  await db.stops.update(stop.id, { checklist: stop.checklist.filter((c) => c.id !== itemId) });
}

export interface Progress {
  done: number;
  total: number;
}

export function checklistProgress(stop: Stop): Progress {
  return { done: stop.checklist.filter((c) => c.done).length, total: stop.checklist.length };
}

export interface StopCandidate {
  name: string;
  notes: string;
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

/** Drop bold day/phase markers (e.g. "**Day 2**") that sit between stops. */
function cleanNotes(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^\s*\*\*day\b.*\*\*\s*$/i.test(line))
    .join('\n')
    .trim();
}

/**
 * Deterministic stop extraction from the pasted plan — no AI, just structure.
 *
 * Preferred shape (what the research-prompt builder asks Claude for): a
 * `## Route` section where every stop is a `###` heading with its notes below.
 * Falls back to any deeper headings that don't look like plan sections. Each
 * stop carries the text under its heading as notes. Misreads are edited by hand.
 */
export function extractStopsFromPlan(planText: string): StopCandidate[] {
  const sections = extractSections(planText);
  if (sections.length === 0) return [];

  // 1) Look for a route-ish section and take the deeper headings inside it.
  const routeIdx = sections.findIndex((s) => /route|stops|day-by-day|walk/i.test(s.text));
  let candidates: StopCandidate[] = [];

  if (routeIdx !== -1) {
    const routeDepth = sections[routeIdx].depth;
    const inner: { depth: number; name: string; notes: string }[] = [];
    for (let i = routeIdx + 1; i < sections.length; i += 1) {
      const s = sections[i];
      if (s.depth <= routeDepth) break;
      inner.push({ depth: s.depth, name: s.text, notes: s.body });
    }
    // If the route is grouped by day headings with stops nested one level
    // deeper, keep only the deeper (actual stop) level.
    const dayDepths = inner.filter((s) => DAY_HEAD.test(s.name)).map((s) => s.depth);
    const stopLevel = dayDepths.length ? Math.min(...dayDepths) + 1 : null;
    candidates = inner
      .filter((s) => !DAY_HEAD.test(s.name))
      .filter((s) => (stopLevel === null ? true : s.depth >= stopLevel))
      .map((s) => ({ name: cleanName(s.name), notes: cleanNotes(s.notes) }));
  }

  // 2) Fallback: deepest-level headings that don't look like plan sections.
  if (candidates.length === 0) {
    for (const depth of [3, 2]) {
      candidates = sections
        .filter((s) => s.depth === depth && !NON_STOP.test(s.text) && !DAY_HEAD.test(s.text))
        .map((s) => ({ name: cleanName(s.text), notes: cleanNotes(s.body) }));
      if (candidates.length > 0) break;
    }
  }

  return candidates.filter((c) => c.name.length > 0);
}

/** Candidates not already present as stops (case-insensitive name match). */
export function newStopCandidates(planText: string, existing: Stop[]): StopCandidate[] {
  const have = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  return extractStopsFromPlan(planText).filter((c) => !have.has(c.name.trim().toLowerCase()));
}

/** Import the not-yet-present candidates as stops (with notes). Returns count added. */
export async function importStopsFromPlan(
  tripId: string,
  planText: string,
  existing: Stop[],
): Promise<number> {
  const fresh = newStopCandidates(planText, existing);
  if (fresh.length === 0) return 0;

  const base = await db.stops.where('tripId').equals(tripId).count();
  const now = Date.now();
  const rows: Stop[] = fresh.map((c, i) => ({
    id: newId(),
    tripId,
    cityId: null,
    name: c.name,
    notes: c.notes,
    checklist: [],
    visited: false,
    order: base + i,
    createdAt: now,
  }));

  await db.stops.bulkAdd(rows);
  return rows.length;
}
