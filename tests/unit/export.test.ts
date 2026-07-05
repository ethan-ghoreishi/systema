import { describe, it, expect } from 'vitest';
import { buildTripPack, buildJournalingPrompt, JOURNAL_PROMPT } from '../../src/lib/export';
import type { Expense, Stop, Trip } from '../../src/lib/db';

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't',
    name: 'Copenhagen',
    type: 'weekend',
    startDate: '2026-06-26',
    endDate: '2026-06-28',
    partySize: 2,
    returnFlightAt: '',
    accommodation: true,
    status: 'planning',
    planText: '# Thesis\nTrust designed into surfaces.',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function stop(over: Partial<Stop> = {}): Stop {
  return {
    id: 's',
    tripId: 't',
    cityId: null,
    name: 'Carlsberg',
    notes: 'system reading',
    checklist: [{ id: 'i', text: 'inscription', done: true }],
    visited: true,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e',
    tripId: 't',
    cityId: null,
    date: '',
    destination: '',
    category: 'Food',
    subcategory: 'Snacks',
    description: '',
    paymentMethod: '',
    amountGBP: 5,
    amountLocal: 0,
    notes: '',
    currency: 'GBP',
    fxRate: null,
    skeleton: false,
    order: 0,
    createdAt: 0,
    ...over,
  };
}

describe('buildTripPack', () => {
  const twoPhotos = [
    { stopId: 's', createdAt: Date.UTC(2026, 5, 27, 14, 32) },
    { stopId: 's', createdAt: Date.UTC(2026, 5, 27, 15, 10) },
  ];

  it('includes title, plan, ticked stops with notes, photos and expense total', () => {
    const md = buildTripPack(trip(), [], [stop()], [exp()], twoPhotos);
    expect(md).toContain('# Trip pack: Copenhagen');
    expect(md).toContain('## Plan');
    expect(md).toContain('Trust designed into surfaces.');
    expect(md).toContain('### Carlsberg (visited)');
    expect(md).toContain('- [x] inscription');
    expect(md).toContain('system reading');
    expect(md).toContain('_2 photos_');
    expect(md).toContain('## Photos');
    expect(md).toContain('- Carlsberg:');
    expect(md).toContain('**Total:** £5.00');
    expect(md).toContain('- Food: £5.00');
  });

  it('omits empty sections', () => {
    const md = buildTripPack(trip({ planText: '' }), [], [], [], []);
    expect(md).not.toContain('## Plan');
    expect(md).not.toContain('## Stops');
    expect(md).not.toContain('## Photos');
    expect(md).not.toContain('## Expenses');
  });

  it('does not use em-dashes', () => {
    const md = buildTripPack(trip(), [], [stop()], [exp()], twoPhotos);
    expect(md).not.toContain('—');
  });
});

describe('buildJournalingPrompt', () => {
  it('prefixes the prompt and appends the pack', () => {
    const p = buildJournalingPrompt('PACK_BODY');
    expect(p.startsWith(JOURNAL_PROMPT)).toBe(true);
    expect(p).toContain('PACK_BODY');
    expect(p).not.toContain('—');
  });
});
