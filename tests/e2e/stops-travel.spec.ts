import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FakeNas, device, sync } from './nas-fake';

async function seed(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  if (!page.url().startsWith('http')) await page.goto('/');
  return page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity, updateTrip } = await import('/src/lib/trips.ts');
    const { importStopsFromPlan } = await import('/src/lib/stops.ts');
    const id = await createTrip('custom');
    const cityId = await addCity(id, 'Bologna', 'EUR', { tz: 'Europe/Rome' });
    const plan =
      '# Bologna\n## Route\n### Piazza Maggiore\nLocation: 44.4938, 11.3426\nThe square.\n### Archiginnasio\nLocation: 44.4935, 11.3431\nThe courtyard.\n### Due Torri\nKeep for another visit.';
    await updateTrip(id, { planText: plan });
    await importStopsFromPlan(id, plan, [], await db.cities.where('tripId').equals(id).toArray());
    return { id, cityId, stops: await db.stops.where('tripId').equals(id).sortBy('order') };
  });
}

test('a stop launches Google Maps from list, detail and map without marking a visit', async ({
  page,
  context,
}) => {
  const { id, stops } = await seed(page);
  await page.goto(`/#/trip/${id}/stops`);
  const go = page.getByRole('link', { name: 'Go to Piazza Maggiore in Google Maps' });
  await expect(go).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=44.4938%2C11.3426',
  );
  // Exercise the handoff without contacting Google or exposing any real trip.
  await context.route('https://www.google.com/maps/**', (r) =>
    r.fulfill({ body: 'Synthetic Google Maps handoff' }),
  );
  const opened = context.waitForEvent('page');
  await go.click();
  const maps = await opened;
  await maps.waitForLoadState();
  expect(maps.url()).toBe('https://www.google.com/maps/dir/?api=1&destination=44.4938%2C11.3426');
  await maps.close();
  await page.getByRole('button', { name: 'Piazza Maggiore notes' }).click();
  await expect(
    page.getByRole('link', { name: 'Directions in Google Maps', exact: true }),
  ).toHaveAttribute('href', /destination=44.4938%2C11.3426/);
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-marker-icon[title="Piazza Maggiore"]').click();
  await expect(
    page.getByRole('link', { name: 'Directions in Google Maps', exact: true }),
  ).toHaveAttribute('href', /destination=44.4938%2C11.3426/);
  expect(
    await page.evaluate(async (stopId) => {
      const { db } = await import('/src/lib/db.ts');
      return (await db.stops.get(stopId))!.visited;
    }, stops[0].id),
  ).toBe(false);
});

