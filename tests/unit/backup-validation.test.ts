import { expect, it } from 'vitest';
import { validateBackup } from '../../src/lib/backup-validation';

it('validates backup versions, identities, amounts, photo sources and ownership before import', () => {
  const empty = {
    app: 'systema',
    version: 1,
    trips: [],
    cities: [],
    stops: [],
    expenses: [],
    fxRates: [],
    settings: [],
    photos: [],
  };
  expect(() => validateBackup(empty)).not.toThrow();
  for (const invalid of [
    null,
    { ...empty, version: 2 },
    { ...empty, stops: {} },
    { ...empty, fxRates: [{ code: 'EUR', rate: 0, date: '2026-09-17', fetchedAt: 0 }] },
    {
      ...empty,
      cities: [{ id: 'orphan', tripId: 'missing', name: 'Test', currency: 'EUR', order: 0 }],
    },
    {
      ...empty,
      photos: [
        {
          meta: {
            id: 'p',
            tripId: 't',
            kind: 'cover',
            stopId: null,
            expenseId: null,
            createdAt: 0,
          },
          dataUrl: 'https://example.com/image.png',
        },
      ],
    },
    {
      ...empty,
      settings: [
        { key: 'duplicate', value: 1 },
        { key: 'duplicate', value: 2 },
      ],
    },
  ])
    expect(() => validateBackup(invalid)).toThrow('Invalid or unsupported');
});

it('accepts the exact record shape the history importer script emits', () => {
  // Mirrors scripts/import-travel-spending.mjs output, so a restore of the
  // imported ledger can't be refused by validation.
  const trip = {
    id: 't1',
    name: 'Vienna (Oct 2024)',
    type: 'custom',
    startDate: '2024-10-03',
    endDate: '2024-10-06',
    partySize: 2,
    returnFlightAt: '',
    accommodation: true,
    status: 'done',
    planText: '',
    order: -1,
    createdAt: 1,
    updatedAt: 1,
  };
  const backup = {
    app: 'systema',
    version: 1,
    exportedAt: '2026-10-01T00:00:00.000Z',
    trips: [trip],
    cities: [{ id: 'c1', tripId: 't1', name: 'Vienna', currency: 'EUR', order: 0 }],
    stops: [
      {
        id: 's1',
        tripId: 't1',
        cityId: null,
        name: 'Belvedere Museum',
        notes: '',
        checklist: [],
        visited: true,
        order: 0,
        createdAt: 1,
      },
    ],
    expenses: [
      {
        id: 'e1',
        tripId: 't1',
        cityId: null,
        date: '2024-10-04',
        destination: 'Vienna',
        category: 'Experiences',
        subcategory: 'Museum',
        description: 'Belvedere Museum Entry',
        paymentMethod: 'Card Payment',
        amountGBP: 30.5,
        amountLocal: 36,
        notes: '',
        currency: 'EUR',
        fxRate: null,
        skeleton: false,
        order: 0,
        createdAt: 1,
      },
    ],
    fxRates: [],
    settings: [],
    photos: [],
  };
  expect(() => validateBackup(backup)).not.toThrow();
  // Failures name the offending row so a refused restore can be diagnosed.
  expect(() => validateBackup({ ...backup, trips: [{ ...trip, partySize: 0 }] })).toThrow(
    'trips row 1, t1',
  );
});
