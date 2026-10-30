import { db, type ChecklistItem, type City, type Stop, type StopGuide } from './db';
import { newId } from './ids';
import { cityOfHeading, extractSections, type Section } from './headings';
import { alignToStop } from './moments';
import { deletePhotosWhere } from './photos';

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
  if (!('cityId' in patch)) {
    await db.stops.update(id, patch);
    return;
  }
  // The moments that are part of this stop move legs with it, so a moment is
  // never left saying it belongs to one leg while its stop belongs to another.
  await db.transaction('rw', db.stops, db.moments, async () => {
    await db.stops.update(id, patch);
    const stop = await db.stops.get(id);
    if (stop)
      await db.moments
        .where('stopId')
        .equals(id)
        .modify((m) => alignToStop(m, stop));
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
): Promise<void> {
  await db.stops.update(id, (s) => {
    if (pos) Object.assign(s, pos);
    else {
      delete s.lat;
      delete s.lng;
    }
  });
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
export async function toggleVisited(stop: Stop): Promise<void> {
  await db.stops.update(stop.id, (s) => {
    s.visited = !s.visited;
    if (s.visited) s.visitedAt = Date.now();
    else delete s.visitedAt;
  });
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

export function checklistProgress(stop: Stop): Progress {
  return { done: stop.checklist.filter((c) => c.done).length, total: stop.checklist.length };
}

/** A trip's legs by name, for matching a plan's `# <City>` blocks to them. */
export function cityIds(cities: City[]): Map<string, string> {
  return new Map(cities.map((c) => [c.name.trim().toLowerCase(), c.id]));
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
}

const GUIDE_LABEL =
  /^\s*(?:[-*]\s*)?\**\s*(anchor|minimum(?: viable)? visit|look for|stretch|exit rule)\s*\**\s*:\s*\**\s*(.*?)\s*$/i;
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
      const key = GUIDE_KEY[label[1].toLowerCase().replace(/\s+/g, ' ')];
      const value = label[2].replace(/\*+$/, '').trim();
      if (key === 'lookFor') {
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

  const hasGuide = Object.values(guide).some((v) => (Array.isArray(v) ? v.length : v));
  return {
    notes: kept.join('\n').trim(),
    checklist,
    lat,
    lng,
    ...(hasGuide ? { guide } : {}),
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

const key = (name: string) => name.trim().toLowerCase();

/**
 * The stop already in the list that a plan candidate is, if any. Same name,
 * and — where both sides say which city they are in — the same city: two
 * cities can each have a Duomo, and neither should swallow the other. A stop
 * that doesn't say which city it is in (added before the trip had legs, or on
 * a single-city trip) can stand for a candidate from any city, but only for
 * one of them: `taken` carries the stops already spoken for, so a lone
 * unassigned "Duomo" no longer makes both cities' Duomos look present.
 */
function matchStop(
  c: StopCandidate,
  existing: Stop[],
  cityIdByName: Map<string, string>,
  taken: Set<string>,
): Stop | undefined {
  const want = c.city ? cityIdByName.get(key(c.city)) : undefined;
  const named = existing.filter((s) => !taken.has(s.id) && key(s.name) === key(c.name));
  // The stop in the candidate's own city first; only then one with no city.
  return (
    named.find((s) => !!want && s.cityId === want) ??
    named.find((s) => !want || !s.cityId) ??
    undefined
  );
}

/** Candidates not already present as stops (by name, within their own city). */
export function newStopCandidates(
  planText: string,
  existing: Stop[],
  knownCities: string[] = [],
  cityIdByName: Map<string, string> = new Map(),
): StopCandidate[] {
  const taken = new Set<string>();
  return extractStopsFromPlan(planText, knownCities).filter((c) => {
    const match = matchStop(c, existing, cityIdByName, taken);
    if (match) taken.add(match.id);
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
  cityIdByName: Map<string, string> = new Map(),
) {
  const out: { id: string; guide: StopGuide }[] = [];
  const taken = new Set<string>();
  for (const c of extractStopsFromPlan(planText, knownCities)) {
    const stop = matchStop(c, existing, cityIdByName, taken);
    if (stop) taken.add(stop.id);
    if (!stop || !c.guide) continue;
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
    if (changed) out.push({ id: stop.id, guide: merged });
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
  const names = cities.map((c) => c.name);
  const cityIdByName = cityIds(cities);
  const fresh = newStopCandidates(planText, existing, names, cityIdByName);
  const backfill = guideBackfill(planText, existing, names, cityIdByName);
  for (const b of backfill) await db.stops.update(b.id, { guide: b.guide });
  if (fresh.length === 0) return 0;

  const base = await db.stops.where('tripId').equals(tripId).count();
  const now = Date.now();
  const rows: Stop[] = fresh.map((c, i) => ({
    id: newId(),
    tripId,
    cityId: c.city ? (cityIdByName.get(key(c.city)) ?? null) : null,
    name: c.name,
    notes: c.notes,
    checklist: c.checklist.map((item) => ({ id: newId(), text: item.text, done: item.done })),
    visited: false,
    lat: c.lat,
    lng: c.lng,
    ...(c.guide ? { guide: c.guide } : {}),
    order: base + i,
    createdAt: now,
  }));

  await db.stops.bulkAdd(rows);
  return rows.length;
}
