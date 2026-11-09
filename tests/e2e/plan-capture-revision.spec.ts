import { test, expect } from './fixtures';
import { device, FakeNas, sync } from './nas-fake';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);

test('review a reordered, renamed, reduced route without losing personal records, then sync and restore', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const page = await device(makeContext, nas);
  const ids = await page.evaluate(async () => {
    const {
      db,
      createTrip,
      addCity,
      addStop,
      importStopsFromPlan,
      updateStop,
      addMoment,
      addPhoto,
    } = (window as any).m;
    const trip = await createTrip('custom');
    const rome = await addCity(trip, 'Rome', 'EUR', { tz: 'Europe/Rome' });
    const london = await addCity(trip, 'London', 'GBP', { tz: 'Europe/London' });
    const planText =
      '# Rome\n## Route\n### Museum\nOld research\nAnchor: Old entrance\n- [ ] Look up\n### Square\nOld square\n### Removed\nKeep my visit\n# London\n## Route\n### Museum\nLondon museum';
    await db.trips.update(trip, { planText });
    await importStopsFromPlan(
      trip,
      planText,
      [],
      await db.cities.where('tripId').equals(trip).sortBy('order'),
    );
    const rows = await db.stops.where('tripId').equals(trip).sortBy('order');
    const museum = rows[0],
      square = rows[1],
      removed = rows[2];
    await updateStop(museum.id, {
      notes: 'My entrance notes',
      lat: 41.9,
      lng: 12.4,
      bookingRef: 'KEEP',
      booked: true,
      checklist: [{ id: 'tick', text: 'Look up', done: true }],
    });
    await updateStop(removed.id, { visited: true, visitedAt: 123 });
    const moment = await addMoment({
      tripId: trip,
      cityId: rome,
      stopId: removed.id,
      title: 'My memory',
      at: 123,
    });
    await addPhoto(new Blob(['kept bytes'], { type: 'image/png' }), {
      tripId: trip,
      kind: 'stop',
      stopId: removed.id,
      momentId: moment,
    });
    // Added by hand, never part of the plan: a revised route has no say over it.
    const mine = await addStop(trip, 'Dinner with Ana', rome);
    return {
      mine,
      trip,
      rome,
      london,
      museum: museum.id,
      square: square.id,
      removed: removed.id,
      moment,
      londonMuseum: rows[3].id,
    };
  });
  expect((await sync(page)).ok).toBe(true);
  await page.goto(`/#/trip/${ids.trip}/plan`);
  await page.getByRole('button', { name: 'Paste revised plan' }).click();
  const sheet = page.locator('dialog[open]');
  await sheet
    .getByLabel('Plan text', { exact: true })
    .fill(
      '# Rome\n## Route\n### New square name\nUpdated square\n### Museum\nRevised research\nAnchor: New entrance\nLocation: 42, 13\n- [ ] Look down\n### Added place\nLocation: 41.8, 12.3\n# London\n## Route\n### Museum\nRevised London museum',
    );
  await sheet.getByRole('button', { name: 'Review Stops', exact: true }).click();
  // An unchanged place states what will happen to it and needs no interaction.
  await expect(sheet.getByText('Keeps your record · Rome', { exact: true }).first()).toBeVisible();
  await sheet
    .getByRole('button', { name: 'Match an existing place for 1. New square name' })
    .click();
  await sheet.getByLabel('1. New square name · Rome').selectOption(ids.square);
  // Matching across legs is allowed, but never silently moves the record.
  await sheet.getByRole('button', { name: 'Match an existing place for 3. Added place' }).click();
  await sheet.getByLabel('3. Added place · Rome').selectOption(ids.londonMuseum);
  await expect(sheet.getByText('This record belongs to London and stays there')).toBeVisible();
  await sheet.getByLabel('3. Added place · Rome').selectOption('');
  await expect(sheet.getByRole('region', { name: 'Kept off the route' })).toContainText(
    'Removed · visited',
  );
  await expect(sheet.getByRole('region', { name: 'Kept on the route' })).toContainText(
    'Dinner with Ana',
  );
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet).toHaveCount(0);
  const check = async () =>
    page.evaluate(async (ids) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return {
        rows: await db.stops.where('tripId').equals(ids.trip).sortBy('order'),
        moment: await db.moments.get(ids.moment),
        photos: await db.photos.count(),
      };
    }, ids);
  const result = await check();
  const pack = await page.evaluate(async () => {
    const m = (window as any).m;
    return m.buildTripPack({
      trip: (await m.db.trips.toArray())[0],
      cities: await m.db.cities.toArray(),
      stops: await m.db.stops.toArray(),
      expenses: [],
      photos: [],
    });
  });
  expect(pack.split('## Stops (planned order)')[1].split('## Retained places')[0]).not.toContain(
    'Removed',
  );
  expect(pack).toContain('## Retained places (off the current route)');
  expect(result.rows.map((s: any) => [s.name, !!s.offPlan])).toEqual([
    ['New square name', false],
    ['Museum', false],
    ['Added place', false],
    ['Dinner with Ana', false],
    ['Museum', false],
    ['Removed', true],
  ]);
  expect(result.rows[3].id).toBe(ids.mine);
  expect(result.rows[0].id).toBe(ids.square);
  expect(result.rows[1]).toMatchObject({
    id: ids.museum,
    notes: 'My entrance notes',
    lat: 41.9,
    lng: 12.4,
    bookingRef: 'KEEP',
    guide: { anchor: 'New entrance' },
    checklist: [
      { id: 'tick', text: 'Look up', done: true },
      { text: 'Look down', done: false },
    ],
  });
  expect(result.rows[4]).toMatchObject({ id: ids.londonMuseum, notes: 'Revised London museum' });
  expect(result.rows[5]).toMatchObject({ id: ids.removed, visitedAt: 123 });
  expect(result.moment?.stopId).toBe(ids.removed);
  expect(result.photos).toBe(1);
  await page.goto(`/#/trip/${ids.trip}/stops`);
  await page.getByText('Kept off the route (1)', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Removed · visited', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await expect(page.locator('.visit-history')).toContainText('Removed');
  expect((await sync(page)).ok).toBe(true);
  const other = await device(makeContext, nas);
  expect((await sync(other)).ok).toBe(true);
  expect(
    await other.evaluate(async (id) => {
      const { db, buildZipBackup, readBackupFile, importBackup } = (window as any).m;
      const saved = await buildZipBackup();
      const { backup, files } = await readBackupFile(saved);
      await importBackup(backup, files);
      return {
        rows: await db.stops.where('tripId').equals(id).sortBy('order'),
        photos: await db.photos.count(),
      };
    }, ids.trip),
  ).toMatchObject({
    rows: result.rows.map((s: any) => ({
      id: s.id,
      ...(s.offPlan === undefined ? {} : { offPlan: s.offPlan }),
      notes: s.notes,
    })),
    photos: 1,
  });
});

