import { describe, it, expect } from 'vitest';
import { extractHeadings, slugify } from '../../src/lib/headings';

describe('slugify', () => {
  it('slugs and de-duplicates', () => {
    const used = new Set<string>();
    expect(slugify('Operating System', used)).toBe('operating-system');
    expect(slugify('Operating System', used)).toBe('operating-system-1');
  });

  it('strips punctuation and falls back for empties', () => {
    const used = new Set<string>();
    expect(slugify('Food & Cost — Estimate!', used)).toBe('food-cost-estimate');
    expect(slugify('!!!', used)).toBe('section');
  });
});

describe('extractHeadings', () => {
  it('extracts ATX headings with depth and slug', () => {
    const md = '# Title\n\nintro\n\n## Operating System\n\ntext\n\n### Route\n';
    expect(extractHeadings(md).map((h) => [h.depth, h.text, h.slug])).toEqual([
      [1, 'Title', 'title'],
      [2, 'Operating System', 'operating-system'],
      [3, 'Route', 'route'],
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Real\n\n```\n# Not a heading\n```\n\n## Also real';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Real', 'Also real']);
  });

  it('strips trailing hashes', () => {
    expect(extractHeadings('## Heading ##')[0].text).toBe('Heading');
  });
});