test('actual visit order, late correction and export remain separate from the plan, offline', async ({
  page,
  context,
}) => {
  const { id, stops } = await seed(page);
  await page.goto(`/#/trip/${id}/stops`);
  const rows = page.locator('.stop-list > .stop-row');
  await rows
    .filter({ hasText: 'Archiginnasio' })
    .getByRole('button', { name: 'Mark visited' })
    .click();
  await rows
    .filter({ hasText: 'Piazza Maggiore' })
    .getByRole('button', { name: 'Mark visited' })
    .click();
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await expect(page.locator('.visit-history .stop-name')).toHaveText([
    '1. Archiginnasio',
    '2. Piazza Maggiore',
  ]);
  await page.evaluate(async (id) => {
    const { updateTrip } = await import('/src/lib/trips.ts');
    await updateTrip(id, { status: 'done' });
  }, id);
  await context.setOffline(true);
  // A post-trip correction uses the city's clock, including on a phone in another zone.
  await page.locator('.visit-history button', { hasText: 'Piazza Maggiore' }).click();
  await page.getByRole('button', { name: 'Change visit time' }).click();
  await page.getByLabel('Actual visit time').fill('2026-10-16T10:00');
  await page.getByRole('button', { name: 'Save visit time' }).click();
  await expect(page.getByText('Fri 16 Oct, 10:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await expect(page.locator('.visit-history .stop-name')).toHaveText([
    '1. Piazza Maggiore',
    '2. Archiginnasio',
  ]);
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(rows.locator('.stop-name')).toHaveText([
    'Piazza Maggiore',
    'Archiginnasio',
    'Due Torri',
  ]);
  await expect(
    rows.filter({ hasText: 'Due Torri' }).getByRole('button', { name: 'Mark visited' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download trip pack (.md)' }).click();
  const file = await download;
  const pack = readFileSync((await file.path())!, 'utf8');
  const history = pack.split('## Places visited')[1];
  expect(history.indexOf('Piazza Maggiore')).toBeLessThan(history.indexOf('Archiginnasio'));
  expect(history).not.toContain('Due Torri');
  expect(pack).toContain('### Due Torri');
  await context.setOffline(false);
  const data = await page.evaluate(
    async ({ id, stopId }) => {
      const { db } = await import('/src/lib/db.ts');
      const { buildDataBackup } = await import('/src/lib/export.ts');
      return { stop: await db.stops.get(stopId), backup: await buildDataBackup(), id };
    },
    { id, stopId: stops[0].id },
  );
  expect(data.stop!.visitedAt).toBe(Date.parse('2026-10-16T08:00:00Z'));
  expect(data.backup.stops.find((s) => s.id === stops[0].id)).toMatchObject({
    visited: true,
    visitedAt: data.stop!.visitedAt,
    order: 0,
  });
});

test('missing pins use a city-qualified search and can be corrected without a mouse', async ({
  page,
}) => {
  const { id } = await seed(page);
  await page.goto(`/#/trip/${id}/stops`);
  await expect(page.getByRole('link', { name: 'Find Due Torri in Google Maps' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=Due+Torri%2C+Bologna',
  );
  await page.getByRole('button', { name: 'Due Torri notes' }).click();
  await page.getByText('Map location', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('91');
  await page.getByLabel('Longitude', { exact: true }).fill('11.3467');
  await page.getByRole('button', { name: 'Save map location' }).click();
  await expect(page.getByRole('alert')).toContainText('latitude');
  await page.getByLabel('Latitude', { exact: true }).fill('44.4943');
  await page.getByRole('button', { name: 'Save map location' }).click();
  await expect(
    page.getByRole('link', { name: 'Directions in Google Maps', exact: true }),
  ).toHaveAttribute('href', /destination=44.4943%2C11.3467/);
  await page.getByRole('button', { name: 'Remove map location' }).click();
  await expect(page.getByRole('link', { name: 'Find in Google Maps', exact: true })).toBeVisible();
});

test('Stops views support arrow keys, labelled panels and restored focus', async ({ page }) => {
  const { id } = await seed(page);
  await page.goto(`/#/trip/${id}/stops`);
  const list = page.getByRole('tab', { name: 'List', exact: true });
  await list.focus();
  await list.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Map', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Map', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: 'Visited', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Visited', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Visited', exact: true }).press('Home');
  await expect(list).toBeFocused();
  await page.getByRole('button', { name: 'Piazza Maggiore notes' }).click();
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await expect(page.getByRole('button', { name: 'Piazza Maggiore notes' })).toBeFocused();
});

test('historical places stay separate from Moments and linked memories remain accessible', async ({
  page,
}) => {
  const { id, cityId, stops } = await seed(page);
  await page.evaluate(
    async ({ id, cityId, stops }) => {
      const { db } = await import('/src/lib/db.ts');
      const { addMoment } = await import('/src/lib/moments.ts');
      await db.stops.update(stops[0].id, { visited: true });
      await db.stops.update(stops[1].id, {
        visited: true,
        visitedAt: Date.parse('2026-10-16T12:00Z'),
      });
      await addMoment({
        tripId: id,
        cityId,
        title: 'A courtyard concert',
        at: Date.parse('2026-10-16T09:00Z'),
        stopId: stops[1].id,
      });
      await addMoment({
        tripId: id,
        cityId,
        title: 'An unexpected market',
        at: Date.parse('2026-10-16T10:00Z'),
      });
    },
    { id, cityId, stops },
  );
  await page.evaluate(async (id) => {
    const { updateTrip } = await import('/src/lib/trips.ts');
    await updateTrip(id, {
      nameManual: 'London → Barcelona → Bologna → London: a historical trip',
    });
  }, id);
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await expect(page.locator('.visit-history .stop-name')).toHaveText([
    '1. Archiginnasio',
    'Piazza Maggiore',
  ]);
  expect(
    await page.evaluate(() => {
      const shell = document.querySelector('.app-shell')!.getBoundingClientRect();
      return [
        ...document.querySelectorAll(
          '.screen-body, .visit-history .stop-row, .moment-history .stop-row',
        ),
      ].every((e) => e.getBoundingClientRect().right <= shell.right + 1);
    }),
  ).toBe(true);
  await expect(page.locator('.moment-history .stop-name')).toHaveText([
    'A courtyard concert',
    'An unexpected market',
  ]);
  await page.locator('.visit-history button', { hasText: 'Archiginnasio' }).click();
  await page
    .getByRole('region', { name: 'Moments at this place' })
    .getByRole('button', { name: 'A courtyard concert' })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Moment', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await expect(page.locator('.visit-history button', { hasText: 'Piazza Maggiore' })).toContainText(
    'Visit time unknown',
  );
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Reorder plan' }).click();
  await page
    .locator('.stop-row', { hasText: 'Piazza Maggiore' })
    .getByRole('button', { name: 'Move down' })
    .click();
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await expect(page.locator('.visit-history .stop-name')).toHaveText([
    '1. Archiginnasio',
    'Piazza Maggiore',
  ]);
});

test('a corrected visit syncs with an independent note edit and survives ZIP restore on a fresh device', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { id, stops } = await seed(phone);
  const stopId = stops[0].id;
  await phone.evaluate(async (stopId) => {
    const { db } = await import('/src/lib/db.ts');
    await db.stops.update(stopId, { visited: true, visitedAt: Date.parse('2026-10-16T12:00Z') });
  }, stopId);
  expect((await sync(phone)).ok).toBe(true);
  expect((await sync(mac)).ok).toBe(true);
  await mac.evaluate(async (stopId) => {
    const { updateStop } = await import('/src/lib/stops.ts');
    await updateStop(stopId, { notes: 'Keep the courtyard entrance for next time.' });
  }, stopId);
  await phone.evaluate(async (stopId) => {
    const { setVisitTime } = await import('/src/lib/stops.ts');
    await setVisitTime(stopId, Date.parse('2026-10-16T08:00Z'));
  }, stopId);
  expect((await sync(mac)).ok).toBe(true);
  expect((await sync(phone)).ok).toBe(true);
  expect((await sync(mac)).ok).toBe(true);
  const zipBytes = await phone.evaluate(async () => {
    const { buildZipBackup } = await import('/src/lib/export.ts');
    return Array.from(new Uint8Array(await (await buildZipBackup()).arrayBuffer()));
  });
  const fresh = await (await makeContext()).newPage();
  await fresh.goto('/');
  await fresh.evaluate(async (bytes) => {
    const { readBackupFile, importBackup } = await import('/src/lib/export.ts');
    const { backup, files } = await readBackupFile(new Blob([new Uint8Array(bytes)]));
    await importBackup(backup, files);
  }, zipBytes);
  for (const page of [phone, mac, fresh]) {
    const row = await page.evaluate(async (stopId) => {
      const { db } = await import('/src/lib/db.ts');
      return db.stops.get(stopId);
    }, stopId);
    expect(row).toMatchObject({
      visited: true,
      visitedAt: Date.parse('2026-10-16T08:00Z'),
      notes: 'Keep the courtyard entrance for next time.',
      lat: 44.4938,
      lng: 11.3426,
      order: 0,
    });
    await page.goto(`/#/trip/${id}/stops`);
    await page.getByRole('tab', { name: 'Visited', exact: true }).click();
    await expect(page.locator('.visit-history .stop-name')).toHaveText(['1. Piazza Maggiore']);
  }
});

test('reopening a stop shows the pin and note as they are now, not as they were', async ({
  page,
}) => {
  const { id, stops } = await seed(page);
  const stopId = stops[0].id;
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: 'Piazza Maggiore notes' }).click();
  await page.getByText('Map location', { exact: true }).click();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('44.4938');
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  // The pin moves and the note changes while the detail is closed: a drag on
  // the map, another device's sync, a restored backup.
  await page.evaluate(async (stopId) => {
    const { placeStop, updateStop } = await import('/src/lib/stops.ts');
    await placeStop(stopId, { lat: 44.5, lng: 11.35 });
    await updateStop(stopId, { notes: 'Enter from the north arcade.' });
  }, stopId);
  await page.getByRole('button', { name: 'Piazza Maggiore notes' }).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Enter from the north arcade.',
  );
  await page.getByText('Map location', { exact: true }).click();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('44.5');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('11.35');
  // Saving what is on screen must keep the moved pin, not put the old one back.
  await page.getByRole('button', { name: 'Save map location' }).click();
  await expect(
    page.getByRole('link', { name: 'Directions in Google Maps', exact: true }),
  ).toHaveAttribute('href', /destination=44.5%2C11.35/);
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await expect(
    page.getByRole('link', { name: 'Go to Piazza Maggiore in Google Maps' }),
  ).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=44.5%2C11.35');
  expect(
    await page.evaluate(async (stopId) => {
      const { db } = await import('/src/lib/db.ts');
      return db.stops.get(stopId);
    }, stopId),
  ).toMatchObject({ lat: 44.5, lng: 11.35, notes: 'Enter from the north arcade.' });
});

