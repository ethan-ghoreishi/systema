import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FakeNas, device, sync } from './nas-fake';

// Backup integrity against a fake receiver that misbehaves on purpose.
// Synthetic data only.

function app<T, A = undefined>(page: Page, fn: (m: any, arg: A) => Promise<T> | T, arg?: A) {
  return page.evaluate(
    ([src, a]) => new Function('m', 'a', `return (${src})(m, a)`)((window as any).m, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;
}

async function tripWithPhotos(
  page: Page,
  sizes: number[],
): Promise<{ trip: string; ids: string[] }> {
  return app(
    page,
    async (m, sizes: number[]) => {
      const trip = await m.createTrip('custom');
      await m.updateTrip(trip, { planText: 'Plan to keep' });
      const ids: string[] = [];
      for (const [i, n] of sizes.entries())
        ids.push(
          await m.addPhoto(new Blob([new Uint8Array(n).fill(i + 1)], { type: 'image/png' }), {
            tripId: trip,
            kind: 'cover',
          }),
        );
      return { trip, ids };
    },
    sizes,
  );
}

test('one photo too large for the receiver: the rest and the data still back up', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  nas.version = 1; // the original receiver: PHP drops the body, it says "empty body"
  nas.maxBody = 50_000;
  const phone = await device(makeContext, nas);
  const { ids } = await tripWithPhotos(phone, [1_000, 80_000, 2_000]);
  const outcome = await sync(phone);
  expect(outcome).toMatchObject({ ok: true, partial: true });
  expect(nas.photos.size).toBe(2);
  expect(nas.dataPosts).toBe(1);
  expect(nas.latest().trips[0].planText).toBe('Plan to keep');
  const failures = await app(phone, (m) => m.nasBackup.failures);
  expect(Object.keys(failures)).toEqual([ids[1]]);
  expect(failures[ids[1]].kind).toBe('too-large');
  expect(failures[ids[1]].error).toMatch(/post_max_size/);

  await phone.evaluate(() => (location.hash = '/settings'));
  const card = phone.locator('#backup');
  await expect(card).toContainText('Partly backed up');
  await expect(card).toContainText('1 photo from this device not uploaded');
  await expect(card).toContainText('post_max_size');
  await expect(card.getByRole('button', { name: 'Retry failed only' })).toBeVisible();
  await expect(card).not.toContainText('synthetic'); // the token never shows
  await expect(card).not.toContainText('Normal away from the NAS');
});

test('an unreachable NAS fails honestly, then a reconnect uploads everything', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  await tripWithPhotos(phone, [10, 20, 30]);
  nas.unreachable = true;
  const down = await sync(phone);
  expect(down.ok).toBe(false);
  expect(down.message).toContain('Nothing on the NAS was replaced');
  expect(await app(phone, (m) => m.nasBackup.lastAttempt.kind)).toBe('unreachable');
  // Not every photo marked failed: the network was down, not the photos.
  expect(Object.keys(await app(phone, (m) => m.nasBackup.failures)).length).toBeLessThanOrEqual(2);

  nas.unreachable = false;
  await app(phone, (m) => m.nasBackup.retryFailed());
  const up = await sync(phone);
  expect(up.ok).toBe(true);
  expect(nas.photos.size).toBe(3);
  expect(await app(phone, (m) => m.nasBackup.failures)).toEqual({});
});

test('an upload cut off mid-way resumes from the photo that failed', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { ids } = await tripWithPhotos(phone, [10, 20, 30, 40]);
  nas.failPhotos.set(ids[2], 502); // the connection drops on this one
  const first = await sync(phone);
  expect(first.partial).toBe(true);
  expect(nas.photos.size).toBe(3);
  const before = nas.photoPosts;
  nas.failPhotos.clear();
  await app(phone, (m) => m.nasBackup.retryFailed());
  expect(nas.photoPosts - before).toBe(1); // only the one that failed is sent again
  expect(nas.photos.size).toBe(4);
});

test('a damaged copy already on the NAS is replaced and verified', async ({ makeContext }) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { ids } = await tripWithPhotos(phone, [500]);
  nas.photos.set(ids[0], Buffer.from('truncated')); // e.g. an earlier half-written file
  expect((await sync(phone)).ok).toBe(true);
  expect(nas.photos.get(ids[0])!.length).toBe(500);
  await app(phone, (m) => m.nasBackup.refreshCounts());
  expect(await app(phone, (m) => [m.nasBackup.photosBacked, m.nasBackup.photosTotal])).toEqual([
    1, 1,
  ]);
});

test('a check names photos missing from the NAS, and queues the ones this device has', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const { ids } = await tripWithPhotos(phone, [10, 20]);
  await sync(phone);
  const mac = await device(makeContext, nas);
  await sync(mac);
  nas.photos.delete(ids[1]);

  const onMac = await app(mac, (m) => m.nasBackup.check());
  expect(onMac.ok).toBe(false);
  expect(onMac.message).toContain('1 photo listed but not on the NAS yet');
  // The Mac downloaded it before it vanished, so the Mac re-uploads it.
  expect(onMac.message).toContain('will upload again on the next sync');
  await sync(mac);

  expect(nas.photos.has(ids[1])).toBe(true);

  // A third device that never had it: reported by id, never skipped silently.
  nas.photos.delete(ids[1]);
  await app(phone, (m, id) => m.db.photos.delete(id), ids[1]); // gone locally too
  const fresh = await device(makeContext, nas);
  const restored = await sync(fresh);
  expect(restored.message).toContain('1 photo not on the NAS yet');
  const missing = await app(fresh, (m) => m.nasBackup.missing.items.map((x: any) => x.id));
  expect(missing).toEqual([ids[1]]);
});

test('Test connection tells a wrong token, a size limit, CORS and no connection apart', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  await tripWithPhotos(phone, [200_000]);
  const test = () => app(phone, (m) => m.nasBackup.testConnection());

  expect((await test()).ok).toBe(true);

  await app(phone, (m) => (m.settingsStore.current.nasToken = 'wrong-token-value'));
  const bad = await test();
  expect(bad.checks.find((c: any) => c.label === 'Token')).toMatchObject({ ok: false });
  expect(JSON.stringify(bad)).not.toContain('wrong-token-value');
  await app(phone, (m) => (m.settingsStore.current.nasToken = 'synthetic'));

  nas.version = 1;
  nas.maxBody = 100_000;
  const size = (await test()).checks.find((c: any) => c.label.startsWith('An upload'));
  expect(size.ok).toBe(false);
  expect(size.detail).toMatch(/post_max_size/);

  nas.unreachable = true;
  const off = (await test()).checks.find((c: any) => c.label === 'Receiver');
  expect(off.ok).toBe(false);
  expect(off.detail).toMatch(/No connection|blocked the reply/);
});