test('a stale plan review refuses concurrent edits and an unstructured paste keeps the route', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addStop } = await import(/* @vite-ignore */ '/src/lib/stops.ts');
    const id = await createTrip('custom');
    await addStop(id, 'Keep me');
    return id;
  });
  await page.goto(`/#/trip/${id}/plan`);
  await page.getByRole('button', { name: 'Paste plan', exact: true }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Plan text', { exact: true }).fill('No machine-readable route here');
  await sheet.getByRole('button', { name: 'Review Stops', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('keeps your existing route');
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const stop = (await db.stops.toArray())[0];
    await db.stops.update(stop.id, { notes: 'Changed elsewhere' });
  });
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet.getByRole('alert').first()).toContainText('changed elsewhere');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Paste plan', exact: true }).click();
  await sheet.getByLabel('Plan text', { exact: true }).fill('No machine-readable route here');
  await sheet.getByRole('button', { name: 'Review Stops', exact: true }).click();
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.stops.toArray()).map((s: any) => ({
        name: s.name,
        notes: s.notes,
        offPlan: !!s.offPlan,
      }));
    }),
  ).toEqual([{ name: 'Keep me', notes: 'Changed elsewhere', offPlan: false }]);
});

test('real Moment photos open from List and Visited, survive NAS and ZIP, and delete through sync', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const page = await device(makeContext, nas);
  const id = await page.evaluate(async () => {
    const { createTrip } = (window as any).m;
    return createTrip('custom');
  });
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: 'What happened?' }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Place or event').fill('Photographed courtyard');
  await sheet
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'courtyard.png', mimeType: 'image/png', buffer: png });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.locator('.moment-row').click();
  const image = sheet.locator('.photo-grid img');
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await sheet.getByRole('button', { name: 'View photo of Photographed courtyard' }).click();
  await expect(page.getByRole('dialog', { name: 'Photograph' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close photo' }).click();
  await expect(page.getByRole('dialog', { name: 'Photograph' })).toBeHidden();
  await sheet.getByText('Map location (optional)', { exact: true }).click();
  await sheet.getByLabel('Latitude').fill('41.91');
  await sheet.getByLabel('Longitude').fill('12.45');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await page.locator('.moment-row').click();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await sync(page)).ok).toBe(true);
  const other = await device(makeContext, nas);
  expect((await sync(other)).ok).toBe(true);
  await other.evaluate(async () => {
    const m = (window as any).m;
    const { backup, files } = await m.readBackupFile(await m.buildZipBackup());
    await m.importBackup(backup, files);
  });
  await other.goto(`/#/trip/${id}/stops`);
  await other.locator('.moment-row').click();
  const otherSheet = other.locator('dialog[open]');
  await expect
    .poll(() =>
      otherSheet.locator('.photo-grid img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  other.once('dialog', (d) => d.accept());
  await otherSheet.getByRole('button', { name: 'Delete photo', exact: true }).click();
  await expect(otherSheet.locator('.photo-grid img')).toHaveCount(0);
  await otherSheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await sync(other)).ok).toBe(true);
  expect((await sync(page)).ok).toBe(true);
  expect(await page.evaluate(() => (window as any).m.db.photos.count())).toBe(0);
});

