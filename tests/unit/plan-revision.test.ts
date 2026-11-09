import { describe, expect, it } from 'vitest';
import {
  planChoices,
  planCityId,
  planMatches,
  reviewMatches,
  revisedStop,
  UNDECIDED,
} from '../../src/lib/plan-revision';
import {
  cityIds,
  extractStopsFromPlan,
  guideBackfill,
  newStopCandidates,
} from '../../src/lib/stops';
import { keepMomentDate } from '../../src/lib/moments';
import { instantToWall, wallToInstant } from '../../src/lib/tz';
import type { Moment, Stop } from '../../src/lib/db';

const candidate = {
  name: 'Museum',
  notes: 'Old plan',
  checklist: [],
  guide: { anchor: 'Old entrance' },
};
const stop: Stop = {
  id: 's',
  tripId: 't',
  cityId: 'rome',
  name: 'Museum',
  notes: 'Old plan',
  guide: candidate.guide,
  checklist: [],
  visited: true,
  visitedAt: 123,
  order: 0,
  createdAt: 1,
  planSource: candidate,
};
const cities = [
  { id: 'rome', tripId: 't', name: 'Rome', currency: 'EUR', order: 0 },
  { id: 'london', tripId: 't', name: 'London', currency: 'GBP', order: 1 },
];

