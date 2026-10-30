import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Off-plan moments, library imports in capture order, and journal photos by
// reference. Synthetic images only (a JPEG header carrying an EXIF time).

function jpegTakenAt(date: string): Buffer {
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
  const d = str(date);
  const exifIfd = 8 + 2 + 12 + 4;
  const dataAt = exifIfd + 2 + 12 + 4;
  const tiff = [
    0x49,
    0x49,
    ...u16(42),
    ...u32(8),
    ...u16(1),
    ...u16(0x8769),
    ...u16(4),
    ...u32(1),
    ...u32(exifIfd),
    ...u32(0),
    ...u16(1),
    ...u16(0x9003),
    ...u16(2),
    ...u32(d.length),
    ...u32(dataAt),
    ...u32(0),
    ...d,
  ];
  const app1 = [...str('Exif'), 0, ...tiff];
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
    0xff,
    0xda,
    0,
    2,
  ]);
}

test('a moment off the plan, with library photos in the order they were taken', async ({
  makeContext,
}) => {
  const context = await makeContext({ timezoneId: 'Europe/London' });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.clock.setFixedTime(new Date('2026-10-16T11:00:00Z')); // 13:00 in Bologna
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const trips = '/src/lib/trips.ts';
    const stopsPath = '/src/lib/stops.ts';
    const { createTrip, addCity } = await import(/* @vite-ignore */ trips);
    const { addStop, toggleVisited } = await import(/* @vite-ignore */ stopsPath);
    const id = await createTrip('custom');
    const blq = await addCity(id, 'Bologna', 'EUR', {
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
    const s = await addStop(id, 'Archiginnasio', blq);
    const db = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await toggleVisited(await db.db.stops.get(s));
    return id;
  });

  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: 'What happened?' }).click();
  const sheet = page.locator('dialog.modal[open]');
  await expect(sheet.getByRole('button', { name: 'Bologna' })).toHaveClass(/chip--on/);
  await expect(sheet.getByText('Now · 13:00')).toBeVisible();
  await sheet.getByLabel('Place or event').fill('Portico concert');
  await sheet.getByLabel('Why it mattered').fill('Strangers singing under the arcades');
  // Picked out of order; stored in the order they were taken.
  await sheet.locator('input[type="file"]:not([capture])').setInputFiles([
    { name: 'IMG_2.jpg', mimeType: 'image/jpeg', buffer: jpegTakenAt('2026:10:16 13:20:00') },
    { name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: jpegTakenAt('2026:10:16 13:05:00') },
  ]);
  await expect(sheet.getByText('2 photos to add.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  const row = page.locator('.moment-row');
  await expect(row).toContainText('Portico concert');
  await expect(row).toContainText('off-plan · 13:00 · 2 photos');

  const photos = await page.evaluate(async () => {
    const db = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const ps = await db.db.photos.toArray();
    return ps
      .sort((a: any, b: any) => a.createdAt - b.createdAt)
      .map((p: any) => ({ id: p.id, takenAt: p.takenAt, moment: !!p.momentId }));
  });
  expect(photos.map((p) => new Date(p.takenAt).toISOString())).toEqual([
    '2026-10-16T11:05:00.000Z',
    '2026-10-16T11:20:00.000Z',
  ]);
  expect(photos.every((p) => p.moment)).toBe(true);
  const ref = (id: string) => `P-${id.replace(/-/g, '').slice(0, 6)}`;

  await page.getByRole('link', { name: 'Export' }).click();
  await page.getByText('Preview trip pack').click();
  const pack = page.locator('.pack-preview');
  await expect(pack).toContainText('## Unplanned / serendipitous moments (in visit order)');
  await expect(pack).toContainText('off-plan: Portico concert (Bologna)');
  await expect(pack).toContainText(
    `1. [photo: ${ref(photos[0].id)}] Bologna, Portico concert, Fri 16 Oct, 13:05`,
  );
  await expect(pack).toContainText(
    `2. [photo: ${ref(photos[1].id)}] Bologna, Portico concert, Fri 16 Oct, 13:20`,
  );

  // The journal comes back with a reference; the right photo lands there.
  await page
    .getByPlaceholder('Paste the finished journal here…')
    .fill(
      `# Bologna\n\nThe concert under the arcades.\n\n[photo: ${ref(photos[1].id)}]\n\nThen Barcelona.`,
    );
  await page.getByRole('button', { name: 'Save journal' }).click();
  await page.getByRole('link', { name: 'Plan' }).click();
  await page.getByRole('tab', { name: 'Journal' }).click();
  await expect(page.locator('.journal-photo figcaption').first()).toHaveText('Portico concert');
  await expect(page.locator('.journal-gallery .journal-photo')).toHaveCount(1); // the other one
});

