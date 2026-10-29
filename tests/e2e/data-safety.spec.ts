import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Fresh Playwright contexts only. These fixtures never touch the installed PWA.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/lib/trips.ts';
    const { createTrip } = await import(/* @vite-ignore */ path);
    const id = await createTrip('custom');
    sessionStorage.setItem('testTrip', id);
  });
});

test('photo backup restores atomically and preserves existing device records', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildZipBackup, readBackupFile, importBackup } = await import(
      /* @vite-ignore */ exportPath
    );
    const id = sessionStorage.getItem('testTrip');
    await db.photos.add({
      id: 'synthetic-photo',
      tripId: id,
      stopId: null,
      expenseId: null,
      kind: 'cover',
      blob: new Blob(['synthetic image'], { type: 'image/png' }),
      createdAt: 1,
    });
    // As a saved file would be: bytes, not a Blob still backed by the database
    // (the photo is deleted below, before restoring).
    const saved = new Blob([await (await buildZipBackup()).arrayBuffer()]);
    const { backup, files } = await readBackupFile(saved);
    await db.photos.delete('synthetic-photo');
    await db.trips.update(id, { planText: 'Newer device plan' });
    let error = '';
    try {
      await importBackup(backup, files);
    } catch (e) {
      error = String(e);
    }
    return {
      error,
      plan: (await db.trips.get(id)).planText,
      photo: await (await db.photos.get('synthetic-photo'))?.blob.text(),
    };
  });
  expect(result).toEqual({ error: '', plan: 'Newer device plan', photo: 'synthetic image' });
});

test('import reports only on-device records that differ from the backup', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildZipBackup, readBackupFile, importBackup } = await import(
      /* @vite-ignore */ exportPath
    );
    const { backup } = await readBackupFile(await buildZipBackup());
    const identical = await importBackup(backup);
    await db.trips.update(sessionStorage.getItem('testTrip'), {
      planText: 'Edited on this device',
    });
    const edited = await importBackup(backup);
    return [identical.differing, edited.differing];
  });
  expect(result).toEqual([0, 1]);
});

test('filling blanks fills only what is blank here, and leaves the rest alone', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildZipBackup, readBackupFile, importBackup } = await import(
      /* @vite-ignore */ exportPath
    );
    const id = sessionStorage.getItem('testTrip')!;
    await db.trips.update(id, { journalText: '', planText: 'written on this device' });
    const { backup } = await readBackupFile(await buildZipBackup());
    // The backup carries a journal for a trip whose plan differs from this device's.
    backup.trips = backup.trips.map((t: { id: string }) =>
      t.id === id ? { ...t, journalText: 'reconstructed journal', planText: 'the backup plan' } : t,
    );
    const before = await db.trips.get(id);
    const off = await importBackup(backup, new Map(), { dryRun: true });
    const preview = await importBackup(backup, new Map(), { dryRun: true, fillEmpty: true });
    const untouched = (await db.trips.get(id)).journalText;
    const done = await importBackup(backup, new Map(), { fillEmpty: true });
    const after = await db.trips.get(id);
    return {
      offFilled: off.filled,
      previewFilled: preview.filled,
      dryRunWroteNothing: untouched === '',
      filled: done.filled,
      journal: after.journalText,
      plan: after.planText,
      updatedAtMoved: after.updatedAt > before.updatedAt,
    };
  });
  expect(result).toEqual({
    offFilled: 0,
    previewFilled: 1,
    dryRunWroteNothing: true,
    filled: 1,
    journal: 'reconstructed journal',
    plan: 'written on this device',
    updatedAtMoved: true,
  });
});

test('invalid backup writes nothing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildZipBackup, readBackupFile, importBackup } = await import(
      /* @vite-ignore */ exportPath
    );
    const { backup } = await readBackupFile(await buildZipBackup());
    backup.trips[0].id = 'synthetic-new-trip';
    backup.expenses = [{ id: 'synthetic-broken', tripId: 'synthetic-new-trip' }];
    let rejected = false;
    try {
      await importBackup(backup);
    } catch {
      rejected = true;
    }
    return { rejected, trips: await db.trips.count(), expenses: await db.expenses.count() };
  });
  expect(result).toEqual({ rejected: true, trips: 1, expenses: 0 });
});

