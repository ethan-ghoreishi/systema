import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FakeNas, device, sync } from './nas-fake';

// Every field this version added must survive the real paths: a ZIP backup
// restored on a fresh device, and NAS sync between two devices — including
// deletions. Synthetic data only.

const MODS = [
  '/src/lib/db.ts',
  '/src/lib/trips.ts',
  '/src/lib/stops.ts',
  '/src/lib/moments.ts',
  '/src/lib/photos.ts',
  '/src/lib/expenses.ts',
  '/src/lib/export.ts',
  '/src/lib/opportunities.ts',
  '/src/lib/options.ts',
];

async function load(page: Page) {
  if (!page.url().startsWith('http')) await page.goto('/');
  await page.evaluate(async (paths) => {
    const mods = await Promise.all(paths.map((p) => import(/* @vite-ignore */ p)));
    (window as any).m = Object.assign((window as any).m ?? {}, ...mods);
  }, MODS);
}

/** A destination under consideration, with one option from a finder search. */
async function seedOpportunity(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const m = (window as any).m;
    const { rows } = m.parseFinderCsv(
      'City,Country,Out date,Back date,Trip,£/usable h,True £pp,Fare £pp,Status,Usable h,Ground,Cities,Overnight,Paid nights,Out,Out flights,Out £pp,Back,Back flights,Back £pp,Out link,Back link,Checked,Notes\n' +
        'Faro,Portugal,2027-02-12,2027-02-13,Fri→Sat · 1 night,4.99,96.0,34.5,OK,19.2,31h15,FAO 19h,Hotel ×1,1,LTN→FAO 09:25→12:15,Ryanair 5767,19.0,FAO→LTN 19:30→22:20,easyJet 2412,15.5,https://example.test/o,https://example.test/b,2027-01-20 00:46,',
    );
    await m.addFinderRows(
      rows.map((r: any) => ({
        ...r,
        option: { ...r.option, finderAssumptions: { travellers: 2, destTransferPP: 12 } },
      })),
    );
    const opp = await m.db.opportunities.toCollection().first();
    await m.updateOpportunity(opp.id, { research: 'Próximo bus 16 into town, ~20 min, €2.35.' });
    // One written by hand, as a Google Flights search arrives.
    await m.putOption(opp.id, {
      id: 'manual-1',
      source: 'manual',
      outDate: '2027-03-05',
      backDate: '2027-03-07',
      outRoute: ['STN', 'FAO'],
      backRoute: ['FAO', 'STN'],
      outFarePP: 24,
      backFarePP: 31,
      paidNights: 2,
      note: 'Cabin bag only',
    });
    return opp.id;
  });
}

/** One trip using every new field, plus a moment with a photo. */
async function seedRich(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const m = (window as any).m;
    const trip = await m.createTrip('two-city');
    await m.applyStopoverScenario(
      trip,
      1,
      { name: 'Bologna', currency: 'EUR' },
      { name: 'Barcelona', currency: 'EUR' },
    );
    const [blq, bcn] = await m.db.cities.where('tripId').equals(trip).sortBy('order');
    await m.updateCity(blq.id, {
      tz: 'Europe/Rome',
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T19:00',
      entry: { transport: 'Marconi Express', journeyMin: 20, transferRef: 'ME-7712' },
      exit: {
        ...blq.exit,
        hub: 'BLQ',
        journeyMin: 25,
        bufferMin: 75,
        notes: 'Marconi Express',
        transferRef: 'NX-5521',
      },
    });
    await m.updateCity(bcn.id, {
      tz: 'Europe/Madrid',
      base: {
        name: 'Hotel Gòtic',
        address: 'Carrer de Jaume I',
        checkIn: '2026-10-16T22:00',
        bookingRef: 'HG-8841',
      },
    });
    await m.updateTrip(trip, {
      outbound: { at: '2026-10-16T06:10', hub: 'LGW', ref: 'ABC123', checkedIn: true },
      homeward: { transport: 'National Express', journeyMin: 70, transferRef: 'NX-9001' },
      prep: { done: ['charge:devices'], extra: ['Water the plants'] },
    });
    const stop = await m.addStop(trip, 'Archiginnasio', blq.id);
    await m.updateStop(stop, {
      guide: { anchor: 'Anatomical Theatre', lookFor: ['arms', 'statues', 'canopy'] },
      bookAhead: 'Timed entry, book a week ahead',
      booked: true,
      bookingRef: 'AR-2210',
    });
    await m.toggleVisited(await m.db.stops.get(stop));
    await m.addExpense(trip, {
      cityId: null,
      shared: true,
      destination: 'Bologna/Barcelona',
      date: '2026-10-16',
      category: 'Transportation',
      subcategory: 'Flight',
      description: 'Flights',
      paymentMethod: 'Online Payment',
      amountGBP: 90,
      amountLocal: 0,
      currency: 'GBP',
      fxRate: null,
      need: 'flight:outbound',
      notes: '',
    });
    await m.addExpense(trip, {
      cityId: blq.id,
      destination: 'Bologna',
      date: '2026-10-16',
      category: 'Experiences',
      subcategory: 'Museum',
      description: 'Archiginnasio',
      paymentMethod: 'Cash Payment',
      amountGBP: 4,
      amountLocal: 3,
      currency: 'EUR',
      fxRate: null,
      gbpManual: true,
      fxDate: '2026-10-16',
      notes: '',
    });
    const moment = await m.addMoment({
      tripId: trip,
      cityId: blq.id,
      title: 'Portico concert',
      note: 'Strangers singing',
      at: 1_792_150_000_000,
      stopId: stop,
    });
    await m.addPhotos([new Blob(['moment photo'], { type: 'image/jpeg' })], {
      tripId: trip,
      kind: 'stop',
      stopId: stop,
      momentId: moment,
      tz: 'Europe/Rome',
    });
    return trip;
  });
}

