import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Backup files: build on one device, check and restore on another, through
// the Settings UI. Synthetic data only.

async function load(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = [
      '/src/lib/db.ts',
      '/src/lib/trips.ts',
      '/src/lib/photos.ts',
      '/src/lib/export.ts',
    ];
    const mods = await Promise.all(paths.map((p) => import(/* @vite-ignore */ p)));
    (window as any).m = Object.assign({}, ...mods);
  });
}

/** A device with one trip and `photos` photos; returns its ZIP backup bytes. */
async function deviceWithBackup(page: Page, photos: number): Promise<Buffer> {
  await load(page);
  const bytes = await page.evaluate(async (n) => {
    const m = (window as any).m;
    const trip = await m.createTrip('custom');
    await m.updateTrip(trip, { planText: 'Plan to keep' });
    for (let i = 0; i < n; i += 1)
      await m.addPhoto(new Blob([`photo ${i}`], { type: 'image/jpeg' }), {
        tripId: trip,
        kind: 'cover',
      });
    const zip: Blob = await m.buildZipBackup();
    return Array.from(new Uint8Array(await zip.arrayBuffer()));
  }, photos);
  return Buffer.from(bytes);
}

async function chooseBackup(page: Page, buffer: Buffer, name = 'systema-backup.zip') {
  await page.evaluate(() => (location.hash = '/settings'));
  await page
    .locator('input[type="file"][accept*=".zip"]')
    .setInputFiles({ name, mimeType: 'application/zip', buffer });
}

async function freshDevice(makeContext: () => Promise<BrowserContext>): Promise<Page> {
  const context = await makeContext();
  const page = context.pages()[0] ?? (await context.newPage());
  await load(page);
  return page;
}

const counts = (page: Page) =>
  page.evaluate(async () => {
    const { db } = (window as any).m;
    return {
      trips: await db.trips.count(),
      photos: await db.photos.count(),
      plan: (await db.trips.toCollection().first())?.planText,
    };
  });

test('a ZIP backup restores on a fresh device, checked first and written only on confirm', async ({
  page,
  makeContext,
}) => {
  const zip = await deviceWithBackup(page, 3);
  const fresh = await freshDevice(makeContext);
  await chooseBackup(fresh, zip);
  await expect(fresh.getByRole('status')).toContainText(
    'Backup checked: intact. This backup would add 1 trip(s), 0 stop(s), 0 expense(s), 3 photo(s).',
  );
  expect(await counts(fresh)).toEqual({ trips: 0, photos: 0, plan: undefined }); // dry run
  await fresh.getByRole('button', { name: 'Restore these records' }).click();
  await expect(fresh.getByRole('status')).toContainText('Added 1 trip(s)');
  expect(await counts(fresh)).toEqual({ trips: 1, photos: 3, plan: 'Plan to keep' });
  const texts = await fresh.evaluate(async () =>
    (
      await Promise.all(
        (await (window as any).m.db.photos.toArray()).map((p: any) => p.blob.text()),
      )
    ).sort(),
  );
  expect(texts).toEqual(['photo 0', 'photo 1', 'photo 2']);
});

test('a damaged or truncated backup is refused and nothing is written', async ({
  page,
  makeContext,
}) => {
  const zip = await deviceWithBackup(page, 2);
  const fresh = await freshDevice(makeContext);

  const damaged = Buffer.from(zip);
  damaged[zip.indexOf('photo 1')] ^= 0xff;
  await chooseBackup(fresh, damaged);
  await expect(fresh.getByRole('status')).toContainText('failed its checksum');
  await expect(fresh.getByRole('button', { name: 'Restore these records' })).toBeHidden();

  await chooseBackup(fresh, zip.subarray(0, zip.length - 40));
  await expect(fresh.getByRole('status')).toContainText('damaged or incomplete');
  expect(await counts(fresh)).toEqual({ trips: 0, photos: 0, plan: undefined });
});

test('a legacy JSON backup with embedded photos still restores', async ({ page }) => {
  await load(page);
  const legacy = {
    app: 'systema',
    version: 1,
    exportedAt: '2026-07-01T10:00:00.000Z',
    trips: [
      {
        id: 'legacy-trip',
        name: 'Vienna (Oct 2024)',
        type: 'custom',
        startDate: '2024-10-03',
        endDate: '2024-10-06',
        partySize: 2,
        returnFlightAt: '',
        accommodation: true,
        status: 'done',
        planText: 'Legacy plan',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    cities: [],
    stops: [],
    expenses: [],
    fxRates: [],
    settings: [],
    photos: [
      {
        meta: {
          id: 'legacy-photo',
          tripId: 'legacy-trip',
          stopId: null,
          expenseId: null,
          kind: 'cover',
          createdAt: 1,
        },
        dataUrl: `data:image/jpeg;base64,${Buffer.from('legacy image').toString('base64')}`,
      },
    ],
  };
  await chooseBackup(page, Buffer.from(JSON.stringify(legacy)), 'old-backup.json');
  await page.getByRole('button', { name: 'Restore these records' }).click();
  await expect(page.getByRole('status')).toContainText('Added 1 trip(s)');
  expect(await counts(page)).toEqual({ trips: 1, photos: 1, plan: 'Legacy plan' });
});

test('restoring a deleted photo from a backup un-deletes it', async ({ page }) => {
  await deviceWithBackup(page, 1);
  const result = await page.evaluate(async () => {
    const m = (window as any).m;
    // As a saved file would be: bytes, not a Blob still backed by the database.
    const file = new Blob([await (await m.buildZipBackup()).arrayBuffer()]);
    const read = await m.readBackupFile(file);
    const id = (await m.db.photos.toCollection().first()).id;
    await m.deletePhoto(id);
    const tombstoned = !!(await m.db.kv.get(`deleted-photo:${id}`));
    await m.importBackup(read.backup, read.files);
    return {
      tombstoned,
      back: !!(await m.db.photos.get(id)),
      tombstone: !!(await m.db.kv.get(`deleted-photo:${id}`)),
    };
  });
  expect(result).toEqual({ tombstoned: true, back: true, tombstone: false });
});

test('200 photos back up and restore intact', async ({ page, makeContext }) => {
  test.setTimeout(120_000);
  const zip = await deviceWithBackup(page, 200);
  const fresh = await freshDevice(makeContext);
  await chooseBackup(fresh, zip);
  await fresh.getByRole('button', { name: 'Restore these records' }).click();
  await expect(fresh.getByRole('status')).toContainText('200 photo(s)');
  const texts: string[] = await fresh.evaluate(async () =>
    Promise.all((await (window as any).m.db.photos.toArray()).map((p: any) => p.blob.text())),
  );
  expect(new Set(texts).size).toBe(200);
  expect(texts).toContain('photo 199');
});