test('background FX does not overwrite a manual edit made during the request', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const expensePath = '/src/lib/expenses.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { addExpense, resolvePendingFx } = await import(/* @vite-ignore */ expensePath);
    const id = await addExpense(sessionStorage.getItem('testTrip'), {
      cityId: null,
      destination: 'Test',
      date: '2026-09-01',
      category: 'Food',
      subcategory: 'Snacks',
      description: '',
      paymentMethod: 'Cash',
      amountGBP: 0,
      amountLocal: 10,
      currency: 'EUR',
      fxRate: null,
      fxPending: true,
      notes: '',
    });
    const original = window.fetch;
    window.fetch = async () => {
      await db.expenses.update(id, { amountGBP: 7, fxPending: false, notes: 'Manual correction' });
      return new Response(JSON.stringify({ rates: { GBP: 0.9 } }));
    };
    try {
      await resolvePendingFx();
      const row = await db.expenses.get(id);
      return { amount: row.amountGBP, notes: row.notes };
    } finally {
      window.fetch = original;
    }
  });
  expect(result).toEqual({ amount: 7, notes: 'Manual correction' });
});

test('stop edits stay with their stop when navigating immediately', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const path = '/src/lib/stops.ts';
    const { addStop, updateStop } = await import(/* @vite-ignore */ path);
    const trip = sessionStorage.getItem('testTrip');
    const first = await addStop(trip, 'Synthetic first');
    const second = await addStop(trip, 'Synthetic second');
    await updateStop(second, { notes: 'Second notes' });
    location.hash = `/trip/${trip}/stops/${first}`;
    return { trip, first, second };
  });
  await page.getByLabel('Notes', { exact: true }).fill('First edited notes');
  await page.evaluate(({ trip, second }) => {
    location.hash = `/trip/${trip}/stops/${second}`;
  }, ids);
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Second notes');
  await expect
    .poll(() =>
      page.evaluate(async (first) => {
        const path = '/src/lib/db.ts';
        const { db } = await import(/* @vite-ignore */ path);
        return (await db.stops.get(first)).notes;
      }, ids.first),
    )
    .toBe('First edited notes');
});

test('description-only expense edit keeps the recorded GBP amount', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) =>
    route.fulfill({
      json: { date: '2026-09-17', rates: { GBP: 0.9 } },
    }),
  );
  await page.evaluate(async () => {
    const path = '/src/lib/expenses.ts';
    const { addExpense } = await import(/* @vite-ignore */ path);
    const trip = sessionStorage.getItem('testTrip');
    await addExpense(trip, {
      cityId: null,
      destination: 'Test',
      date: '2026-09-01',
      category: 'Food',
      subcategory: 'Snacks',
      description: 'Synthetic expense',
      paymentMethod: 'Cash',
      amountGBP: 7,
      amountLocal: 10,
      currency: 'EUR',
      fxRate: null,
      fxPending: false,
      notes: '',
    });
    location.hash = `/trip/${trip}/expenses`;
  });
  await page.getByText('Synthetic expense', { exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Edited description');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/lib/db.ts';
        const { db } = await import(/* @vite-ignore */ path);
        return (await db.expenses.toArray())[0].amountGBP;
      }),
    )
    .toBe(7);
});

