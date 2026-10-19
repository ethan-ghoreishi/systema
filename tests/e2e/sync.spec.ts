import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FakeNas, device, sync } from './nas-fake';

// Two "devices" (separate browser contexts, separate IndexedDB) syncing
// through one fake NAS. Synthetic data only.

/** Evaluate against the app modules exposed by `device()` as window.m. */
function app<T, A = undefined>(page: Page, fn: (m: any, arg: A) => Promise<T> | T, arg?: A) {
  return page.evaluate(
    ([src, a]) => new Function('m', 'a', `return (${src})(m, a)`)((window as any).m, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;
}

async function seedTrip(page: Page): Promise<{ trip: string; stop: string }> {
  return app(page, async (m) => {
    const trip = await m.createTrip('custom');
    await m.updateTrip(trip, { planText: 'Original plan' });
    const stop = await m.addStop(trip, 'Belvedere');
    return { trip, stop };
  });
}

const state = (page: Page) =>
  app(page, async (m) => ({
    trips: await m.db.trips.toArray(),
    stops: await m.db.stops.toArray(),
    photos: (await m.db.photos.toArray()).map((p: any) => p.id).sort(),
    conflicts: (await m.db.kv.where('key').startsWith('conflict:').toArray()).map(
      (r: any) => r.value,
    ),
  }));

test('a fresh install restores everything, photos included', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip, stop } = await seedTrip(phone);
  await app(phone, (m, a: any) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), a), {
    tripId: trip,
    stopId: stop,
    kind: 'stop',
  });
  const first = await sync(phone);
  expect(first.message).toMatch(/^Synced/);

  const fresh = await device(makeContext, nas);
  const outcome = await sync(fresh);
  expect(outcome.message).toContain('photo downloaded');
  const s = await state(fresh);
  expect(s.trips.map((t: any) => t.planText)).toEqual(['Original plan']);
  expect(s.stops.map((x: any) => x.name)).toEqual(['Belvedere']);
  expect(s.photos).toHaveLength(1);
  expect(s.conflicts).toEqual([]);
  // The fresh device had nothing new: it must not push a snapshot of its own.
  expect(nas.dataPosts).toBe(1);
});

test('an empty device never replaces a good NAS copy', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  await seedTrip(phone);
  await sync(phone);
  const empty = await device(makeContext, nas);
  await sync(empty);
  await sync(empty);
  expect(nas.latest().trips).toHaveLength(1);
});

test('edits to different fields on two devices combine without conflict', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { stop } = await seedTrip(phone);
  await sync(phone);
  await sync(mac);

  await app(phone, (m, id) => m.updateStop(id, { visited: true }), stop);
  await app(mac, (m, id) => m.updateStop(id, { notes: 'Notes written on the Mac' }), stop);
  await sync(mac);
  await sync(phone);
  await sync(mac);

  for (const page of [phone, mac]) {
    const s = await state(page);
    expect(s.stops[0]).toMatchObject({ visited: true, notes: 'Notes written on the Mac' });
    expect(s.conflicts).toEqual([]);
  }
});

test('the same field edited on two devices keeps the newer and records the other', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await sync(phone);
  await sync(mac);

  await app(mac, (m, id) => m.updateTrip(id, { planText: 'Mac plan' }), trip);
  await app(phone, (m, id) => m.updateTrip(id, { planText: 'Phone plan' }), trip); // newer
  await sync(mac);
  expect((await sync(phone)).message).toContain('1 edit made on two devices');
  await sync(mac);

  for (const page of [phone, mac]) {
    const s = await state(page);
    expect(s.trips[0].planText).toBe('Phone plan');
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0].fields.planText).toEqual({ kept: 'Phone plan', other: 'Mac plan' });
  }
});

test('a record deleted on one device but edited on the other comes back', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { stop } = await seedTrip(phone);
  await sync(phone);
  await sync(mac);

  await app(mac, (m, id) => m.deleteStop(id), stop);
  await app(phone, (m, id) => m.updateStop(id, { notes: 'Kept by the edit' }), stop);
  await sync(mac);
  await sync(phone);
  await sync(mac);
  for (const page of [phone, mac])
    expect((await state(page)).stops.map((s: any) => s.notes)).toEqual(['Kept by the edit']);
});