describe('revised routes', () => {
  it('updates imported text while retaining user edits, history, bookings, checklist identities and corrected pins', () => {
    const own = {
      ...stop,
      notes: 'My notes',
      lat: 41.1,
      lng: 12.1,
      booked: true,
      bookingRef: 'KEEP',
      guide: { anchor: 'My entrance' },
      checklist: [{ id: 'tick', text: 'Look up', done: true }],
    };
    const next = {
      ...candidate,
      name: 'Renamed museum',
      notes: 'New plan',
      lat: 42,
      lng: 13,
      guide: { anchor: 'New entrance' },
      checklist: [
        { text: 'Look up', done: false },
        { text: 'Look down', done: false },
      ],
    };
    expect(revisedStop(own, next)).toMatchObject({
      id: 's',
      name: 'Renamed museum',
      notes: 'My notes',
      lat: 41.1,
      lng: 12.1,
      booked: true,
      bookingRef: 'KEEP',
      visitedAt: 123,
      guide: { anchor: 'My entrance' },
      checklist: [
        { id: 'tick', text: 'Look up', done: true },
        { text: 'Look down', done: false },
      ],
    });
    expect(revisedStop(stop, next)).toMatchObject({
      notes: 'New plan',
      lat: 42,
      lng: 13,
      guide: { anchor: 'New entrance' },
    });
    expect(revisedStop({ ...stop, name: 'My name' }, next).name).toBe('My name');
    expect(revisedStop({ ...own, notes: '', guide: undefined }, next)).toMatchObject({ notes: '' });
    expect(revisedStop({ ...own, notes: '', guide: undefined }, next).guide).toBeUndefined();
  });
  it('uses previous plan text conservatively for legacy records', () => {
    const legacy = { ...stop, planSource: undefined };
    expect(revisedStop(legacy, { ...candidate, notes: 'New' }, candidate).notes).toBe('New');
    expect(revisedStop(legacy, { ...candidate, notes: 'New' }).notes).toBe('Old plan');
  });
  it('matches within cities, refuses ambiguity and recognises a personal rename by import identity', () => {
    const rows = [stop, { ...stop, id: 'l', cityId: 'london' }];
    expect(
      planMatches(
        [
          { ...candidate, city: 'London' },
          { ...candidate, city: 'Rome' },
        ],
        rows,
        cities,
      ),
    ).toEqual(['l', 's']);
    expect(
      planMatches([{ ...candidate, city: 'Rome' }], [stop, { ...stop, id: 'duplicate' }], cities),
    ).toEqual(['']);
    expect(
      planMatches([{ ...candidate, city: 'Rome' }], [{ ...stop, name: 'My name' }], cities),
    ).toEqual(['s']);
    expect(planMatches([candidate], rows, cities)).toEqual(['']);
    const repeated = [...cities, { ...cities[0], id: 'return-rome' }];
    expect(planCityId({ ...candidate, city: 'Rome' }, repeated)).toBeNull();
    // A city the trip returns to cannot place a *new* stop, but the one
    // existing place of that name is still that place, and keeps its own leg.
    expect(planMatches([{ ...candidate, city: 'Rome' }], rows, repeated)).toEqual(['s']);
    expect(
      planMatches(
        [{ ...candidate, city: 'Rome' }],
        [stop, { ...stop, id: 'again', cityId: 'return-rome' }],
        repeated,
      ),
    ).toEqual(['']);
  });
  it('re-applying the same plan to a trip that returns to a city changes nothing', () => {
    const returning = [
      { id: 'v1', tripId: 't', name: 'Vienna', currency: 'EUR', order: 0 },
      { id: 's1', tripId: 't', name: 'Salzburg', currency: 'EUR', order: 1 },
      { id: 'v2', tripId: 't', name: 'Vienna', currency: 'EUR', order: 2 },
    ];
    const text =
      '# Vienna\n## Route\n### Belvedere\nNotes\n### Naschmarkt\nNotes\n# Salzburg\n## Route\n### Fortress\nNotes';
    const candidates = extractStopsFromPlan(
      text,
      returning.map((c) => c.name),
    );
    const rows: Stop[] = candidates.map((c, i) => ({
      ...stop,
      id: `st${i}`,
      cityId: c.city === 'Salzburg' ? 's1' : 'v1',
      name: c.name,
      notes: c.notes,
      order: i,
      planSource: c,
    }));
    expect(planMatches(candidates, rows, returning)).toEqual(['st0', 'st1', 'st2']);
    // A place the ambiguous city left unassigned is matched, never added twice.
    const unassigned = [
      ...rows,
      { ...rows[0], id: 'loose', name: 'Kunsthistorisches', cityId: null, planSource: undefined },
    ];
    const withNew = [...candidates, { ...candidate, name: 'Kunsthistorisches', city: 'Vienna' }];
    expect(planMatches(withNew, unassigned, returning)).toEqual(['st0', 'st1', 'st2', 'loose']);
  });
  // Vienna, Salzburg, then Vienna again: the shape that once put every
  // Vienna place on the last visit and showed ambiguity as a new place.
  const vsv = [
    { id: 'v1', tripId: 't', name: 'Vienna', currency: 'EUR', order: 0 },
    { id: 'sb', tripId: 't', name: 'Salzburg', currency: 'EUR', order: 1 },
    { id: 'v2', tripId: 't', name: 'Vienna', currency: 'EUR', order: 2 },
  ];
  const vsvNames = vsv.map((c) => c.name);
  const place = (id: string, name: string, cityId: string | null, extra = {}): Stop => ({
    ...stop,
    id,
    name,
    cityId,
    notes: '',
    guide: undefined,
    planSource: undefined,
    ...extra,
  });

  it('review separates ambiguous plan matches from no match and uses each record once', () => {
    const plan =
      '# Vienna\n## Route\n### Belvedere\nUpper\n### Albertina\nPrints\n# Salzburg\n## Route\n### Fortress\nRiver\n### Fortress\nAgain\n### Mozart house\nBirthplace\n# Vienna\n## Route\n### Belvedere\nLower';
    const rows = [
      place('b1', 'Belvedere', 'v1', { visited: true }),
      // Renamed by hand; the plan still calls it Albertina.
      place('alb', 'My print room', 'v1', {
        planSource: { name: 'Albertina', notes: 'Prints', checklist: [] },
      }),
      place('fortress', 'Fortress', 'sb'),
      place('b2', 'Belvedere', 'v2'),
      place('alb-loose', 'Albertina', null),
    ];
    const candidates = extractStopsFromPlan(plan, vsvNames);
    expect(candidates.map((c) => [c.name, c.city])).toEqual([
      ['Belvedere', 'Vienna'],
      ['Albertina', 'Vienna'],
      ['Fortress', 'Salzburg'],
      ['Fortress', 'Salzburg'],
      ['Mozart house', 'Salzburg'],
      ['Belvedere', 'Vienna'],
    ]);
    // Every plausible record, by name or by the name it was imported under.
    // Fortress has one record: the first entry takes it, the second can't.
    expect(planChoices(candidates, rows, vsv)).toEqual([
      ['b1', 'b2'],
      ['alb', 'alb-loose'],
      ['fortress'],
      [],
      [],
      ['b1', 'b2'],
    ]);
    // Review asks about ambiguity; only a true absence is a new place.
    expect(reviewMatches(candidates, rows, vsv)).toEqual(['?', '?', 'fortress', '', '', '?']);
    expect(UNDECIDED).toBe('?');
    // Unreviewed matching (the defect's view) would have shown all three as new.
    expect(planMatches(candidates, rows, vsv)).toEqual(['', '', 'fortress', '', '', '']);
  });

  it('repeated-city plan logic never picks a leg a heading cannot name', () => {
    const plan =
      '# Vienna\n## Route\n### Belvedere\nAnchor: Upper palace\n### Naschmarkt\nAnchor: Stalls\n# Salzburg\n## Route\n### Fortress\nAnchor: Funicular\n# Vienna\n## Route\n### Prater\nWheel';
    // Both Vienna legs answer to the name; neither is chosen for it.
    expect([...cityIds(vsv)]).toEqual([
      ['vienna', ['v1', 'v2']],
      ['salzburg', ['sb']],
    ]);
    // As a legacy import leaves them: only the one-leg city is assigned.
    const imported = [
      place('bel', 'Belvedere', null),
      place('nasch', 'Naschmarkt', null),
      place('fort', 'Fortress', 'sb', { guide: { anchor: 'Funicular' } }),
      place('prater', 'Prater', null),
    ];
    const ids = cityIds(vsv);
    // Present, so repeated application adds nothing.
    expect(newStopCandidates(plan, imported, vsvNames, ids)).toEqual([]);

    // The traveller puts Belvedere on the first visit and adds one on the second.
    const later = [
      place('bel', 'Belvedere', 'v1'),
      place('nasch', 'Naschmarkt', null),
      place('fort', 'Fortress', 'sb', { guide: { anchor: 'Funicular' } }),
      place('prater', 'Prater', null),
      place('bel2', 'Belvedere', 'v2'),
    ];
    // Two equally good Belvederes: present, and neither filled. The one
    // unassigned Naschmarkt is the plan's, so it is.
    expect(newStopCandidates(plan, later, vsvNames, ids)).toEqual([]);
    expect(guideBackfill(plan, later, vsvNames, ids)).toEqual([
      { id: 'nasch', patch: { guide: { anchor: 'Stalls' } } },
    ]);
    // A leg the trip no longer has matches only unassigned places: never a Vienna one.
    const graz = '# Graz\n## Route\n### Belvedere\nAnchor: Elsewhere';
    expect(newStopCandidates(graz, later, vsvNames, ids).map((c) => [c.name, c.city])).toEqual([
      ['Belvedere', 'Graz'],
    ]);
    expect(guideBackfill(graz, later, vsvNames, ids)).toEqual([]);
    // No city heading: the name alone can't say which Belvedere.
    const bare = '## Route\n### Belvedere\nAnchor: Somewhere';
    expect(newStopCandidates(bare, later, vsvNames, ids)).toEqual([]);
    expect(guideBackfill(bare, later, vsvNames, ids)).toEqual([]);
    // Reviewed revision: Belvedere waits for a decision each time; nothing else moves.
    const revised = `${plan}\n### Belvedere\nLower palace\n### Hofburg\nTreasury`;
    expect(reviewMatches(extractStopsFromPlan(revised, vsvNames), later, vsv)).toEqual([
      '?',
      'nasch',
      'fort',
      'prater',
      '?',
      '',
    ]);
  });

  it('ignores nested commentary headings and recovers bold location labels', () => {
    const text =
      '## Route\n### Riverside Walk\n**Location:** 41.9, 12.4\n#### What to see\nA detail\n### Market\nNotes';
    const result = extractStopsFromPlan(text);
    expect(result.map((s) => s.name)).toEqual(['Riverside Walk', 'Market']);
    expect(result[0]).toMatchObject({ lat: 41.9, lng: 12.4 });
    expect(result[0].notes).toContain('What to see\nA detail');
    expect(
      guideBackfill(text, [{ ...stop, name: 'Riverside Walk', cityId: null }])[0].patch,
    ).toMatchObject({ lat: 41.9, lng: 12.4 });
  });
});

it('leaves a saved instant alone when the zone has not changed', () => {
  const at = wallToInstant('2020-05-03T09:30', 'Europe/Rome')!;
  const m = { at, timePrecision: 'date' } as Moment;
  keepMomentDate(m, 'Europe/Rome', 'Europe/Rome');
  expect(m.at).toBe(at);
});

it.each(['date', 'approximate'] as const)(
  'keeps a %s calendar date across the date line',
  (timePrecision) => {
    const m = {
      at: wallToInstant('2020-05-03T12:00', 'Pacific/Kiritimati')!,
      timePrecision,
    } as Moment;
    keepMomentDate(m, 'Pacific/Kiritimati', 'Pacific/Honolulu');
    expect(instantToWall(m.at, 'Pacific/Honolulu')).toBe('2020-05-03T12:00');
  },
);