test('receipt write failure rolls back the expense edit and keeps the draft visible', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const path = '/src/lib/expenses.ts';
    const dbPath = '/src/lib/db.ts';
    const { addExpense } = await import(/* @vite-ignore */ path);
    const { db } = await import(/* @vite-ignore */ dbPath);
    const trip = sessionStorage.getItem('testTrip');
    await addExpense(trip, {
      cityId: null,
      destination: 'Test',
      date: '2026-09-01',
      category: 'Food',
      subcategory: 'Snacks',
      description: 'Original expense',
      paymentMethod: 'Cash',
      amountGBP: 7,
      amountLocal: 0,
      currency: 'GBP',
      fxRate: null,
      fxPending: false,
      notes: '',
    });
    db.photos.hook('creating', () => {
      throw new Error('Synthetic storage failure');
    });
    location.hash = `/trip/${trip}/expenses`;
  });
  await page.getByText('Original expense', { exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Unsaved edit');
  await page.locator('dialog input[type="file"]:not([capture])').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic image'),
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Not saved');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved edit');
  expect(
    await page.evaluate(async () => {
      const path = '/src/lib/db.ts';
      const { db } = await import(/* @vite-ignore */ path);
      return {
        description: (await db.expenses.toArray())[0].description,
        photos: await db.photos.count(),
      };
    }),
  ).toEqual({ description: 'Original expense', photos: 0 });
});

// A fake NAS receiver. Records POSTed data snapshots; `latest` answers as told.
async function nasBackupRun(page: Page, latest: { status: number; json?: unknown }) {
  const posts: string[] = [];
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await page.route('https://nas.test/**', (route) => {
    const req = route.request();
    const kind = new URL(req.url()).searchParams.get('kind');
    if (req.method() === 'POST') {
      if (kind === 'data') posts.push(req.postData() ?? '');
      return route.fulfill({ headers: cors, json: { ok: true } });
    }
    if (kind === 'latest')
      return route.fulfill({ status: latest.status, headers: cors, json: latest.json ?? {} });
    return route.fulfill({ headers: cors, contentType: 'image/png', body: 'nas image' });
  });
  const lastError = await page.evaluate(async () => {
    const settingsPath = '/src/lib/settings.svelte.ts';
    const nasPath = '/src/lib/nas.svelte.ts';
    const { settingsStore } = await import(/* @vite-ignore */ settingsPath);
    const { nasBackup } = await import(/* @vite-ignore */ nasPath);
    settingsStore.current = {
      nasUrl: 'https://nas.test/systema-backup.php',
      nasToken: 'synthetic',
    };
    await nasBackup.sync();
    return nasBackup.lastError;
  });
  return { posts, lastError };
}

test('a first NAS push merges the NAS copy first, so it never buries it', async ({ page }) => {
  const nasTrip = {
    id: 'nas-trip',
    name: 'NAS trip',
    type: 'custom',
    startDate: '',
    endDate: '',
    partySize: 2,
    returnFlightAt: '',
    accommodation: false,
    status: 'done',
    planText: '',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const photo = {
    id: 'nas-photo-0001',
    tripId: 'nas-trip',
    stopId: null,
    expenseId: null,
    kind: 'cover',
    createdAt: 1,
  };
  const { posts, lastError } = await nasBackupRun(page, {
    status: 200,
    json: {
      app: 'systema',
      version: 1,
      exportedAt: '',
      trips: [nasTrip],
      cities: [],
      stops: [],
      expenses: [],
      fxRates: [],
      settings: [],
      photos: [],
      photosMeta: [photo],
    },
  });
  expect(lastError).toBe('');
  expect(posts).toHaveLength(1);
  const pushed = JSON.parse(posts[0]);
  expect(pushed.trips.map((t: { id: string }) => t.id)).toContain('nas-trip');
  expect(pushed.trips).toHaveLength(2); // the NAS trip plus this device's own
  expect(pushed.photosMeta.map((p: { id: string }) => p.id)).toEqual(['nas-photo-0001']);
});

test('a first NAS push goes ahead when the NAS has no snapshot yet', async ({ page }) => {
  const { posts, lastError } = await nasBackupRun(page, { status: 404 });
  expect(lastError).toBe('');
  expect(posts).toHaveLength(1);
});

test('a first NAS push is withheld when the NAS copy cannot be merged', async ({ page }) => {
  const { posts, lastError } = await nasBackupRun(page, { status: 500 });
  expect(posts).toHaveLength(0);
  expect(lastError).toContain('HTTP 500');
});

test('quick successive checklist taps from a stale stop copy all stick', async ({ page }) => {
  const done = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const stopsPath = '/src/lib/stops.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { addStop, addChecklistItem, toggleChecklistItem } = await import(
      /* @vite-ignore */ stopsPath
    );
    const id = await addStop(sessionStorage.getItem('testTrip'), 'Synthetic stop');
    await addChecklistItem(await db.stops.get(id), 'First');
    await addChecklistItem(await db.stops.get(id), 'Second');
    const stale = await db.stops.get(id);
    await Promise.all(stale.checklist.map((c: { id: string }) => toggleChecklistItem(stale, c.id)));
    return (await db.stops.get(id)).checklist.map((c: { done: boolean }) => c.done);
  });
  expect(done).toEqual([true, true]);
});