test('editing similar expenses saves once and preserves payment, FX and booking links', async ({
  page,
}) => {
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({ json: { date: '2026-10-16', rates: { GBP: 0.85 } } }),
  );
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addExpense } = await import(/* @vite-ignore */ '/src/lib/expenses.ts');
    const trip = await createTrip('custom');
    const city = await addCity(trip, 'Rome', 'EUR');
    const fields = {
      cityId: city,
      destination: 'Rome',
      date: '2026-10-16',
      category: 'Experiences',
      subcategory: 'Museum',
      description: 'Same museum',
      paymentMethod: 'Cash Payment',
      amountLocal: 10,
      amountGBP: 8.5,
      currency: 'EUR',
      fxRate: 0.85,
      notes: 'FX: 1 EUR = £0.85',
    };
    const expense = await addExpense(trip, fields);
    await db.expenses.update(expense, { need: 'stop:test', fxDate: '2026-10-16' });
    await addExpense(trip, fields);
    return { trip, expense };
  });
  await page.goto(`/#/trip/${ids.trip}/expenses`);
  const row = page.locator('.expense-row').first();
  await row.click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Notes', { exact: true }).fill('Corrected note · FX: 1 EUR = £0.85');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await row.click();
  await sheet.getByLabel('Amount (GBP) override', { exact: true }).fill('8,75');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return { count: await db.expenses.count(), expense: await db.expenses.get(id) };
    }, ids.expense),
  ).toMatchObject({
    count: 2,
    expense: {
      id: ids.expense,
      need: 'stop:test',
      paymentMethod: 'Cash Payment',
      amountLocal: 10,
      amountGBP: 8.75,
      gbpManual: true,
      fxRate: null,
      notes: 'Corrected note',
    },
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await sheet.getByLabel('Amount (EUR)', { exact: true }).fill('1,234');
  await expect(sheet.getByRole('alert')).toContainText('Enter an amount above zero');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('date-only and approximate Moments never acquire a clock time and keep their date when changing city', async ({
  page,
}) => {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addMoment } = await import(/* @vite-ignore */ '/src/lib/moments.ts');
    const { wallToInstant } = await import(/* @vite-ignore */ '/src/lib/tz.ts');
    const trip = await createTrip('custom');
    const east = await addCity(trip, 'Kiritimati', 'USD', { tz: 'Pacific/Kiritimati' });
    const west = await addCity(trip, 'Honolulu', 'USD', { tz: 'Pacific/Honolulu' });
    const moment = await addMoment({
      tripId: trip,
      cityId: east,
      title: 'Historical memory',
      at: wallToInstant('2020-05-03T12:00', 'Pacific/Kiritimati'),
      timePrecision: 'date',
    });
    return { trip, moment, west, east, count: await db.moments.count() };
  });
  await page.goto(`/#/trip/${ids.trip}/stops`);
  await page.locator('.moment-row').click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByRole('button', { name: 'Honolulu', exact: true }).click();
  await expect(sheet).toContainText('3 May');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.locator('.moment-row').click();
  await sheet.getByRole('button', { name: 'change', exact: true }).click();
  await expect(sheet.getByLabel('When', { exact: true })).toHaveValue('2020-05-03');
  await sheet.getByLabel('When did it happen?').selectOption('exact');
  await expect(sheet.getByLabel('When', { exact: true })).toHaveValue('');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await sheet.getByLabel('When did it happen?').selectOption('approximate');
  await expect(sheet.getByLabel('When', { exact: true })).toHaveValue('2020-05-03');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.locator('.moment-row').click();
  await sheet.getByRole('button', { name: 'change', exact: true }).click();
  await sheet.getByLabel('When did it happen?').selectOption('exact');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await sheet.getByLabel('When', { exact: true }).fill('2020-05-03T09:15');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const { instantToWall } = await import(/* @vite-ignore */ '/src/lib/tz.ts');
      const m = await db.moments.get(id);
      return { precision: m.timePrecision, wall: instantToWall(m.at, 'Pacific/Honolulu') };
    }, ids.moment),
  ).toEqual({ precision: undefined, wall: '2020-05-03T09:15' });
});

