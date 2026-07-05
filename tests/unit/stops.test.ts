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

  it('pulls checkbox lines into a discovery checklist and Location into coordinates', () => {
    const md = [
      '## Route',
      '### Carlsberg Laboratory',
      '- welfare-state instinct in private form',
      '- [ ] find the Laboratorium inscription',
      '- [x] spot the founder statue',
      'Location: 55.6652, 12.5306',
      '### The harbour baths',
      "- water's edge public by default",
    ].join('\n');
    const [carls, baths] = extractStopsFromPlan(md);

    expect(carls.checklist).toEqual([
      { text: 'find the Laboratorium inscription', done: false },
      { text: 'spot the founder statue', done: true },
    ]);
    expect(carls.lat).toBeCloseTo(55.6652);
    expect(carls.lng).toBeCloseTo(12.5306);
    // Checklist + Location lines are stripped out of the notes.
    expect(carls.notes).toBe('- welfare-state instinct in private form');

    expect(baths.checklist).toEqual([]);
    expect(baths.lat).toBeUndefined();
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

  it('extracts stops from BOTH cities of a two-plan multi-city paste', () => {
    // Two self-contained plans, one per city, pasted together — the exact case
    // that previously dropped the second city.
    const md = [
      '# Barcelona',
      '## Executive summary',
      '- bullets',
      '## Route',
      '### Sagrada Familia',
      '- Gaudí systems',
      '## Cost estimate',
      'numbers',
      '# Bologna',
      '## Executive summary',
      '- bullets',
      '## Route',
      '### Portico di San Luca',
      '- arcades as public infrastructure',
      '### Piazza Maggiore',
      '- civic heart',
      '## Food plan',
      'grocery',
    ].join('\n');
    const got = extractStopsFromPlan(md, ['Barcelona', 'Bologna']);
    expect(got.map((s) => s.name)).toEqual([
      'Sagrada Familia',
      'Portico di San Luca',
      'Piazza Maggiore',
    ]);
    expect(got.map((s) => s.city)).toEqual(['Barcelona', 'Bologna', 'Bologna']);
  });

  it('matches a decorated city heading to a known city', () => {
    const md = '# Bologna — the arcaded city\n## Route\n### Le Due Torri\nleaning towers';
    const [stop] = extractStopsFromPlan(md, ['Bologna']);
    expect(stop.city).toBe('Bologna');
  });
});

describe('newStopCandidates', () => {
  it('drops candidates already present by name (case-insensitive)', () => {
    const md = '## Route\n### Kastellet\nx\n### Superkilen\ny';
    const existing = [stop({ name: 'kastellet' })];
    expect(newStopCandidates(md, existing).map((s) => s.name)).toEqual(['Superkilen']);
  });
});