/** Every record, without device bookkeeping (timestamps, upload flags, blobs). */
const snapshot = (page: Page) =>
  page.evaluate(async () => {
    const { db } = (window as any).m;
    const clean = (rows: any[]) =>
      rows
        .map(({ updatedAt: _u, backedUp: _b, blob: _x, ...r }: any) => r)
        .sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
    const photos = await db.photos.toArray();
    return {
      trips: clean(await db.trips.toArray()),
      cities: clean(await db.cities.toArray()),
      stops: clean(await db.stops.toArray()),
      expenses: clean((await db.expenses.toArray()).filter((e: any) => !e.skeleton)),
      moments: clean(await db.moments.toArray()),
      opportunities: clean(await db.opportunities.toArray()),
      photos: clean(photos),
      photoBytes: await Promise.all(photos.map((p: any) => p.blob.text())),
    };
  });

async function freshDevice(makeContext: () => Promise<BrowserContext>): Promise<Page> {
  const context = await makeContext();
  const page = context.pages()[0] ?? (await context.newPage());
  await load(page);
  return page;
}

test('every new field survives a ZIP backup restored on a fresh device', async ({
  page,
  makeContext,
}) => {
  await load(page);
  await seedRich(page);
  await seedOpportunity(page);
  const original = await snapshot(page);
  expect(original.moments).toHaveLength(1);
  expect(original.opportunities[0].options[0]).toMatchObject({ finderPP: 96, usableH: 19.2 });
  expect(original.photos[0]).toMatchObject({ momentId: original.moments[0].id, kind: 'stop' });

  const zip = Buffer.from(
    await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await (window as any).m.buildZipBackup()).arrayBuffer())),
    ),
  );
  const fresh = await freshDevice(makeContext);
  await fresh.evaluate(() => (location.hash = '/settings'));
  await fresh
    .locator('input[type="file"][accept*=".zip"]')
    .setInputFiles({ name: 'systema-backup.zip', mimeType: 'application/zip', buffer: zip });
  await expect(fresh.getByRole('status')).toContainText('1 moment(s)');
  await fresh.getByRole('button', { name: 'Restore these records' }).click();
  await expect(fresh.getByRole('status')).toContainText('Added 1 trip(s)');
  expect(await snapshot(fresh)).toEqual(original);
});

test('every new field syncs between devices; deleting a moment or a trip reaches the other', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  await load(phone);
  const trip = await seedRich(phone);
  const opp = await seedOpportunity(phone);
  expect((await sync(phone)).ok).toBe(true);

  const mac = await device(makeContext, nas);
  await load(mac);
  expect((await sync(mac)).ok).toBe(true);
  expect(await snapshot(mac)).toEqual(await snapshot(phone));

  // The Mac deletes the moment: its photo goes too, on both devices.
  await mac.evaluate(async () => {
    const { db, deleteMoment } = (window as any).m;
    await deleteMoment((await db.moments.toCollection().first()).id);
  });
  await sync(mac);
  await sync(phone);
  const afterMoment = await snapshot(phone);
  expect(afterMoment.moments).toEqual([]);
  expect(afterMoment.photos).toEqual([]);

  // Deleting the trip removes its moments, legs and stops everywhere.
  await phone.evaluate(async () => {
    const { addMoment, db } = (window as any).m;
    const t = (await db.trips.toCollection().first()).id;
    await addMoment({ tripId: t, cityId: null, title: 'Late one', at: 1 });
  });
  await sync(phone);
  await sync(mac);
  expect((await snapshot(mac)).moments).toHaveLength(1);
  await phone.evaluate((id) => (window as any).m.deleteTrip(id), trip);
  expect((await snapshot(phone)).moments).toEqual([]);
  await sync(phone);
  await sync(mac);
  const gone = await snapshot(mac);
  expect([gone.trips, gone.cities, gone.stops, gone.moments]).toEqual([[], [], [], []]);
  // A destination under consideration belongs to no trip, so deleting the trip
  // leaves it — and what was learned about the place — exactly where it was.
  expect(gone.opportunities).toHaveLength(1);
  expect(gone.opportunities[0].research).toContain('Próximo bus');

  // Deleting the idea itself reaches the other device like any other deletion.
  await mac.evaluate((id) => (window as any).m.deleteOpportunity(id), opp);
  await sync(mac);
  await sync(phone);
  expect((await snapshot(phone)).opportunities).toEqual([]);
});
