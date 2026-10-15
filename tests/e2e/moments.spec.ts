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