test('clearing the last leg date clears stale trip dates; legacy dates survive edits', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const tripsPath = '/src/lib/trips.ts';
    const dbPath = '/src/lib/db.ts';
    const { addCity, updateCity } = await import(/* @vite-ignore */ tripsPath);
    const { db } = await import(/* @vite-ignore */ dbPath);
    const pick = async (id: string) => {
      const t = await db.trips.get(id);
      return [t.startDate, t.endDate, t.returnFlightAt];
    };
    const trip = sessionStorage.getItem('testTrip')!;
    const city = await addCity(trip, 'Vienna', 'EUR');
    await updateCity(city, { arrival: '2026-10-02T09:00', departure: '2026-10-04T18:00' });
    const dated = await pick(trip);
    await updateCity(city, { arrival: '', departure: '' });
    const cleared = await pick(trip);
    // A legacy (imported) trip: stored dates, legs without dates.
    await db.trips.update(trip, { startDate: '2024-10-03', endDate: '2024-10-06' });
    await updateCity(city, { name: 'Wien' });
    return { dated, cleared, legacy: await pick(trip) };
  });
  expect(result).toEqual({
    dated: ['2026-10-02', '2026-10-04', '2026-10-04T18:00'],
    cleared: ['', '', ''],
    legacy: ['2024-10-03', '2024-10-06', ''],
  });
});

test('plan and journal edits can be undone, and clearing a journal asks first', async ({
  page,
}) => {
  const trip = await page.evaluate(async () => {
    const path = '/src/lib/trips.ts';
    const { updateTrip } = await import(/* @vite-ignore */ path);
    const id = sessionStorage.getItem('testTrip')!;
    await updateTrip(id, { planText: '# Original plan', journalText: 'Kept journal' });
    return id;
  });
  const stored = () =>
    page.evaluate(async (id) => {
      const path = '/src/lib/db.ts';
      const { db } = await import(/* @vite-ignore */ path);
      const t = await db.trips.get(id);
      return { plan: t.planText, journal: t.journalText };
    }, trip);

  await page.evaluate((id) => (location.hash = `/trip/${id}/plan`), trip);
  await page.getByRole('button', { name: 'Edit plan' }).click();
  await page.getByLabel('Itinerary (Markdown)').fill('Accidental paste');
  await expect.poll(stored).toMatchObject({ plan: 'Accidental paste' });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Undo changes' }).click();
  await expect.poll(stored).toMatchObject({ plan: '# Original plan' });

  await page.getByRole('button', { name: 'Done' }).click();

  // The journal is edited where it is read, and autosave alone can't empty one.
  await page.getByRole('tab', { name: 'Journal' }).click();
  await page.getByRole('button', { name: 'Edit journal' }).click();
  await page.getByLabel('Journal (Markdown)').fill('Rewritten on the phone');
  await expect.poll(stored).toMatchObject({ journal: 'Rewritten on the phone' });
  await page.getByLabel('Journal (Markdown)').fill('');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await stored()).journal).toBe('Rewritten on the phone');
  // The plan is untouched by any of it.
  expect((await stored()).plan).toBe('# Original plan');

  await page.evaluate((id) => (location.hash = `/trip/${id}/export`), trip);
  await page.getByPlaceholder('Paste the finished journal here…').fill('');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Save journal' }).click();
  expect((await stored()).journal).toBe('Rewritten on the phone');
});