test('a deletion reaches the other device when it made no edit there', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { stop } = await seedTrip(phone);
  await sync(phone);
  await sync(mac);
  await app(mac, (m, id) => m.deleteStop(id), stop);
  await sync(mac);
  await sync(phone);
  expect((await state(phone)).stops).toEqual([]);
});

test('two devices pushing in the same second lose nothing', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  await seedTrip(phone);
  await sync(phone);
  await sync(mac);

  const tripId = (await state(phone)).trips[0].id;
  await app(phone, (m, id) => m.addStop(id, 'Added on phone'), tripId);
  await app(mac, (m, id) => m.addStop(id, 'Added on Mac'), tripId);
  nas.advance = false; // both snapshots land in the same second: the second overwrites
  await Promise.all([sync(phone), sync(mac)]);
  nas.advance = true;
  for (let i = 0; i < 2; i += 1) {
    await sync(phone);
    await sync(mac);
  }
  for (const page of [phone, mac]) {
    const names = (await state(page)).stops.map((s: any) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Belvedere', 'Added on phone', 'Added on Mac']));
  }
});

test('idle syncs write nothing and push nothing', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  await seedTrip(phone);
  await sync(phone);
  await sync(mac);
  await sync(phone);
  const posts = nas.dataPosts + nas.photoPosts;
  const writes = await app(phone, (m) => {
    (window as any).writes = 0;
    for (const t of [m.db.trips, m.db.cities, m.db.stops, m.db.expenses, m.db.photos])
      for (const e of ['creating', 'updating', 'deleting'])
        t.hook(e, () => {
          (window as any).writes += 1;
        });
    return 0;
  });
  for (let i = 0; i < 10; i += 1) {
    expect((await sync(phone)).message).toBe('Up to date.');
    expect((await sync(mac)).message).toBe('Up to date.');
  }
  expect(nas.dataPosts + nas.photoPosts).toBe(posts);
  expect(writes + (await phone.evaluate(() => (window as any).writes))).toBe(0);
});

test('a malformed or unreadable NAS copy changes and pushes nothing', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  await seedTrip(phone);
  for (const bad of [
    { status: 200, body: '{"app":"systema","version":1,"trips":"oops"}' },
    { status: 200, body: '{"truncated": ' },
    { status: 500, body: '{}' },
  ]) {
    nas.latestOverride = bad;
    const outcome = await sync(phone);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Nothing on the NAS was replaced');
  }
  expect(nas.dataPosts).toBe(0);
  expect((await state(phone)).trips).toHaveLength(1);
});

test('a photo upload failing midway still backs up the data, reports it, then resumes', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(
    phone,
    async (m, id) => {
      for (let i = 0; i < 5; i += 1)
        await m.addPhoto(new Blob([`pic ${i}`], { type: 'image/png' }), {
          tripId: id,
          kind: 'cover',
        });
    },
    trip,
  );
  nas.failPhotoPostsAfter = 2;
  const partial = await sync(phone);
  // The data doesn't wait on the photos: the snapshot goes, the gap is named.
  expect(partial).toMatchObject({ ok: true, partial: true });
  expect(partial.message).toContain('3 photos from this device not on the NAS yet');
  expect(nas.dataPosts).toBe(1);
  const failures = await app(phone, (m) => m.nasBackup.failures);
  expect(Object.keys(failures)).toHaveLength(3);
  expect(Object.values(failures)[0]).toMatchObject({ kind: 'server', attempts: 1 });

  // They wait out their backoff on ordinary syncs…
  nas.failPhotoPostsAfter = Infinity;
  await sync(phone);
  expect(nas.photos.size).toBe(2);
  // …and "Retry failed only" sends them now.
  const retry = await app(phone, (m) => m.nasBackup.retryFailed());
  expect(retry.message).toBe('3 photos uploaded. Every photo on this device is on the NAS.');
  expect(nas.photos.size).toBe(5);
  expect((await sync(phone)).partial).toBeUndefined();
  expect(nas.latest().photosMeta).toHaveLength(5);
});

