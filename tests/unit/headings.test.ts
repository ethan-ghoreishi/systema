import { describe, it, expect } from 'vitest';
import { extractHeadings, extractSections, slugify, splitPlanByCity } from '../../src/lib/headings';

describe('splitPlanByCity', () => {
  it('splits a two-city plan on level-1 headings', () => {
    const md = '# Barcelona\n## Route\n### Sagrada\n# Bologna\n## Route\n### Towers';
    const segs = splitPlanByCity(md);
    expect(segs.map((s) => s.city)).toEqual(['Barcelona', 'Bologna']);
    expect(segs[0].text).toContain('Sagrada');
    expect(segs[1].text).toContain('Towers');
    expect(segs[0].text).not.toContain('Bologna');
  });

  it('returns [] when there are no level-1 headings', () => {
    expect(splitPlanByCity('## Route\n### Stop')).toEqual([]);
  });

  it('ignores # inside fenced code', () => {
    const md = '# Rome\n```\n# not a city\n```\ntext';
    expect(splitPlanByCity(md).map((s) => s.city)).toEqual(['Rome']);
  });
});

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

describe('extractSections', () => {
  it('attaches the body text between headings', () => {
    const md = '## A\nline one\nline two\n### B\ninner\n## C';
    const sections = extractSections(md);
    expect(sections.map((s) => [s.depth, s.text, s.body])).toEqual([
      [2, 'A', 'line one\nline two'],
      [3, 'B', 'inner'],
      [2, 'C', ''],
    ]);
  });

  it('keeps fenced code in bodies without treating it as headings', () => {
    const md = '## A\n```\n# not a heading\n```\ntail';
    const sections = extractSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain('# not a heading');
    expect(sections[0].body).toContain('tail');
  });
});