test('an arrival and a departure saved at the same moment never store a departure before arrival', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const tripsPath = '/src/lib/trips.ts';
    const dbPath = '/src/lib/db.ts';
    const { addCity, updateCity } = await import(/* @vite-ignore */ tripsPath);
    const { db } = await import(/* @vite-ignore */ dbPath);
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = await addCity(sessionStorage.getItem('testTrip'), `Leg ${i}`, 'EUR');
      // Not awaited one after the other: both edits are in flight together.
      const r = await Promise.allSettled([
        updateCity(id, { arrival: '2026-10-16T09:00' }),
        updateCity(id, { departure: '2026-10-15T21:00' }),
      ]);
      const c = await db.cities.get(id);
      outcomes.push(
        `${r.map((x) => x.status).join('/')} ${c.arrival ?? '-'} ${c.departure ?? '-'}`,
      );
    }
    return outcomes;
  });
  for (const o of result) {
    // Exactly one of the two is refused, and what's stored makes sense.
    expect(o).toMatch(
      /^(fulfilled\/rejected 2026-10-16T09:00 -|rejected\/fulfilled - 2026-10-15T21:00)$/,
    );
  }
});

test('deleting a stop keeps a linked moment and its photos', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ db }, { addStop, deleteStop }, { addMoment }, { addPhoto }] = await Promise.all(
      ['/src/lib/db.ts', '/src/lib/stops.ts', '/src/lib/moments.ts', '/src/lib/photos.ts'].map(
        (p) => import(/* @vite-ignore */ p),
      ),
    );
    const tripId = sessionStorage.getItem('testTrip')!;
    const stopId = await addStop(tripId, 'Belvedere');
    const momentId = await addMoment({ tripId, cityId: null, title: 'Portico concert', stopId });
    // A moment's photo is filed under the stop it was linked to as well, so
    // the stop's own delete used to take it.
    const momentPhoto = await addPhoto(new Blob(['moment'], { type: 'image/png' }), {
      tripId,
      stopId,
      momentId,
      kind: 'stop',
    });
    const stopPhoto = await addPhoto(new Blob(['stop'], { type: 'image/png' }), {
      tripId,
      stopId,
      kind: 'stop',
    });
    await deleteStop(stopId);
    const moment = await db.moments.get(momentId);
    return {
      moment: moment && { title: moment.title, stopId: moment.stopId },
      momentPhoto: !!(await db.photos.get(momentPhoto)),
      stopPhoto: !!(await db.photos.get(stopPhoto)),
      tombstones: (await db.kv.where('key').startsWith('deleted-photo:').primaryKeys()).sort(),
    };
  });
  expect(result.moment).toEqual({ title: 'Portico concert', stopId: null });
  expect(result.momentPhoto).toBe(true);
  expect(result.stopPhoto).toBe(false);
  expect(result.tombstones).toHaveLength(1); // only the stop's own photo
});

