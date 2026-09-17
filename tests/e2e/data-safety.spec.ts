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
