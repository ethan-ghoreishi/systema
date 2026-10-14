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

/** Split on level-1 (`# City`) headings: what precedes them, and each block. */
function splitByH1(markdown: string): { pre: string; segments: PlanSegment[] } {
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
  return { pre: pre.join('\n'), segments };
}

/**
 * Split a plan into per-city segments on level-1 (`# City`) headings — the
 * shape the multi-city research prompt asks for (one self-contained plan per
 * city). Fenced code is ignored. Returns [] when there are no `#` headings, so
 * single-city plans render whole and unchanged.
 */
export function splitPlanByCity(markdown: string): PlanSegment[] {
  const { pre, segments } = splitByH1(markdown);
  if (segments.length === 0) return [];
  // Don't lose any content that appeared before the first city heading.
  if (pre.trim()) segments[0].text = `${pre}\n${segments[0].text}`;
  return segments;
}

/**
 * Which known city a `# heading` names (longest match, so "Bologna Centrale"
 * isn't taken for "Bologna" when both are legs); undefined if none.
 */
export function cityOfHeading(heading: string, cityNames: string[]): string | undefined {
  const t = heading.toLowerCase();
  let best: string | undefined;
  for (const c of cityNames) {
    const name = c.trim();
    if (name && t.includes(name.toLowerCase()) && (!best || name.length > best.length)) best = name;
  }
  return best;
}

/** The `# City` block for `city` in a plan, if there is one. */
export function cityBlock(planText: string, city: string, cityNames: string[]): string | undefined {
  return splitByH1(planText).segments.find(
    (s) => cityOfHeading(s.city, cityNames)?.toLowerCase() === city.trim().toLowerCase(),
  )?.text;
}

/**
 * Put one city's plan into the trip plan: replacing that city's `# City`
 * block if there is one, else inserting it in itinerary order (`order`: the
 * legs' city names). The pasted text is made to start with a `# City`
 * heading, so the city filter and stop extraction always find it. Anything
 * else in the plan — other cities, an overview above them — is kept.
 */
export function replaceCityBlock(
  planText: string,
  city: string,
  pasted: string,
  order: string[],
): string {
  const name = city.trim();
  let block = pasted.trim();
  const first = block.match(/^#\s+(.+?)\s*#*\s*$/m);
  const startsWithH1 = !!first && block.indexOf(first[0]) === block.search(/\S/);
  if (!startsWithH1) block = `# ${name}\n\n${block}`;
  else if (!first![1].toLowerCase().includes(name.toLowerCase()))
    block = block.replace(first![0], `# ${name} — ${first![1]}`);

  const { pre, segments } = splitByH1(planText);
  const key = (heading: string) => cityOfHeading(heading, order)?.toLowerCase();
  const target = name.toLowerCase();
  const rank = (heading: string) => {
    const k = key(heading);
    const i = order.findIndex((c) => c.trim().toLowerCase() === k);
    return i < 0 ? Infinity : i;
  };
  const mine = order.findIndex((c) => c.trim().toLowerCase() === target);
  const out = segments.filter((s) => key(s.city) !== target).map((s) => s.text.trim());
  const at = segments
    .filter((s) => key(s.city) !== target)
    .findIndex((s) => rank(s.city) > (mine < 0 ? Infinity : mine));
  out.splice(at < 0 ? out.length : at, 0, block);
  return [pre.trim(), ...out].filter(Boolean).join('\n\n') + '\n';
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