test('deleting a leg detaches what pointed at it instead of orphaning it', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ db }, trips, { addStop }, { addMoment }, { addExpense }] = await Promise.all(
      [
        '/src/lib/db.ts',
        '/src/lib/trips.ts',
        '/src/lib/stops.ts',
        '/src/lib/moments.ts',
        '/src/lib/expenses.ts',
      ].map((p) => import(/* @vite-ignore */ p)),
    );
    const tripId = sessionStorage.getItem('testTrip')!;
    const cityId = await trips.addCity(tripId, 'Bologna', 'EUR');
    const keep = await trips.addCity(tripId, 'Florence', 'EUR');
    const stopId = await addStop(tripId, 'Archiginnasio', cityId);
    const keptStop = await addStop(tripId, 'Uffizi', keep);
    const momentId = await addMoment({ tripId, cityId, title: 'Portico' });
    const expenseId = await addExpense(tripId, {
      cityId,
      destination: 'Bologna',
      date: '2026-10-16',
      category: 'Food',
      subcategory: 'Lunch',
      description: 'Tigelle',
      paymentMethod: 'Card',
      amountGBP: 10,
      amountLocal: 12,
      currency: 'EUR',
      fxRate: null,
      notes: '',
    });
    const before = await trips.cityReferences(cityId);
    await trips.deleteCity(cityId);
    return {
      before,
      cities: (await db.cities.toArray()).map((c: { id: string }) => c.id),
      stop: (await db.stops.get(stopId)).cityId,
      keptStop: (await db.stops.get(keptStop)).cityId === keep,
      moment: (await db.moments.get(momentId)).cityId,
      expense: (await db.expenses.get(expenseId)).cityId,
      expenseKept: (await db.expenses.get(expenseId)).description,
    };
  });
  expect(result.before).toEqual({ stops: 1, expenses: 1, moments: 1 });
  expect(result.cities).toHaveLength(1);
  expect(result.stop).toBeNull();
  expect(result.moment).toBeNull();
  expect(result.expense).toBeNull();
  expect(result.expenseKept).toBe('Tigelle');
  expect(result.keptStop).toBe(true);
});

// A moment's time is an instant; what makes it "14:30" is the zone of the leg
// it happened in. Delete the leg and that zone has to survive, or the same
// afternoon starts reading an hour out.
test('deleting a leg keeps the time its moments and visits are read in', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ db }, trips, { addStop, toggleVisited }, { addMoment, zoneOf }, { instantToWall }] =
      await Promise.all(
        [
          '/src/lib/db.ts',
          '/src/lib/trips.ts',
          '/src/lib/stops.ts',
          '/src/lib/moments.ts',
          '/src/lib/tz.ts',
        ].map((p) => import(/* @vite-ignore */ p)),
      );
    const tripId = sessionStorage.getItem('testTrip')!;
    const cityId = await trips.addCity(tripId, 'Rome', 'EUR', { tz: 'Europe/Rome' });
    const at = Date.parse('2026-06-15T12:30:00Z'); // 14:30 in Rome, 13:30 in London
    const momentId = await addMoment({ tripId, cityId, title: 'Portico concert', at });
    const stopId = await addStop(tripId, 'Pantheon', cityId);
    await toggleVisited(await db.stops.get(stopId));
    await db.stops.update(stopId, { visitedAt: at });

    const shown = async () => {
      const cities = await db.cities.toArray();
      const m = await db.moments.get(momentId);
      const s = await db.stops.get(stopId);
      return {
        moment: instantToWall(m.at, zoneOf(m, cities)).slice(11, 16),
        stop: instantToWall(s.visitedAt, zoneOf(s, cities)).slice(11, 16),
      };
    };
    const before = await shown();
    await trips.deleteCity(cityId);
    return { before, after: await shown(), tz: (await db.moments.get(momentId)).tz };
  });
  expect(result.before).toEqual({ moment: '14:30', stop: '14:30' });
  expect(result.after).toEqual(result.before);
  expect(result.tz).toBe('Europe/Rome');
});

test('a backup whose only missing record is a leg still restores', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ db }, { addCity, deleteCity }, exp] = await Promise.all(
      ['/src/lib/db.ts', '/src/lib/trips.ts', '/src/lib/export.ts'].map(
        (p) => import(/* @vite-ignore */ p),
      ),
    );
    const tripId = sessionStorage.getItem('testTrip')!;
    const cityId = await addCity(tripId, 'Bologna', 'EUR');
    const saved = new Blob([await (await exp.buildZipBackup()).arrayBuffer()]);
    const { backup, files } = await exp.readBackupFile(saved);
    await deleteCity(cityId);
    const preview = await exp.importBackup(backup, files, { dryRun: true });
    const done = await exp.importBackup(backup, files);
    return { preview, done, city: (await db.cities.get(cityId))?.name };
  });
  expect(result.preview.cities).toBe(1);
  expect(result.done.cities).toBe(1);
  expect(result.city).toBe('Bologna');
});
