import { test, expect } from './fixtures';

// A device on the previous version has a version-3 database. Opening this
// version upgrades it in place (Dexie v4: the moments table) and every record
// — photo bytes included — must come through untouched.

test('a version-3 database opens under this version with every record intact', async ({ page }) => {
  await page.route('**/blank.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }),
  );
  await page.goto('/blank.html'); // same origin, app not loaded
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        // Dexie version 3 is IndexedDB version 30, with the v3 stores and indexes.
        const req = indexedDB.open('systema', 30);
        req.onupgradeneeded = () => {
          const db = req.result;
          const store = (name: string, key: string, indexes: string[]) => {
            const s = db.createObjectStore(name, { keyPath: key });
            for (const i of indexes) s.createIndex(i, i);
          };
          store('kv', 'key', []);
          store('trips', 'id', ['order', 'status', 'updatedAt']);
          store('cities', 'id', ['tripId', 'order']);
          store('stops', 'id', ['tripId', 'cityId', 'order']);
          store('expenses', 'id', ['tripId', 'cityId', 'order']);
          store('photos', 'id', ['tripId', 'stopId', 'expenseId', 'kind']);
          store('fxRates', 'code', []);
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(
            ['trips', 'cities', 'stops', 'expenses', 'photos', 'kv'],
            'readwrite',
          );
          tx.objectStore('trips').put({
            id: 'old-trip',
            name: '',
            type: 'weekend',
            startDate: '2025-05-02',
            endDate: '2025-05-03',
            partySize: 2,
            returnFlightAt: '2025-05-03T21:00',
            accommodation: true,
            status: 'done',
            planText: '# Lisbon',
            promptPrefs: {
              mode: 'plan',
              pace: 'fast',
              budget: 'low',
              companions: '',
              interests: [],
              museumsMax: 1,
              hotel: 'Pensão Amor',
              constraints: '',
              pastVisits: '',
              notes: '',
            },
            order: 0,
            createdAt: 1,
            updatedAt: 2,
          });
          tx.objectStore('cities').put({
            id: 'old-city',
            tripId: 'old-trip',
            name: 'Lisbon',
            currency: 'EUR',
            order: 0,
            arrival: '2025-05-02T09:00',
            departure: '2025-05-03T21:00',
            sleep: 'hotel',
            updatedAt: 2,
          });
          tx.objectStore('stops').put({
            id: 'old-stop',
            tripId: 'old-trip',
            cityId: 'old-city',
            name: 'Alfama',
            notes: 'n',
            checklist: [],
            visited: true,
            order: 0,
            createdAt: 1,
          });
          tx.objectStore('expenses').put({
            id: 'old-exp',
            tripId: 'old-trip',
            cityId: null,
            date: '2025-05-02',
            destination: 'Lisbon/Porto',
            category: 'Transportation',
            subcategory: 'Flight',
            description: 'Flights',
            paymentMethod: 'Online Payment',
            amountGBP: 120,
            amountLocal: 0,
            notes: '',
            currency: 'GBP',
            fxRate: null,
            skeleton: false,
            order: 0,
            createdAt: 1,
          });
          tx.objectStore('photos').put({
            id: 'old-photo',
            tripId: 'old-trip',
            stopId: 'old-stop',
            expenseId: null,
            kind: 'stop',
            blob: new Blob(['old photo bytes'], { type: 'image/jpeg' }),
            backedUp: true,
            createdAt: 1,
          });
          tx.objectStore('kv').put({ key: 'settings', value: { nasUrl: '', nasToken: '' } });
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await page.goto('/');
  const after = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const { isShared } = await import(/* @vite-ignore */ '/src/lib/expense-defaults.ts');
    const { legBaseName } = await import(/* @vite-ignore */ '/src/lib/trip-shape.ts');
    await db.open();
    const trip = await db.trips.get('old-trip');
    const cities = await db.cities.toArray();
    const photo = await db.photos.get('old-photo');
    return {
      version: db.verno,
      trip: trip.planText,
      city: cities[0].name,
      arrival: cities[0].arrival,
      stop: (await db.stops.get('old-stop')).name,
      shared: isShared(await db.expenses.get('old-exp')),
      base: legBaseName(trip, cities, cities[0]),
      photo: await photo.blob.text(),
      moments: await db.moments.count(),
    };
  });
  expect(after).toEqual({
    version: 4,
    trip: '# Lisbon',
    city: 'Lisbon',
    arrival: '2025-05-02T09:00',
    stop: 'Alfama',
    shared: true, // the old 'A/B' convention reads as trip-wide
    base: 'Pensão Amor', // the old prompt answer reads as the hotel leg's base
    photo: 'old photo bytes',
    moments: 0,
  });
  await expect(page.locator('.trip-card', { hasText: 'Lisbon' })).toBeVisible();
});

test('rolling back stays safe: the previous build still opens and writes the upgraded database', async ({
  page,
}) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { db, SystemaDB } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    await db.trips.put({
      id: 'keep',
      name: '',
      type: 'custom',
      startDate: '',
      endDate: '',
      partySize: 2,
      returnFlightAt: '',
      accommodation: false,
      status: 'planning',
      planText: 'v4 plan',
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    db.close();
    // The previous release's schema (Dexie version 3), opening a v4 database.
    const Dexie = Object.getPrototypeOf(SystemaDB);
    const old = new Dexie('systema');
    old.version(3).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, order',
      photos: 'id, tripId, stopId, expenseId, kind',
      fxRates: 'code',
    });
    await old.open();
    const before = (await old.table('trips').get('keep')).planText;
    await old.table('trips').update('keep', { planText: 'edited after rollback' });
    const after = (await old.table('trips').get('keep')).planText;
    old.close();
    return { before, after };
  });
  expect(r).toEqual({ before: 'v4 plan', after: 'edited after rollback' });
});
