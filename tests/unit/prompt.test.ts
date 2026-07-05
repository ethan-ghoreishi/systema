import { describe, it, expect } from 'vitest';
import { buildResearchPrompt, defaultPromptPrefs } from '../../src/lib/prompt';
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
