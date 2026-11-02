import { test, expect } from './fixtures';

// A device left behind for a while has a version-3 database. Opening this
// version upgrades it in place, through every step (v4 moments, v5
// opportunities), and every record — photo bytes included — must come through
// untouched.

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
      opportunities: await db.opportunities.count(),
    };
  });
  expect(after).toEqual({
    version: 5,
    trip: '# Lisbon',
    city: 'Lisbon',
    arrival: '2025-05-02T09:00',
    stop: 'Alfama',
    shared: true, // the old 'A/B' convention reads as trip-wide
    base: 'Pensão Amor', // the old prompt answer reads as the hotel leg's base
    photo: 'old photo bytes',
    moments: 0,
    opportunities: 0,
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
      planText: 'v5 plan',
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    db.close();
    // The previous release's schema (Dexie version 4), opening a v5 database.
    const Dexie = Object.getPrototypeOf(SystemaDB);
    const old = new Dexie('systema');
    old.version(4).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, order',
      photos: 'id, tripId, stopId, expenseId, kind, momentId',
      fxRates: 'code',
      moments: 'id, tripId, cityId, stopId',
    });
    await old.open();
    const before = (await old.table('trips').get('keep')).planText;
    await old.table('trips').update('keep', { planText: 'edited after rollback' });
    const after = (await old.table('trips').get('keep')).planText;
    old.close();
    return { before, after };
  });
  expect(r).toEqual({ before: 'v5 plan', after: 'edited after rollback' });
});

// The step this release adds: a version-4 database (the build an iPhone is
// likely still running) upgrades to v5 without rewriting a row, and the new
// table is there to write into.
test('a version-4 database upgrades to v5 with every record intact', async ({ page }) => {
  await page.route('**/blank.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }),
  );
  await page.goto('/blank.html');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        // Dexie version 4 is IndexedDB version 40.
        const req = indexedDB.open('systema', 40);
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
          store('photos', 'id', ['tripId', 'stopId', 'expenseId', 'kind', 'momentId']);
          store('fxRates', 'code', []);
          store('moments', 'id', ['tripId', 'cityId', 'stopId']);
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['trips', 'cities', 'moments'], 'readwrite');
          tx.objectStore('trips').put({
            id: 'v4-trip',
            name: '',
            type: 'weekend',
            startDate: '2026-06-20',
            endDate: '2026-06-22',
            partySize: 2,
            returnFlightAt: '2026-06-22T19:00',
            accommodation: true,
            status: 'done',
            planText: '# Copenhagen',
            journalText: 'A long light evening.',
            order: 0,
            createdAt: 1,
            updatedAt: 2,
          });
          tx.objectStore('cities').put({
            id: 'v4-city',
            tripId: 'v4-trip',
            name: 'Copenhagen',
            currency: 'DKK',
            order: 0,
            sleep: 'hotel',
            tz: 'Europe/Copenhagen',
            updatedAt: 2,
          });
          tx.objectStore('moments').put({
            id: 'v4-moment',
            tripId: 'v4-trip',
            cityId: 'v4-city',
            title: 'Harbour swim',
            note: '',
            at: 1750000000000,
            stopId: null,
            createdAt: 1,
          });
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await page.goto('/');
  const after = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    await db.opportunities.put({
      id: 'new-opp',
      city: 'Faro',
      options: [],
      createdAt: Date.now(),
    });
    return {
      version: db.verno,
      journal: (await db.trips.get('v4-trip')).journalText,
      zone: (await db.cities.get('v4-city')).tz,
      moment: (await db.moments.get('v4-moment')).title,
      opportunity: (await db.opportunities.get('new-opp')).city,
    };
  });
  expect(after).toEqual({
    version: 5,
    journal: 'A long light evening.',
    zone: 'Europe/Copenhagen',
    moment: 'Harbour swim',
    opportunity: 'Faro',
  });
  await expect(page.locator('.trip-card', { hasText: 'Copenhagen' })).toBeVisible();
});
