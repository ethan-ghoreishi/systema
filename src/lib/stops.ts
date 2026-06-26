import { db, type ChecklistItem, type Stop } from './db';
import { newId } from './ids';
import { extractHeadings } from './headings';

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

/**
 * Deterministic "split plan into stops by heading" — no AI. Creates one stop per
 * sub-heading (depth 2–3) of the pasted plan. Misparses are edited by hand.
 */
export async function splitPlanIntoStops(tripId: string, planText: string): Promise<number> {
  const headings = extractHeadings(planText).filter((h) => h.depth >= 2 && h.depth <= 3);
  if (headings.length === 0) return 0;

  const base = await db.stops.where('tripId').equals(tripId).count();
  const now = Date.now();
  const rows: Stop[] = headings.map((h, i) => ({
    id: newId(),
    tripId,
    cityId: null,
    name: h.text,
    notes: '',
    checklist: [],
    visited: false,
    order: base + i,
    createdAt: now,
  }));

  await db.stops.bulkAdd(rows);
  return rows.length;
}

/** How many sub-headings a split would produce (for the button label/visibility). */
export function splittableHeadingCount(planText: string): number {
  return extractHeadings(planText).filter((h) => h.depth >= 2 && h.depth <= 3).length;
}
