import { describe, it, expect } from 'vitest';
import {
  buildCityPrompt,
  buildResearchPrompt,
  defaultPromptPrefs,
  humanWall,
} from '../../src/lib/prompt';
import type { City, Trip } from '../../src/lib/db';

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    name: 'Copenhagen',
    type: 'weekend',
    startDate: '2026-06-20',
    endDate: '2026-06-22',
    partySize: 2,
    returnFlightAt: '2026-06-22T22:25',
    accommodation: true,
    status: 'planning',
    planText: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const cities: City[] = [
  {
    id: 'c1',
    tripId: 't',
    name: 'Copenhagen',
    currency: 'DKK',
    order: 0,
    arrival: '2026-06-20T08:40',
    departure: '2026-06-22T22:25',
    sleep: 'hotel',
  },
];

describe('defaultPromptPrefs', () => {
  it('defaults a fresh planning trip to plan mode', () => {
    const p = defaultPromptPrefs(trip(), cities);
    expect(p.mode).toBe('plan');
    expect(p.companions).toContain('party of 2');
  });

  it('defaults a done trip (or one with a plan) to have-plan mode', () => {
    expect(defaultPromptPrefs(trip({ status: 'done' }), cities).mode).toBe('have-plan');
    expect(defaultPromptPrefs(trip({ planText: '# Plan' }), cities).mode).toBe('have-plan');
  });
});

describe('buildResearchPrompt — plan mode', () => {
  const p = defaultPromptPrefs(trip(), cities);
  const text = buildResearchPrompt(
    { ...p, mode: 'plan', hotel: 'Herlev Kro', pastVisits: 'Nyhavn, Kastellet', museumsMax: 1 },
    trip(),
    cities,
  );

  it('carries the derived itinerary and inputs', () => {
    expect(text).toContain('**Copenhagen**');
    expect(text).toContain('Herlev Kro');
    expect(text).toContain('Nyhavn, Kastellet');
    expect(text).toContain('at most 1 museum');
  });

  it('bakes in the standing profile and comparators', () => {
    expect(text).toContain('Based in London');
    expect(text).toContain('coeliac-safe gluten-free');
    expect(text).toContain('Esfahan');
  });

  it('instructs the machine-importable route format', () => {
    expect(text).toContain('## Route');
    expect(text).toContain('### <Stop name>');
    expect(text).toContain('level-3 headings for stops only');
  });
});

describe('buildResearchPrompt — have-plan mode', () => {
  it('does not design a new route and includes the existing plan', () => {
    const withPlan = trip({ planText: '# My itinerary\nOpera, Christiania' });
    const p = defaultPromptPrefs(withPlan, cities);
    const text = buildResearchPrompt(p, withPlan, cities);
    expect(p.mode).toBe('have-plan');
    expect(text).toContain('Do not design a new route');
    expect(text).toContain('## My existing itinerary');
    expect(text).toContain('Opera, Christiania');
    // Still asks for the importable route format so the enriched plan can be pinned.
    expect(text).toContain('### <Stop name>');
  });

  it('multi-city itinerary lists both legs in order', () => {
    const t = trip({ planText: 'x' });
    const twoCities: City[] = [
      { id: 'a', tripId: 't', name: 'Barcelona', currency: 'EUR', order: 0, sleep: 'none' },
      { id: 'b', tripId: 't', name: 'Bologna', currency: 'EUR', order: 1, sleep: 'hotel' },
    ];
    const text = buildResearchPrompt(defaultPromptPrefs(t, twoCities), t, twoCities);
    expect(text).toContain('**Barcelona**');
    expect(text).toContain('**Bologna**');
    expect(text.indexOf('Barcelona')).toBeLessThan(text.indexOf('Bologna'));
  });
});

