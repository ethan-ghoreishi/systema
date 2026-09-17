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