test('editing plan text stages the change until review, and a cancelled review keeps the draft', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, updateTrip } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addStop } = await import(/* @vite-ignore */ '/src/lib/stops.ts');
    const id = await createTrip('custom');
    await updateTrip(id, { planText: '## Route\n### Old place\nOriginal' });
    await addStop(id, 'Old place');
    return id;
  });
  await page.goto(`/#/trip/${id}/plan`);
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.getByLabel('Itinerary (Markdown)').fill('## Route\n### New place\nRevised');
  await page.getByRole('button', { name: 'Review Stops', exact: true }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Itinerary (Markdown)')).toHaveValue(
    '## Route\n### New place\nRevised',
  );
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.trips.get(id)).planText;
    }, id),
  ).toBe('## Route\n### Old place\nOriginal');
  // The draft also survives leaving the trip and coming back.
  await page.goto(`/#/trip/${id}/stops`);
  await page.goto(`/#/trip/${id}/plan`);
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await expect(page.getByLabel('Itinerary (Markdown)')).toHaveValue(
    '## Route\n### New place\nRevised',
  );
  await page.getByRole('button', { name: 'Review Stops', exact: true }).click();
  await sheet.getByRole('button', { name: 'Match an existing place for 1. New place' }).click();
  await sheet.getByLabel('1. New place').selectOption({ label: 'Old place · keep this record' });
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet).toHaveCount(0);
  // Unknown personal text on this legacy stop is kept; its untouched imported name can change.
  await expect(page.getByRole('button', { name: 'Edit plan', exact: true })).toBeVisible();
});

test('a concurrent expense correction is not overwritten by an open editor', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addExpense } = await import(/* @vite-ignore */ '/src/lib/expenses.ts');
    const trip = await createTrip('custom');
    const city = await addCity(trip, 'London', 'GBP');
    const expense = await addExpense(trip, {
      cityId: city,
      date: '2020-01-01',
      destination: 'London',
      category: 'Food',
      subcategory: 'Grocery Shopping',
      description: 'Food',
      paymentMethod: 'Cash Payment',
      currency: 'GBP',
      amountGBP: 10,
      amountLocal: 10,
      fxRate: null,
      notes: '',
    });
    return { trip, expense };
  });
  await page.goto(`/#/trip/${ids.trip}/expenses`);
  await page.locator('.expense-row').click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Notes', { exact: true }).fill('My unsaved note');
  await page.evaluate(async (id) => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.expenses.update(id, { amountGBP: 12, amountLocal: 12 });
  }, ids.expense);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('changed elsewhere');
  await expect(sheet.getByLabel('Notes', { exact: true })).toHaveValue('My unsaved note');
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.expenses.get(id)).amountGBP;
    }, ids.expense),
  ).toBe(12);
});

