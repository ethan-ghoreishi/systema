import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

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

test('photo backup restores atomically and preserves existing device records', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit' && process.platform === 'darwin',
    'This macOS Playwright WebKit rejects IndexedDB Blob writes; covered in Chromium and Linux WebKit.',
  );
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildBackup, importBackup } = await import(/* @vite-ignore */ exportPath);
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
    const backup = await buildBackup();
    await db.photos.delete('synthetic-photo');
    await db.trips.update(id, { planText: 'Newer device plan' });
    let error = '';
    try {
      await importBackup(backup);
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
    const { buildBackup, importBackup } = await import(/* @vite-ignore */ exportPath);
    const backup = await buildBackup();
    const identical = await importBackup(backup);
    await db.trips.update(sessionStorage.getItem('testTrip'), {
      planText: 'Edited on this device',
    });
    const edited = await importBackup(backup);
    return [identical.differing, edited.differing];
  });
  expect(result).toEqual([0, 1]);
});

test('invalid backup writes nothing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const exportPath = '/src/lib/export.ts';
    const { db } = await import(/* @vite-ignore */ dbPath);
    const { buildBackup, importBackup } = await import(/* @vite-ignore */ exportPath);
    const backup = await buildBackup();
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
  await page.locator('dialog input[type="file"]').setInputFiles({
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

test('a first NAS push merges the NAS copy first, so it never buries it', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit' && process.platform === 'darwin',
    'This macOS Playwright WebKit rejects IndexedDB Blob writes; covered in Chromium.',
  );
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
