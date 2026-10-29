import { describe, it, expect } from 'vitest';
import {
  checklistProgress,
  extractStopsFromPlan,
  newStopCandidates,
  guideBackfill,
} from '../../src/lib/stops';
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

  // Two cities can each have a Duomo. Matching on the name alone made the
  // second city's one look like it was already there, and it never arrived.
  const twoCities = [
    '# Bologna',
    '## Route',
    '### Duomo',
    'Anchor: the west front',
    '### Archiginnasio',
    'x',
    '# Florence',
    '## Route',
    '### Duomo',
    'Anchor: Brunelleschi’s dome',
  ].join('\n');
  const legs = new Map([
    ['bologna', 'c1'],
    ['florence', 'c2'],
  ]);

  it("imports a city's stop whose name another city already uses", () => {
    const existing = [stop({ id: 's1', name: 'Duomo', cityId: 'c1' })];
    const fresh = newStopCandidates(twoCities, existing, ['Bologna', 'Florence'], legs);
    expect(fresh.map((c) => [c.name, c.city])).toEqual([
      ['Archiginnasio', 'Bologna'],
      ['Duomo', 'Florence'],
    ]);
  });

  it('still matches by name alone when the plan names no city', () => {
    // A stop added before the trip had legs, or a single-city plan.
    const oneCity = '## Route\n### Duomo\nx\n### Archiginnasio\ny';
    const existing = [stop({ id: 's1', name: 'Duomo', cityId: null })];
    expect(newStopCandidates(oneCity, existing, [], legs).map((c) => c.name)).toEqual([
      'Archiginnasio',
    ]);
    // And a stop with a city still matches a plan that names none.
    expect(
      newStopCandidates(oneCity, [stop({ id: 's1', name: 'Duomo', cityId: 'c1' })], [], legs).map(
        (c) => c.name,
      ),
    ).toEqual(['Archiginnasio']);
  });

  // One stop with no city can only be one of the plan's two Duomos; the other
  // city's is still missing and must be imported.
  it('lets an unassigned stop stand for one city only, not every city', () => {
    const existing = [stop({ id: 's1', name: 'Duomo', cityId: null })];
    const fresh = newStopCandidates(twoCities, existing, ['Bologna', 'Florence'], legs);
    expect(fresh.map((c) => [c.name, c.city])).toEqual([
      ['Archiginnasio', 'Bologna'],
      ['Duomo', 'Florence'],
    ]);
  });

  it('fills the anchor of the city-matched stop before an unassigned one', () => {
    const existing = [
      stop({ id: 's1', name: 'Duomo', cityId: null }),
      stop({ id: 's2', name: 'Duomo', cityId: 'c2' }),
    ];
    // Florence's block matches s2 by city; Bologna's falls to the spare.
    expect(guideBackfill(twoCities, existing, ['Bologna', 'Florence'], legs)).toEqual([
      { id: 's1', guide: { anchor: 'the west front' } },
      { id: 's2', guide: { anchor: 'Brunelleschi’s dome' } },
    ]);
  });

  it('fills a visit anchor from the plan into the stop in that same city', () => {
    const existing = [
      stop({ id: 's1', name: 'Duomo', cityId: 'c1' }),
      stop({ id: 's2', name: 'Duomo', cityId: 'c2' }),
    ];
    expect(guideBackfill(twoCities, existing, ['Bologna', 'Florence'], legs)).toEqual([
      { id: 's1', guide: { anchor: 'the west front' } },
      { id: 's2', guide: { anchor: 'Brunelleschi’s dome' } },
    ]);
  });
});

describe('visit anchors', () => {
  const plan = `# Bologna

## Route

### Archiginnasio
- The old university's seat: civic pride written in coats of arms.
**Anchor:** Start in the Anatomical Theatre — dissection as public knowledge.
**Minimum visit:** 15 minutes: the theatre, then the main stair.
**Look for:** students' coats of arms; the skinless statues; the lecturer's canopy.
Stretch: the Stabat Mater hall, if calm.
- Exit rule: skip the library corridors; the theatre carries the thesis.
- [ ] Count the coats of arms on one ceiling bay
Location: 44.4935, 11.3431

### Piazza Maggiore
- Look for:
  - the meridian line
  - the Neptune fountain's sightline
- Market stalls behind the square.
`;

  it('extracts the five anchor fields, out of the notes', () => {
    const [arch, piazza] = extractStopsFromPlan(plan, ['Bologna']);
    expect(arch.guide).toEqual({
      anchor: 'Start in the Anatomical Theatre — dissection as public knowledge.',
      minimum: '15 minutes: the theatre, then the main stair.',
      lookFor: ["students' coats of arms", 'the skinless statues', "the lecturer's canopy"],
      stretch: 'the Stabat Mater hall, if calm.',
      exit: 'skip the library corridors; the theatre carries the thesis.',
    });
    expect(arch.notes).toBe("- The old university's seat: civic pride written in coats of arms.");
    expect(arch.checklist).toHaveLength(1);
    expect(arch.lat).toBe(44.4935);
    expect(piazza.guide?.lookFor).toEqual([
      'the meridian line',
      "the Neptune fountain's sightline",
    ]);
    expect(piazza.notes).toBe('- Market stalls behind the square.');
  });

  it('fills empty anchors on existing stops and never overwrites', () => {
    const existing = [
      {
        id: 's1',
        tripId: 't',
        cityId: null,
        name: 'Archiginnasio',
        notes: '',
        checklist: [],
        visited: false,
        guide: { anchor: 'My own anchor' },
        order: 0,
        createdAt: 0,
      },
    ];
    const [b] = guideBackfill(plan, existing, ['Bologna']);
    expect(b.guide.anchor).toBe('My own anchor');
    expect(b.guide.minimum).toBe('15 minutes: the theatre, then the main stair.');
  });
});