test('re-applying an unchanged plan to a trip that returns to a city changes nothing', async ({
  page,
}) => {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { importStopsFromPlan, updateStop, addStop, returnToRoute } = await import(
      /* @vite-ignore */ '/src/lib/stops.ts'
    );
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const trip = await createTrip('custom');
    const v1 = await addCity(trip, 'Vienna', 'EUR');
    const sb = await addCity(trip, 'Salzburg', 'EUR');
    const v2 = await addCity(trip, 'Vienna', 'EUR');
    const planText =
      '# Vienna\n## Route\n### Belvedere\nGarden side\n### Naschmarkt\nMarket\n# Salzburg\n## Route\n### Fortress\nAbove the river';
    await db.trips.update(trip, { planText });
    await importStopsFromPlan(
      trip,
      planText,
      [],
      await db.cities.where('tripId').equals(trip).sortBy('order'),
    );
    // The traveller puts the Vienna places on the first visit, adds a place of
    // their own on the second, and returns a retained place to the route.
    for (const s of await db.stops.where('tripId').equals(trip).toArray())
      if (s.cityId !== sb) await updateStop(s.id, { cityId: v1 });
    await addStop(trip, 'Café Central', v2);
    const kept = await addStop(trip, 'Mirabell', sb);
    await db.stops.update(kept, { offPlan: true, order: 99 });
    await returnToRoute(kept);
    const rows = await db.stops.where('tripId').equals(trip).sortBy('order');
    return {
      trip,
      v1,
      sb,
      v2,
      stops: rows.map((s) => ({ id: s.id, name: s.name, cityId: s.cityId })),
    };
  });
  // The route being re-applied to, as the traveller left it.
  expect(ids.stops.map((s) => [s.name, s.cityId])).toEqual([
    ['Belvedere', ids.v1],
    ['Naschmarkt', ids.v1],
    ['Fortress', ids.sb],
    ['Mirabell', ids.sb],
    ['Café Central', ids.v2],
  ]);
  await page.goto(`/#/trip/${ids.trip}/stops`);
  await page.getByRole('button', { name: 'Review Stops from plan' }).click();
  const sheet = page.locator('dialog[open]');
  await expect(sheet.getByRole('region', { name: 'Kept off the route' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(async (trip) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.stops.where('tripId').equals(trip).sortBy('order')).map((s: any) => ({
        id: s.id,
        name: s.name,
        cityId: s.cityId,
        offPlan: !!s.offPlan,
      }));
    }, ids.trip),
  ).toEqual(ids.stops.map((s) => ({ ...s, offPlan: false })));
});

test('a place put back on the route stays there when the plan is applied again', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { importStopsFromPlan } = await import(/* @vite-ignore */ '/src/lib/stops.ts');
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const trip = await createTrip('custom');
    const rome = await addCity(trip, 'Rome', 'EUR');
    const lisbon = await addCity(trip, 'Lisbon', 'EUR');
    const planText =
      '# Rome\n## Route\n### Museum\nOne\n### Market\nTwo\n# Lisbon\n## Route\n### Castle\nThree';
    await db.trips.update(trip, { planText });
    await importStopsFromPlan(
      trip,
      planText,
      [],
      await db.cities.where('tripId').equals(trip).sortBy('order'),
    );
    await db.trips.update(trip, {
      planText: '# Rome\n## Route\n### Museum\nOne\n# Lisbon\n## Route\n### Castle\nThree',
    });
    const market = (await db.stops.where('tripId').equals(trip).sortBy('order'))[1];
    // Off the route and last of all: putting it back must not leave it there.
    await db.stops.update(market.id, { offPlan: true, order: 9 });
    void rome;
    void lisbon;
    return trip;
  });
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByText('Kept off the route (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Return to route' }).click();
  // Back on the route, and beside its own leg rather than after the other city.
  await expect(page.getByText('Kept off the route (1)', { exact: true })).toHaveCount(0);
  await expect(page.locator('.stop-name')).toHaveText(['Museum', 'Market', 'Castle']);
  await page.getByRole('button', { name: 'Review Stops from plan' }).click();
  const sheet = page.locator('dialog[open]');
  await expect(sheet.getByRole('region', { name: 'Kept on the route' })).toContainText('Market');
  await sheet.getByRole('button', { name: 'Apply plan' }).click();
  await expect(sheet).toHaveCount(0);
  expect(
    await page.evaluate(async (trip) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.stops.where('tripId').equals(trip).sortBy('order')).map((s: any) => [
        s.name,
        !!s.offPlan,
      ]);
    }, id),
  ).toEqual([
    ['Museum', false],
    // Back beside the last place on its own leg, never after a later city.
    ['Market', false],
    ['Castle', false],
  ]);
});
