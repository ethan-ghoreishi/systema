import { test, expect } from './fixtures';

// Quick expense capture and the Travel Spending CSV contract. Synthetic data;
// FX answered locally (no network).

test('amount + one tap, a duplicate warning, a trip-wide flight, and the same CSV', async ({
  page,
}) => {
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({ json: { date: '2026-10-16', rates: { GBP: 0.85 } } }),
  );
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00Z')); // in Barcelona
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const id = await createTrip('custom');
    await addCity(id, 'Bologna', 'EUR', {
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T19:00',
      tz: 'Europe/Rome',
    });
    await addCity(id, 'Barcelona', 'EUR', {
      arrival: '2026-10-16T21:00',
      departure: '2026-10-17T21:00',
      tz: 'Europe/Madrid',
      sleep: 'hotel',
    });
    return id;
  });
  await page.goto(`/#/trip/${id}/expenses`);

  const add = async (amount: string, pick: string) => {
    await page.getByRole('button', { name: 'Add' }).click();
    const sheet = page.locator('dialog.modal[open]');
    for (const k of amount) await sheet.getByRole('button', { name: k, exact: true }).click();
    await sheet.getByRole('button', { name: pick, exact: true }).click();
    return sheet;
  };

  let sheet = await add('18', 'Museum');
  await expect(sheet.getByRole('button', { name: 'Barcelona' })).toHaveClass(/chip--on/);
  await expect(sheet.getByRole('button', { name: 'Card Payment' })).toHaveClass(/chip--on/);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.expense-row')).toHaveCount(1);

  sheet = await add('18', 'Museum');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Looks like one already saved');
  await sheet.getByRole('button', { name: 'Save anyway' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.expense-row')).toHaveCount(2);

  sheet = await add('80', 'Flight');
  await sheet.getByRole('button', { name: 'GBP', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Whole trip' })).toHaveClass(/chip--on/);
  await expect(sheet.getByRole('button', { name: 'Online Payment' })).toHaveClass(/chip--on/);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  const stored = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    return (await db.expenses.toArray()).filter((e: any) => !e.skeleton);
  });
  const flight = stored.find((e: any) => e.subcategory === 'Flight');
  expect(flight).toMatchObject({
    shared: true,
    cityId: null,
    destination: 'Bologna/Barcelona',
    amountGBP: 80,
  });
  const museum = stored.find((e: any) => e.subcategory === 'Museum');
  expect(museum).toMatchObject({
    destination: 'Barcelona',
    amountLocal: 18,
    amountGBP: 15.3,
    fxDate: '2026-10-16',
  });

  await page.getByRole('link', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download expenses (CSV)' }).click();
  const csv = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString();
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe(
    'Date,Transaction#,Destination,Category,Subcategory,Description,Payment Method,Amount (GBP),Amount (Local),Notes,Subtotal',
  );
  expect(lines).toHaveLength(5); // header, 3 rows, subtotal
  expect(lines.some((l) => l.includes(',Bologna/Barcelona,Transportation,Flight,'))).toBe(true);
  expect(lines.at(-1)).toBe(',,,,,,,,,,110.6');
});

test('a £ typed by hand is never re-priced, even when the date or amount changes', async ({
  page,
}) => {
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({ json: { date: '2026-10-16', rates: { GBP: 0.85 } } }),
  );
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const id = await createTrip('custom');
    await addCity(id, 'Yerevan', 'AMD');
    // As an older version (or the sheet import) stored it: no rate, no flag.
    await db.expenses.add({
      id: 'manual',
      tripId: id,
      cityId: null,
      date: '2026-10-16',
      destination: 'Yerevan',
      category: 'Experiences',
      subcategory: 'Museum',
      description: 'Matenadaran',
      paymentMethod: 'Cash Payment',
      amountGBP: 4.2,
      amountLocal: 2000,
      notes: '',
      currency: 'AMD',
      fxRate: null,
      skeleton: false,
      order: 0,
      createdAt: 1,
    });
    return id;
  });
  await page.goto(`/#/trip/${id}/expenses`);
  await page.getByText('Matenadaran').click();
  const sheet = page.locator('dialog.modal[open]');
  await expect(sheet.getByText('The £ was entered by hand and is kept')).toBeVisible();
  await sheet.getByLabel('Date').fill('2026-10-17');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const e = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    return db.expenses.get('manual');
  });
  expect(e).toMatchObject({ date: '2026-10-17', amountGBP: 4.2, gbpManual: true, fxRate: null });
});
