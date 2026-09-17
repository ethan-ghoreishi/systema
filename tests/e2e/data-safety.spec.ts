import { test, expect } from '@playwright/test';

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
