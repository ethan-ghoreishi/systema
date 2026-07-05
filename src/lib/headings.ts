/**
 * Pure Markdown heading parsing. Used for the Plan tab's auto contents list and
 * (later) the optional deterministic "split plan into stops by heading" helper.
 * No AI, no library — just heading lines, skipping fenced code blocks.
 */

export interface Heading {
  depth: number; // 1–6
  text: string;
  slug: string;
}

/** GitHub-style slug, de-duplicated against `used`. */
export function slugify(text: string, used: Set<string>): string {
  let base = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'section';

  let slug = base;
  let n = 1;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

export interface Section extends Heading {
  /** Text between this heading and the next heading (any depth), trimmed. */
  body: string;
}

/**
 * Split the document into heading-delimited sections, each carrying the text
 * that follows it (up to the next heading). Fenced code is ignored for
 * heading detection but kept in bodies.
 */
export function extractSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const used = new Set<string>();
  const out: Section[] = [];
  let current: Section | null = null;
  let buf: string[] = [];

  let inFence = false;
  let fenceMarker = '';

  const flush = () => {
    if (current) {
      current.body = buf.join('\n').trim();
      out.push(current);
    }
    buf = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      buf.push(line);
      continue;
    }

    const m = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      flush();
      const depth = m[1].length;
      const text = m[2].trim();
      current = { depth, text, slug: slugify(text, used), body: '' };
    } else {
      buf.push(line);
    }
  }
  flush();

  return out;
}

export interface PlanSegment {
  city: string;
  text: string;
}

/**
 * Split a plan into per-city segments on level-1 (`# City`) headings — the
 * shape the multi-city research prompt asks for (one self-contained plan per
 * city). Fenced code is ignored. Returns [] when there are no `#` headings, so
 * single-city plans render whole and unchanged.
 */
export function splitPlanByCity(markdown: string): PlanSegment[] {
  const lines = markdown.split(/\r?\n/);
  const segments: PlanSegment[] = [];
  let current: PlanSegment | null = null;
  const pre: string[] = [];

  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
    }

    const h1 = !inFence && line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (h1) {
      if (current) segments.push(current);
      current = { city: h1[1].trim(), text: line };
    } else if (current) {
      current.text += `\n${line}`;
    } else {
      pre.push(line);
    }
  }
  if (current) segments.push(current);
  if (segments.length === 0) return [];
  // Don't lose any content that appeared before the first city heading.
  if (pre.join('').trim()) segments[0].text = `${pre.join('\n')}\n${segments[0].text}`;
  return segments;
}

/** Extract ATX (`#`-style) headings, ignoring anything inside fenced code. */
export function extractHeadings(markdown: string): Heading[] {
  const lines = markdown.split(/\r?\n/);
  const used = new Set<string>();
  const out: Heading[] = [];

  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const depth = m[1].length;
      const text = m[2].trim();
      out.push({ depth, text, slug: slugify(text, used) });
    }
  }

  return out;
}
