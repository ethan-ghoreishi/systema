import { describe, it, expect } from 'vitest';
import { checklistProgress, extractStopsFromPlan, newStopCandidates } from '../../src/lib/stops';
import type { Stop } from '../../src/lib/db';

function stop(over: Partial<Stop> = {}): Stop {
  return {
    id: 's',
    tripId: 't',
    cityId: null,
    name: 'X',
    notes: '',
    checklist: [],
    visited: false,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

describe('checklistProgress', () => {
  it('counts done/total', () => {
    const s = stop({
      checklist: [
        { id: 'a', text: 't', done: true },
        { id: 'b', text: 't', done: false },
        { id: 'c', text: 't', done: true },
      ],
    });
    expect(checklistProgress(s)).toEqual({ done: 2, total: 3 });
    expect(checklistProgress(stop())).toEqual({ done: 0, total: 0 });
  });
});

describe('extractStopsFromPlan', () => {
  const promptShapedPlan = [
    '# Copenhagen',
    '## Executive summary',
    '- bullets',
    '## Route',
    '**Day 1 - morning**',
    '### Carlsberg Laboratory',
    '- welfare-state instinct in private form',
    '- contrast: Guinness philanthropy stayed partial',
    '### The harbour baths',
    "- water's edge public by default",
    '**Day 2**',
    '### Superkilen',
    '- imported objects as civic statement',
    '## Cultural insight moments',
    '### Not a stop',
    'text',
  ].join('\n');

  it('takes ### stops under the Route section only, with notes, skipping day markers', () => {
    const got = extractStopsFromPlan(promptShapedPlan);
    expect(got.map((s) => s.name)).toEqual([
      'Carlsberg Laboratory',
      'The harbour baths',
      'Superkilen',
    ]);
    expect(got[0].notes).toContain('welfare-state instinct');
    expect(got[1].notes).toContain("water's edge");
    // Bold day markers between stops must not leak into notes.
    expect(got[1].notes).not.toMatch(/\*\*Day/i);
  });

  it('handles day headings nested above stop headings', () => {
    const md = [
      '## Route',
      '### Day 1',
      '#### Kastellet',
      'star fort',
      '#### Nyboder',
      'naval rows',
      '### Day 2',
      '#### Superkilen',
      'imported objects',
    ].join('\n');
    expect(extractStopsFromPlan(md).map((s) => s.name)).toEqual([
      'Kastellet',
      'Nyboder',
      'Superkilen',
    ]);
  });

  it('falls back to depth-3 headings, filtering plan-section names and numbering', () => {
    const md = [
      '### 1) Executive summary',
      'x',
      '### Carlsberg Laboratory',
      'notes here',
      '### Food plan',
      'y',
    ].join('\n');
    const got = extractStopsFromPlan(md);
    expect(got.map((s) => s.name)).toEqual(['Carlsberg Laboratory']);
    expect(got[0].notes).toBe('notes here');
  });

  it('falls back to depth-2 headings when nothing deeper exists', () => {
    const md = '# City\n## Kastellet\nfort\n## Cost estimate\nnumbers';
    expect(extractStopsFromPlan(md).map((s) => s.name)).toEqual(['Kastellet']);
  });

  it('returns empty for prose without headings', () => {
    expect(extractStopsFromPlan('just some prose, no structure')).toEqual([]);
  });
});

describe('newStopCandidates', () => {
  it('drops candidates already present by name (case-insensitive)', () => {
    const md = '## Route\n### Kastellet\nx\n### Superkilen\ny';
    const existing = [stop({ name: 'kastellet' })];
    expect(newStopCandidates(md, existing).map((s) => s.name)).toEqual(['Superkilen']);
  });
});