test('150 photos sync to a second device', async ({ makeContext }) => {
  test.setTimeout(120_000);
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(
    phone,
    async (m, id) => {
      for (let i = 0; i < 150; i += 1)
        await m.addPhoto(new Blob([`photo ${i}`], { type: 'image/png' }), {
          tripId: id,
          kind: 'cover',
        });
    },
    trip,
  );
  expect((await sync(phone)).ok).toBe(true);
  const mac = await device(makeContext, nas);
  expect((await sync(mac)).message).toContain('150 photos downloaded');
  expect((await state(mac)).photos).toHaveLength(150);
  const bytes = await app(mac, async (m) =>
    (await Promise.all((await m.db.photos.toArray()).map((p: any) => p.blob.text()))).sort(),
  );
  expect(bytes).toContain('photo 149');
});

test('a deleted photo stays deleted on the other device', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  const photo = await app(
    phone,
    (m, id) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), { tripId: id, kind: 'cover' }),
    trip,
  );
  await sync(phone);
  await sync(mac);
  expect((await state(mac)).photos).toEqual([photo]);
  await app(mac, (m, id) => m.deletePhoto(id), photo);
  await sync(mac);
  await sync(phone);
  await sync(mac);
  for (const page of [phone, mac]) expect((await state(page)).photos).toEqual([]);
});

test('a failure while applying a merge leaves the device and the NAS untouched', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(phone, (m, id) => m.addStop(id, 'Second stop'), trip);
  await sync(phone);
  const posts = nas.dataPosts;
  await app(mac, (m) => {
    m.db.stops.hook('creating', (_k: unknown, obj: any) => {
      if (obj.name === 'Second stop') throw new Error('Synthetic storage failure');
    });
  });
  expect((await sync(mac)).ok).toBe(false);
  const s = await state(mac);
  expect(s.trips).toEqual([]); // all or nothing
  expect(s.stops).toEqual([]);
  expect(nas.dataPosts).toBe(posts);
});

test('first sync after updating adopts its own last push as the base (no false conflicts)', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  // Simulate the old add-only version: a lineage-less snapshot it pushed itself.
  const legacy = await app(phone, async (m) => {
    const snap = await m.buildDataBackup();
    await m.db.kv.put({ key: 'nasLastDataAt', value: Date.parse(snap.exportedAt) + 2000 });
    return snap;
  });
  nas.files.set('systema-data-20261001-080000.json', JSON.stringify(legacy));
  await app(phone, (m, id) => m.updateTrip(id, { planText: 'Edited after the old push' }), trip);
  expect((await sync(phone)).message).not.toContain('two devices');
  expect(nas.latest().trips[0].planText).toBe('Edited after the old push');
  expect((await state(phone)).conflicts).toEqual([]);
});

test('first sync against an unrelated old snapshot unions and records real differences', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  const legacy = await app(phone, (m) => m.buildDataBackup());
  legacy.trips[0].planText = 'Older plan from another device';
  legacy.trips[0].updatedAt = 1;
  nas.files.set('systema-data-20261001-080000.json', JSON.stringify(legacy));
  await app(phone, (m, id) => m.addStop(id, 'Only on this device'), trip);
  await sync(phone);
  const s = await state(phone);
  expect(s.trips[0].planText).toBe('Original plan'); // newer kept
  expect(s.conflicts[0].fields.planText.other).toBe('Older plan from another device');
  expect(s.stops).toHaveLength(2);
});

test('a conflict is reviewed in Settings and the chosen version syncs back', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await sync(phone);
  await sync(mac);
  await app(mac, (m, id) => m.updateTrip(id, { planText: 'Mac plan' }), trip);
  await app(phone, (m, id) => m.updateTrip(id, { planText: 'Phone plan' }), trip);
  await sync(mac);
  await sync(phone);
  await sync(mac);

  await expect(mac.getByText('1 edit made on two devices — review')).toBeVisible();
  await mac.getByText('1 edit made on two devices — review').click();
  await mac
    .getByText(/version$/, { exact: false })
    .first()
    .click(); // expand the other version
  await expect(mac.getByText('Mac plan', { exact: true })).toBeVisible();
  await mac.getByRole('button', { name: /^Use .* version$/ }).click();
  await expect(mac.getByText('Edits made on two devices')).toBeHidden();

  await sync(mac);
  await sync(phone);
  for (const page of [phone, mac]) {
    const s = await state(page);
    expect(s.trips[0].planText).toBe('Mac plan');
    expect(s.conflicts).toEqual([]);
  }
});

