import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { device, phpReceiver, sync } from './nas-fake';

// Sync against the real nas/systema-backup.php (CI runs `php -S`; see the
// workflow). Each test gets its own receiver folder. Synthetic data only.
test.skip(!process.env.SYSTEMA_PHP_URL, 'Needs a PHP server (SYSTEMA_PHP_URL/SYSTEMA_PHP_ROOT).');

const snapshots = (dir: string) =>
  readdirSync(join(dir, 'systema-backups', 'data'))
    .filter((f) => f.endsWith('.json'))
    .sort();

const run = <T, A>(page: Page, fn: (m: any, a: A) => Promise<T>, arg?: A) =>
  page.evaluate(
    ([src, a]) => new Function('m', 'a', `return (${src})(m, a)`)((window as any).m, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;

// The current receiver, and the original one most NAS installs still run:
// the app must be safe against both without a redeploy.
for (const [label, receiver] of [
  ['current receiver', 'nas/systema-backup.php'],
  ['original receiver', 'tests/e2e/systema-backup-v1.php'],
])
  test(`two devices sync through the ${label}, then idle syncs write nothing`, async ({
    makeContext,
  }) => {
    const rx = phpReceiver(receiver)!;
    const phone = await device(makeContext, rx);
    const { trip, stop } = await run(phone, async (m) => {
      const trip = await m.createTrip('custom');
      const stop = await m.addStop(trip, 'Belvedere');
      await m.addPhoto(new Blob(['real receiver photo'], { type: 'image/jpeg' }), {
        tripId: trip,
        stopId: stop,
        kind: 'stop',
      });
      return { trip, stop };
    });
    expect((await sync(phone)).ok).toBe(true);

    const mac = await device(makeContext, rx);
    expect((await sync(mac)).message).toContain('1 photo downloaded');
    expect(
      await run(mac, async (m) => (await m.db.photos.toCollection().first()).blob.text()),
    ).toBe('real receiver photo');

    await run(phone, (m, id) => m.updateStop(id, { visited: true }), stop);
    await run(mac, (m, id) => m.updateStop(id, { notes: 'From the Mac' }), stop);
    await run(mac, (m, id) => m.updateTrip(id, { planText: 'Mac plan' }), trip);
    await sync(mac);
    await sync(phone);
    await sync(mac);
    for (const page of [phone, mac])
      expect(await run(page, async (m) => (await m.db.stops.toArray())[0])).toMatchObject({
        visited: true,
        notes: 'From the Mac',
      });

    const before = snapshots(rx.dir);
    for (let i = 0; i < 3; i += 1) {
      expect((await sync(phone)).message).toBe('Up to date.');
      expect((await sync(mac)).message).toBe('Up to date.');
    }
    expect(snapshots(rx.dir)).toEqual(before);
  });

test('pushes from two devices at the same moment are both kept and converge', async ({
  makeContext,
}) => {
  const rx = phpReceiver()!;
  const phone = await device(makeContext, rx);
  const trip = await run(phone, (m) => m.createTrip('custom'));
  await sync(phone);
  const mac = await device(makeContext, rx);
  await sync(mac);
  await run(phone, (m, id) => m.addStop(id, 'From the phone'), trip);
  await run(mac, (m, id) => m.addStop(id, 'From the Mac'), trip);
  const before = snapshots(rx.dir).length;
  await Promise.all([sync(phone), sync(mac)]);
  expect(snapshots(rx.dir).length).toBe(before + 2); // no overwrite
  await sync(phone);
  await sync(mac);
  await sync(phone);
  for (const page of [phone, mac])
    expect((await run(page, (m) => m.db.stops.toArray())).map((s: any) => s.name).sort()).toEqual([
      'From the Mac',
      'From the phone',
    ]);
});

test('the receiver keeps the newest 60 snapshots plus one per day', async ({ makeContext }) => {
  const rx = phpReceiver()!;
  const phone = await device(makeContext, rx);
  const trip = await run(phone, (m) => m.createTrip('custom'));
  await sync(phone);
  // 50 earlier days with two snapshots each (older than anything real).
  const data = join(rx.dir, 'systema-backups', 'data');
  for (let d = 1; d <= 50; d += 1) {
    const day = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10).replace(/-/g, '');
    for (const t of ['090000', '180000'])
      writeFileSync(join(data, `systema-data-${day}-${t}.json`), '{}');
  }
  await run(phone, (m, id) => m.updateTrip(id, { planText: 'Triggers a push' }), trip);
  await sync(phone);

  const kept = snapshots(rx.dir);
  // Newest 60 (2 real + 29 days x 2) plus the newest of each of the other 21 days.
  expect(kept).toHaveLength(81);
  const days = new Set(
    kept.map((f) => f.slice('systema-data-'.length, 'systema-data-'.length + 8)),
  );
  expect(days.size).toBe(51); // every day still has a snapshot
});
