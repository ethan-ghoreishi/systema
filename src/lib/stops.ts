import { db, type ChecklistItem, type City, type Stop } from './db';
import { newId } from './ids';
import { extractSections, type Section } from './headings';

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
  /** Discovery items parsed from Markdown task lines (`- [ ] …`). */
  checklist: { text: string; done: boolean }[];
  lat?: number;
  lng?: number;
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
}

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
  let lat: number | undefined;
  let lng: number | undefined;

  for (const line of body.split(/\r?\n/)) {
    const task = line.match(/^\s*[-*]\s*\[([ xX])\]\s+(.+)$/);
    if (task) {
      checklist.push({ text: task[2].trim(), done: task[1].trim() !== '' });
      continue;
    }
    const loc = line.match(
      /^\s*(?:[-*]\s*)?\**location\**[:\s]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i,
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

  return { notes: kept.join('\n').trim(), checklist, lat, lng };
}

function toCandidate(name: string, body: string): StopCandidate {
  const parsed = parseBody(body);
  return {
    name: cleanName(name),
    notes: parsed.notes,
    checklist: parsed.checklist,
    lat: parsed.lat,
    lng: parsed.lng,
  };
}

/** Resolve a `# <heading>` to a known city name (longest match), else the raw text. */
function resolveCity(headingText: string, knownCities: string[]): string | undefined {
  const t = headingText.toLowerCase();
  let best: string | undefined;
  for (const c of knownCities) {
    const name = c.trim();
    if (name && t.includes(name.toLowerCase()) && (!best || name.length > best.length)) {
      best = name;
    }
  }
  return best ?? (headingText.trim() || undefined);
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
    if (/route|stops|day-by-day|walk/i.test(s.text)) routeIdxs.push(i);
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
    for (const s of inner) {
      if (DAY_HEAD.test(s.text)) continue;
      if (stopLevel !== null && s.depth < stopLevel) continue;
      out.push({ ...toCandidate(s.text, s.body), city });
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

/** Candidates not already present as stops (case-insensitive name match). */
export function newStopCandidates(
  planText: string,
  existing: Stop[],
  knownCities: string[] = [],
): StopCandidate[] {
  const have = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  return extractStopsFromPlan(planText, knownCities).filter(
    (c) => !have.has(c.name.trim().toLowerCase()),
  );
}

/** Import the not-yet-present candidates as stops (with notes + city). Returns count added. */
export async function importStopsFromPlan(
  tripId: string,
  planText: string,
  existing: Stop[],
  cities: City[] = [],
): Promise<number> {
  const fresh = newStopCandidates(
    planText,
    existing,
    cities.map((c) => c.name),
  );
  if (fresh.length === 0) return 0;

  const cityIdByName = new Map(cities.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const base = await db.stops.where('tripId').equals(tripId).count();
  const now = Date.now();
  const rows: Stop[] = fresh.map((c, i) => ({
    id: newId(),
    tripId,
    cityId: c.city ? (cityIdByName.get(c.city.trim().toLowerCase()) ?? null) : null,
    name: c.name,
    notes: c.notes,
    checklist: c.checklist.map((item) => ({ id: newId(), text: item.text, done: item.done })),
    visited: false,
    lat: c.lat,
    lng: c.lng,
    order: base + i,
    createdAt: now,
  }));

  await db.stops.bulkAdd(rows);
  return rows.length;
}
