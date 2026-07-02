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

const cities: City[] = [{ id: 'c1', tripId: 't', name: 'Copenhagen', currency: 'DKK', order: 0 }];

describe('defaultPromptPrefs', () => {
  it('prefills from the trip and cities', () => {
    const p = defaultPromptPrefs(trip(), cities);
    expect(p.destination).toBe('Copenhagen');
    expect(p.arrival).toBe('20 June 2026');
    expect(p.departure).toContain('22 June 2026');
    expect(p.durationLabel).toContain('two-to-three day');
    expect(p.companions).toContain('party of 2');
  });
});

describe('buildResearchPrompt', () => {
  const p = defaultPromptPrefs(trip(), cities);
  const text = buildResearchPrompt({
    ...p,
    hotel: 'Herlev Kro',
    pastVisits: 'Nyhavn, Kastellet',
    museumsMax: 1,
  });

  it('carries the inputs', () => {
    expect(text).toContain('Destination: Copenhagen');
    expect(text).toContain('Herlev Kro');
    expect(text).toContain('Nyhavn, Kastellet');
    expect(text).toContain('Include at most 1 museum.');
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
