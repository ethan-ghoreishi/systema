/**
 * Journal photo placeholders.
 *
 * Photos can't travel through a copy-paste prompt, so the journaling prompt
 * lists them with stable references and asks Claude to mark where each one
 * belongs with a line `[photo: P-3f9a1c]` (longer where six hex digits would
 * be shared by two photos). When the journal is pasted back and rendered, the
 * placeholders are swapped for the real photographs on the device — matched by
 * reference, so two stops with the same name, or an off-plan moment, can't
 * take each other's photos. A reference is a prefix of the photo's id, so one
 * written before a set needed longer references still resolves. Journals
 * written before references used `[photo: <stop name>]`; those still resolve
 * by name, in capture order.
 *
 * Pure module: parsing only, no DOM, no db.
 */

import { photoTime } from './photos';

export type JournalSegment = { kind: 'md'; text: string } | { kind: 'photo'; ref: string };

const PLACEHOLDER = /^\s*!?\[photo:\s*(.+?)\]\s*$/i;
// Six hex digits, or more where six would have been ambiguous (see photoRefs).
const REF = /^P-([0-9a-f]{6,32})$/i;

/** Split journal text into markdown chunks and photo placeholders. */
export function splitJournal(text: string): JournalSegment[] {
  const out: JournalSegment[] = [];
  let buf: string[] = [];

  const flush = () => {
    const md = buf.join('\n').trim();
    if (md) out.push({ kind: 'md', text: md });
    buf = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(PLACEHOLDER);
    if (m) {
      flush();
      out.push({ kind: 'photo', ref: m[1].trim() });
    } else {
      buf.push(line);
    }
  }
  flush();

  return out;
}

type JournalPhoto = { id: string; createdAt: number; takenAt?: number };

/**
 * Assign real photos to placeholders: by reference, or (older journals) by
 * the place's name, consuming that place's photos in capture order. A
 * placeholder with no photo left resolves to null (rendered as nothing).
 * Returns the assignment plus the photos never placed, for a gallery.
 */
export function assignPhotos<P extends JournalPhoto>(
  segments: JournalSegment[],
  photos: P[],
  placeOf: (p: P) => string,
): { photoForSegment: (P | null)[]; leftovers: P[] } {
  const ordered = [...photos].sort((a, b) => photoTime(a) - photoTime(b));
  const used = new Set<string>();
  const take = (p: P | undefined) => {
    if (!p) return null;
    used.add(p.id);
    return p;
  };

  const photoForSegment = segments.map((seg) => {
    if (seg.kind !== 'photo') return null;
    const ref = seg.ref.match(REF);
    if (ref) {
      // A reference is a prefix of the id's hex digits, so a six-digit one
      // from an older journal still finds a photo now referenced by twelve.
      const want = ref[1].toLowerCase();
      const matches = ordered.filter(
        (p) => !used.has(p.id) && p.id.replace(/-/g, '').toLowerCase().startsWith(want),
      );
      // A six-digit reference written before a later photo happened to share
      // those digits now matches both. The one it meant is the one that was
      // already here when it was written: the first added.
      if (matches.length > 1) matches.sort((a, b) => a.createdAt - b.createdAt);
      return take(matches[0]);
    }
    const name = seg.ref.toLowerCase();
    return take(ordered.find((p) => !used.has(p.id) && placeOf(p).trim().toLowerCase() === name));
  });

  return { photoForSegment, leftovers: ordered.filter((p) => !used.has(p.id)) };
}