test('a moment whose photo could not be stored is not duplicated when saved again', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const id = await createTrip('custom');
    await addCity(id, 'Bologna', 'EUR');
    const fail = () => {
      throw new Error('Storage full');
    };
    (window as any).failPhotos = fail;
    db.photos.hook('creating', fail);
    return id;
  });
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: 'What happened?' }).click();
  const sheet = page.locator('dialog.modal[open]');
  await sheet.getByLabel('Place or event').fill('Courtyard choir');
  await sheet.locator('input[type="file"]:not([capture])').setInputFiles({
    name: 'IMG.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic'),
  });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Not saved');
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    db.photos.hook('creating').unsubscribe((window as any).failPhotos);
  });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const counts = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    return { moments: await db.moments.count(), photos: await db.photos.count() };
  });
  expect(counts).toEqual({ moments: 1, photos: 1 });
});

/**
 * The whole of the iPhone report, on one two-city trip: what a moment's link
 * to a stop means, where it sits in the list, what time it shows while being
 * read and while being edited, where it goes on the map — and that none of it
 * changes when the leg it happened in is deleted.
 *
 * The device is in London; Rome is an hour ahead and Dubai four. The date is
 * after the UK's October change, so no clock moves during the test.
 */
async function romeAndDubai(page: Page): Promise<{ trip: string; rome: string }> {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await page.goto('/');
  return page.evaluate(async () => {
    const [{ createTrip, addCity }, { addStop }] = await Promise.all(
      ['/src/lib/trips.ts', '/src/lib/stops.ts'].map((p) => import(/* @vite-ignore */ p)),
    );
    const trip = await createTrip('custom');
    const rome = await addCity(trip, 'Rome', 'EUR', {
      arrival: '2026-10-29T09:00',
      departure: '2026-10-29T19:00',
      tz: 'Europe/Rome',
    });
    const dubai = await addCity(trip, 'Dubai', 'AED', {
      arrival: '2026-10-30T05:00',
      departure: '2026-10-31T05:00',
      tz: 'Asia/Dubai',
      sleep: 'hotel',
    });
    await addStop(trip, 'Rome Stop', rome);
    await addStop(trip, 'Dubai Stop', dubai);
    return { trip, rome };
  });
}

const rowText = (page: Page) =>
  page
    .locator('.stop-city-head, .stop-row')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('stop-city-head')
          ? `# ${el.textContent?.trim()}`
          : `${el.querySelector('.stop-name')?.textContent?.trim()} [${el
              .querySelector('.stop-meta')
              ?.textContent?.trim()}]`,
      ),
    );