test('deleting the last place from Visited leaves Stops usable, not stuck on an empty view', async ({
  page,
}) => {
  const { id, stops } = await seed(page);
  await page.evaluate(
    async (ids) => {
      const { deleteStop } = await import('/src/lib/stops.ts');
      for (const stopId of ids) await deleteStop(stopId);
    },
    [stops[1].id, stops[2].id],
  );
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: 'Mark visited' }).click();
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await page.locator('.visit-history button', { hasText: 'Piazza Maggiore' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete stop' }).click();
  // Nothing left to show, so Stops must offer the way back in — the remembered
  // view cannot be a dead end, on this visit or after a reload.
  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    await expect(page.getByPlaceholder('Add a stop')).toBeVisible();
    await expect(page.getByRole('button', { name: /Extract 3 stops from the plan/ })).toBeVisible();
  }
  await page.getByRole('button', { name: /Extract 3 stops from the plan/ }).click();
  // With places again, the remembered view and its selector come back.
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(page.locator('.stop-list > .stop-row')).toHaveCount(3);
});

test('an old trip records a visit without inventing today, and a mistaken time can be cleared', async ({
  page,
}) => {
  const { id, cityId, stops } = await seed(page);
  // A legs-based trip: the dates live on the leg, not in the trip's fallback.
  await page.evaluate(async (cityId) => {
    const { updateCity } = await import('/src/lib/trips.ts');
    await updateCity(cityId, { arrival: '2020-01-01T10:00', departure: '2020-01-02T18:00' });
  }, cityId);
  await page.goto(`/#/trip/${id}/stops`);
  await page
    .locator('.stop-row', { hasText: 'Piazza Maggiore' })
    .getByRole('button', { name: 'Mark visited', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Visited', exact: true }).click();
  await expect(page.locator('.visit-history .stop-name')).toHaveText(['Piazza Maggiore']);
  await page.locator('.visit-history button', { hasText: 'Piazza Maggiore' }).click();
  await page.getByRole('button', { name: 'Change visit time' }).click();
  await page.getByLabel('Actual visit time').fill('2020-01-02T10:00');
  await page.getByRole('button', { name: 'Save visit time' }).click();
  await page.getByRole('button', { name: 'Change visit time' }).click();
  await page.getByRole('button', { name: 'Clear visit time', exact: true }).click();
  const saved = await page.evaluate(async (stopId) => {
    const { buildDataBackup } = await import('/src/lib/export.ts');
    return (await buildDataBackup()).stops.find((s) => s.id === stopId);
  }, stops[0].id);
  expect(saved).toMatchObject({ visited: true, order: 0 });
  expect(saved).not.toHaveProperty('visitedAt');
});

test('sync while a stop is open cannot overwrite newer notes or pins, and autosave resumes after review', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { id, stops } = await seed(phone);
  const stopId = stops[0].id;
  expect((await sync(phone)).ok).toBe(true);
  expect((await sync(mac)).ok).toBe(true);
  await phone.goto(`/#/trip/${id}/stops/${stopId}`);
  await expect(phone.getByLabel('Notes', { exact: true })).toHaveValue('The square.');
  await mac.evaluate(async (stopId) => {
    const { updateStop, placeStop } = await import('/src/lib/stops.ts');
    await updateStop(stopId, { notes: 'Synced entrance instructions.' });
    await placeStop(stopId, { lat: 44.5, lng: 11.35 });
  }, stopId);
  expect((await sync(mac)).ok).toBe(true);
  expect((await sync(phone)).ok).toBe(true);
  // The rendered draft is stale. The write itself must compare with storage,
  // rather than depending on the live query having refreshed in time.
  await phone.getByLabel('Notes', { exact: true }).fill('The square. My stale addition.');
  await expect(phone.getByRole('alert')).toContainText('changed elsewhere');
  await expect(phone.getByLabel('Notes', { exact: true })).toHaveValue(
    'The square. My stale addition.',
  );
  const read = () =>
    phone.evaluate(async (stopId) => {
      const { db } = await import('/src/lib/db.ts');
      return db.stops.get(stopId);
    }, stopId);
  expect(await read()).toMatchObject({
    notes: 'Synced entrance instructions.',
    lat: 44.5,
    lng: 11.35,
  });
  await phone.getByRole('button', { name: 'Reload saved details (discards draft)' }).click();
  await expect(phone.getByLabel('Notes', { exact: true })).toHaveValue(
    'Synced entrance instructions.',
  );
  await phone.getByLabel('Notes', { exact: true }).fill('');
  await phone
    .getByLabel('Notes', { exact: true })
    .pressSequentially('Synced entrance instructions. Keep the archway.');
  await expect
    .poll(async () => (await read())?.notes)
    .toBe('Synced entrance instructions. Keep the archway.');
  await phone.getByText('Map location', { exact: true }).click();
  await phone.getByLabel('Latitude', { exact: true }).fill('44.6');
  // A remote removal is an edit too. Saving must not resurrect the old pin.
  await mac.evaluate(async (stopId) => {
    const { placeStop } = await import('/src/lib/stops.ts');
    await placeStop(stopId, null);
  }, stopId);
  expect((await sync(mac)).ok).toBe(true);
  expect((await sync(phone)).ok).toBe(true);
  await phone.getByRole('button', { name: 'Save map location' }).click();
  await expect(phone.getByRole('alert')).toContainText('changed elsewhere');
  await expect(phone.getByLabel('Latitude', { exact: true })).toHaveValue('44.6');
  expect(await read()).not.toHaveProperty('lat');
  await phone.getByRole('button', { name: 'Reload saved details (discards draft)' }).click();
  await expect(phone.getByLabel('Latitude', { exact: true })).toHaveValue('');
  await phone.getByLabel('Latitude', { exact: true }).fill('44.7');
  await phone.getByLabel('Longitude', { exact: true }).fill('11.7');
  await phone.getByRole('button', { name: 'Save map location' }).click();
  await expect.poll(async () => (await read())?.lat).toBe(44.7);
  // Unrelated fields do not cause false conflicts in a notes-only autosave.
  await phone.getByLabel('Notes', { exact: true }).fill('Reviewed note.');
  await expect.poll(async () => (await read())?.notes).toBe('Reviewed note.');
});

test('removing a pin from an open editor cannot erase a pin moved elsewhere', async ({ page }) => {
  const { id, stops } = await seed(page);
  await page.goto(`/#/trip/${id}/stops/${stops[0].id}`);
  await page.getByText('Map location', { exact: true }).click();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('44.4938');
  await page.evaluate(async (stopId) => {
    const { placeStop } = await import('/src/lib/stops.ts');
    await placeStop(stopId, { lat: 44.8, lng: 11.8 });
  }, stops[0].id);
  await page.getByRole('button', { name: 'Remove map location' }).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  expect(
    await page.evaluate(async (stopId) => {
      const { db } = await import('/src/lib/db.ts');
      return db.stops.get(stopId);
    }, stops[0].id),
  ).toMatchObject({ lat: 44.8, lng: 11.8 });
});
