import { describe, it, expect } from 'vitest';
import { checklistProgress, splittableHeadingCount } from '../../src/lib/stops';
import type { Stop } from '../../src/lib/db';

function stop(done: boolean[]): Stop {
  return {
    id: 's',
    tripId: 't',
    cityId: null,
    name: 'X',
    notes: '',
    checklist: done.map((d, i) => ({ id: `i${i}`, text: 't', done: d })),
    visited: false,
    order: 0,
    createdAt: 0,
  };
}

describe('checklistProgress', () => {
  it('counts done/total', () => {
    expect(checklistProgress(stop([true, false, true]))).toEqual({ done: 2, total: 3 });
    expect(checklistProgress(stop([]))).toEqual({ done: 0, total: 0 });
  });
});

describe('splittableHeadingCount', () => {
  it('counts depth 2–3 headings only', () => {
    const md = '# City\n## Route\n### Stop A\n### Stop B\n#### too deep\n';
    expect(splittableHeadingCount(md)).toBe(3);
  });
  it('is zero with only an h1 title', () => {
    expect(splittableHeadingCount('# Only title')).toBe(0);
  });
});