test('a moment keeps its stop, its place and its own time when the leg goes', async ({
  makeContext,
}) => {
  const context = await makeContext({ timezoneId: 'Europe/London' });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  const { trip, rome } = await romeAndDubai(page);
  await page.goto(`/#/trip/${trip}/stops`);

  // 1. A moment that is part of a planned stop, at 15:30 Rome time.
  await page.getByRole('button', { name: 'What happened?' }).click();
  const sheet = page.locator('dialog.modal[open]');
  await sheet.getByRole('button', { name: 'Rome' }).click();
  await sheet.getByLabel('Place or event').fill('The guide stopped mid-sentence');
  await sheet.getByRole('button', { name: 'change' }).click();
  await sheet.getByLabel('When').fill('2026-10-29T15:30');
  await sheet.getByLabel('Part of a planned stop?').selectOption({ label: 'Rome Stop' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  // It reads as part of that stop, and sits with it — not after Dubai's stops.
  expect(await rowText(page)).toEqual([
    '# Rome',
    'Rome Stop []',
    'The guide stopped mid-sentence [at Rome Stop · 15:30]',
    '# Dubai',
    'Dubai Stop []',
  ]);

  // 2. Opening it shows the same time the list does, and editing keeps it.
  await page.getByText('The guide stopped mid-sentence').click();
  await expect(sheet.getByText('At · 15:30')).toBeVisible();
  await sheet.getByRole('button', { name: 'change' }).click();
  await expect(sheet.getByLabel('When')).toHaveValue('2026-10-29T15:30');
  await sheet.getByLabel('When').fill('2026-10-29T15:45');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.moment-row .stop-meta')).toContainText('15:45');
  await page.getByText('The guide stopped mid-sentence').click();
  await expect(sheet.getByText('At · 15:45')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  // 3. A moment of its own goes on the map; one at a stop shows at its pin.
  await page.getByRole('button', { name: 'What happened?' }).click();
  await sheet.getByRole('button', { name: 'Rome' }).click();
  await sheet.getByLabel('Place or event').fill('Rain, and a doorway');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('tab', { name: 'Map' }).click();
  const unplaced = page.locator('.map-unplaced-row');
  await expect(unplaced).toHaveCount(2); // Rome Stop and the loose moment
  await expect(unplaced).toContainText(['Rome Stop', 'Rain, and a doorway']);
  await unplaced
    .filter({ hasText: 'Rain, and a doorway' })
    .getByRole('button', { name: 'Place on map' })
    .click();
  await page.locator('.map-canvas').click({ position: { x: 120, y: 120 } });
  await expect(page.locator('.map-pin--moment')).toHaveCount(1);
  await expect(unplaced).toHaveCount(1);

  // 4. A pin can be taken off the map again.
  await page.locator('.map-pin--moment').click();
  await page.getByRole('button', { name: 'Remove from map' }).click();
  await expect(page.locator('.map-pin--moment')).toHaveCount(0);
  await expect(unplaced).toHaveCount(2);
  const stored = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const m = (await db.moments.toArray()).find((r: { title: string }) =>
      r.title.startsWith('Rain'),
    );
    return { hasLat: 'lat' in m, lat: m.lat };
  });
  expect(stored).toEqual({ hasLat: false, lat: undefined });

  // 5. The leg goes. Its records stay, and stop being shown as Dubai's.
  await page.evaluate(async (id) => {
    const { deleteCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    await deleteCity(id);
  }, rome);
  await page.getByRole('tab', { name: 'List' }).click();
  // Groups follow the list's own order, so Rome's records keep their place —
  // under a header of their own, never read as Dubai's.
  expect(await rowText(page)).toEqual([
    '# Unassigned',
    'Rome Stop []',
    'The guide stopped mid-sentence [at Rome Stop · 15:45]',
    'Rain, and a doorway [off-plan · 13:00]',
    '# Dubai',
    'Dubai Stop []',
  ]);

  // 6. And the time it is read and edited in is still Rome's.
  await page.getByText('The guide stopped mid-sentence').click();
  await expect(sheet.getByText('At · 15:45')).toBeVisible();
  await sheet.getByRole('button', { name: 'change' }).click();
  await sheet.getByLabel('When').fill('2026-10-29T16:05');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.moment-row').first().locator('.stop-meta')).toContainText('16:05');
  await page.getByText('The guide stopped mid-sentence').click();
  await expect(sheet.getByText('At · 16:05')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  // 7. A detached record can be put back on a leg.
  await page.getByRole('button', { name: 'Rome Stop', exact: true }).click();
  await page.getByLabel('Leg').selectOption({ label: 'Dubai' });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.stop-city-head')).toHaveCount(2);
});

test('a moment on the map survives a backup round trip', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ db }, { createTrip, addCity }, { addMoment, placeMoment }, exp] = await Promise.all(
      ['/src/lib/db.ts', '/src/lib/trips.ts', '/src/lib/moments.ts', '/src/lib/export.ts'].map(
        (p) => import(/* @vite-ignore */ p),
      ),
    );
    const trip = await createTrip('custom');
    const city = await addCity(trip, 'Rome', 'EUR', { tz: 'Europe/Rome' });
    const id = await addMoment({ tripId: trip, cityId: city, title: 'Rain, and a doorway' });
    await placeMoment(id, { lat: 41.9009, lng: 12.4833 });
    const saved = new Blob([await (await exp.buildZipBackup()).arrayBuffer()]);
    const { backup, files } = await exp.readBackupFile(saved);
    await placeMoment(id, null);
    await db.moments.delete(id);
    await exp.importBackup(backup, files);
    const back = await db.moments.get(id);
    return { lat: back.lat, lng: back.lng, title: back.title };
  });
  expect(result).toEqual({ lat: 41.9009, lng: 12.4833, title: 'Rain, and a doorway' });
});