test('checking the NAS copy reports accurately and changes nothing', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(
    phone,
    (m, id) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), { tripId: id, kind: 'cover' }),
    trip,
  );
  await sync(phone);
  const check = () => phone.evaluate(() => (window as any).m.nasBackup.check());
  expect((await check()).message).toContain(
    '1 trip, 0 expenses, 1 photo. Every photo it lists is on the NAS. This device and the NAS match.',
  );

  await app(phone, (m, id) => m.updateTrip(id, { planText: 'Not synced yet' }), trip);
  nas.photos.clear(); // the NAS lost its photo file
  const before = { posts: nas.dataPosts, files: nas.files.size };
  const r = await check();
  expect(r.ok).toBe(false);
  expect(r.message).toContain('1 photo listed but not on the NAS yet');
  expect(r.message).toContain('1 photo of those is on this device and will upload again');
  expect(r.message).toContain('A sync would bring 0 changes here and send 1 change.');
  expect({ posts: nas.dataPosts, files: nas.files.size }).toEqual(before);
  expect((await state(phone)).trips[0].planText).toBe('Not synced yet');
});

test('a deleted trip comes back, photos included, from an older NAS snapshot file', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(
    phone,
    (m, id) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), { tripId: id, kind: 'cover' }),
    trip,
  );
  await sync(phone);
  const older = nas.files.get([...nas.files.keys()].sort().at(-1)!)!; // as picked from the share
  await app(phone, (m, id) => m.deleteTrip(id), trip);
  await sync(phone);
  expect(nas.latest().trips).toEqual([]);

  await phone.evaluate(() => (location.hash = '/settings'));
  await phone.locator('input[type="file"][accept*=".zip"]').setInputFiles({
    name: 'systema-data-older.json',
    mimeType: 'application/json',
    buffer: Buffer.from(older),
  });
  await phone.getByRole('button', { name: 'Restore these records' }).click();
  await expect(phone.getByRole('status')).toContainText('1 photo(s) fetched from the NAS');
  await sync(phone);
  const s = await state(phone);
  expect(s.trips.map((t: any) => t.id)).toEqual([trip]);
  expect(s.photos).toHaveLength(1); // the tombstone was cleared, so sync kept it
  expect(nas.latest().photosMeta).toHaveLength(1);
});

test('a photo file lost from the NAS causes no push ping-pong between devices', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const mac = await device(makeContext, nas);
  const { trip } = await seedTrip(phone);
  await app(
    phone,
    (m, id) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), { tripId: id, kind: 'cover' }),
    trip,
  );
  await sync(phone);
  nas.photos.clear(); // e.g. removed by hand on the NAS
  await sync(mac);
  await sync(phone);
  const posts = nas.dataPosts;
  for (let i = 0; i < 5; i += 1) {
    await sync(mac);
    await sync(phone);
  }
  expect(nas.dataPosts).toBe(posts);
  expect((await state(phone)).photos).toHaveLength(1); // still on the device that took it
});

// The number Settings shows next to "Changes not on the NAS yet". It was both
// wrong (it counted NAS photos this device can't hold) and stale (it was only
// recomputed by a sync started from this page, never by an automatic one).
test('Settings shows nothing left to send after a sync it did not start', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const mac = await device(makeContext, nas);
  const phone = await device(makeContext, nas);
  const { trip } = await seedTrip(mac);
  await app(
    mac,
    (m, id) => m.addPhoto(new Blob(['pic'], { type: 'image/png' }), { tripId: id, kind: 'cover' }),
    trip,
  );
  await sync(mac);
  nas.photos.clear(); // the photo file is gone, so the phone can never hold it

  await phone.evaluate(() => (location.hash = '/settings'));
  const unsynced = phone
    .locator('.status-row', { has: phone.getByText('Changes not on the NAS yet') })
    .locator('.status-val');
  await sync(phone); // as the automatic sync does: nothing on the page started it
  await expect(unsynced).toHaveText('0');
});
