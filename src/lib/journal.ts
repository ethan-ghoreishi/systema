/**
 * Journal photo placeholders.
 *
 * Photos can't travel through a copy-paste prompt, so the journaling prompt
 * asks Claude to mark where each photograph belongs with a line of the form
 * `[photo: <stop name>]`. When the journal is pasted back and rendered, those
 * placeholders are swapped for the real photographs stored on the device —
 * matched by stop name, consumed in the order they were taken.
 *
 * Pure module: parsing only, no DOM, no db.
 */

export type JournalSegment = { kind: 'md'; text: string } | { kind: 'photo'; stopName: string };

const PLACEHOLDER = /^\s*!?\[photo:\s*(.+?)\]\s*$/i;

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
      out.push({ kind: 'photo', stopName: m[1].trim() });
    } else {
      buf.push(line);
    }
  }
  flush();

  return out;
}

/**
 * Assign real photos to placeholders. Photos are grouped per stop name
 * (case-insensitive) and consumed in capture order; placeholders with no
 * remaining photo resolve to null (rendered as nothing). Returns the
 * assignment plus the photos never referenced, for a trailing gallery.
 */
export function assignPhotos<P extends { id: string; createdAt: number }>(
  segments: JournalSegment[],
  photosByStopName: Record<string, P[]>,
): { photoForSegment: (P | null)[]; leftovers: P[] } {
  // Work on sorted copies so consumption order is capture order.
  const queues: Record<string, P[]> = {};
  for (const [name, list] of Object.entries(photosByStopName)) {
    queues[name.trim().toLowerCase()] = [...list].sort((a, b) => a.createdAt - b.createdAt);
  }

  const photoForSegment: (P | null)[] = segments.map((seg) => {
    if (seg.kind !== 'photo') return null;
    return queues[seg.stopName.trim().toLowerCase()]?.shift() ?? null;
  });

  const leftovers = Object.values(queues).flat();
  return { photoForSegment, leftovers };
}