describe('buildResearchPrompt — multi-city phasing', () => {
  const twoCities: City[] = [
    { id: 'a', tripId: 't', name: 'Barcelona', currency: 'EUR', order: 0, sleep: 'none' },
    { id: 'b', tripId: 't', name: 'Bologna', currency: 'EUR', order: 1, sleep: 'hotel' },
  ];

  it('plan mode asks for a separate `# <City>` block per city', () => {
    const t = trip();
    const text = buildResearchPrompt(
      { ...defaultPromptPrefs(t, twoCities), mode: 'plan' },
      t,
      twoCities,
    );
    expect(text).toContain('SEPARATE, self-contained plan for EACH city');
    expect(text).toContain('# <City name>');
  });

  it('single-city plan mode does not ask for per-city blocks', () => {
    const t = trip();
    const oneCity: City[] = [
      { id: 'a', tripId: 't', name: 'Copenhagen', currency: 'DKK', order: 0 },
    ];
    const text = buildResearchPrompt(
      { ...defaultPromptPrefs(t, oneCity), mode: 'plan' },
      t,
      oneCity,
    );
    expect(text).not.toContain('# <City name>');
  });
});

describe('city-by-city research', () => {
  const t = trip({ name: '', type: 'weekend', preset: 'two-city', planText: '' });
  const legs: City[] = [
    {
      id: 'blq',
      tripId: 't',
      name: 'Bologna',
      currency: 'EUR',
      order: 0,
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T19:00',
      sleep: 'none',
      tz: 'Europe/Rome',
      exit: { hub: 'BLQ', journeyMin: 25, transport: 'Marconi Express', throughTicket: 'outbound' },
    },
    {
      id: 'bcn',
      tripId: 't',
      name: 'Barcelona',
      currency: 'EUR',
      order: 1,
      arrival: '2026-10-16T21:00',
      departure: '2026-10-17T21:00',
      sleep: 'hotel',
      tz: 'Europe/Madrid',
      base: { name: 'Hotel Gòtic', address: 'Carrer de Jaume I' },
      exit: { hub: 'BCN' },
    },
  ];
  const p = { ...defaultPromptPrefs(t, legs), mode: 'plan' as const };

  it("carries only that city's base, hours, arrival and departure", () => {
    const text = buildCityPrompt(p, t, legs, 'blq');
    expect(text).toContain('City: **Bologna**');
    expect(text).toContain('Friday 16 October 2026, 9:00am to Friday 16 October 2026, 7:00pm');
    expect(text).toContain('About 10h on the ground, no overnight.');
    expect(text).toContain('Arriving from London.');
    expect(text).toContain(
      'Leaving for Barcelona from BLQ; getting there by Marconi Express (25 min).',
    );
    expect(text).toContain('leave for BLQ by 16:50 local time');
    expect(text).toContain('This is the stopover city of a two-city trip');
    expect(text).toContain('Your answer must start with the line `# Bologna`');
    expect(text).not.toContain('Hotel Gòtic');
    expect(text).toContain('researched separately — keep this plan to Bologna');
  });

  it('asks for visit anchors and never for city grouping inside a city', () => {
    const text = buildCityPrompt(p, t, legs, 'bcn');
    expect(text).toContain('Base: Hotel Gòtic, Carrer de Jaume I.');
    expect(text).toContain('`Minimum visit:` the 10-20 minute version');
    expect(text).toContain('`Exit rule:`');
    expect(text).not.toMatch(/\*\*Barcelona\*\*`? or/);
    expect(text).toContain('never a city name');
  });

  it("enriches the city's own pasted block in have-plan mode", () => {
    const planned = {
      ...t,
      planText: '# Bologna\n\n## Route\n\n### Archiginnasio\n\n# Barcelona\n\nother',
    };
    const text = buildCityPrompt({ ...p, mode: 'have-plan' }, planned, legs, 'blq');
    expect(text).toContain('## My existing plan for Bologna');
    expect(text).toContain('### Archiginnasio');
    expect(text).not.toContain('other');
  });

  it('prints wall-clock times as written, whatever the device zone', () => {
    expect(humanWall('2026-10-25T02:30')).toBe('Sunday 25 October 2026, 2:30am');
    expect(humanWall('2026-10-25T14:05')).toBe('Sunday 25 October 2026, 2:05pm');
  });
});
