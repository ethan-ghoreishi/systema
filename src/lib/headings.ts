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
