import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { device, sync } from './nas-fake';

// Throwaway: two "devices" syncing through the REAL receiver on the NAS, in
// its own folder with its own token. Not part of the suite.
const URL_ = process.env.SYSTEMA_LIVE_NAS;
test.skip(!URL_, 'Needs SYSTEMA_LIVE_NAS.');
const nas = { url: URL_! };

function app<T, A = undefined>(page: Page, fn: (m: any, arg: A) => Promise<T> | T, arg?: A) {
  return page.evaluate(
    ([src, a]) => new Function('m', 'a', `return (${src})(m, a)`)((window as any).m, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;
}
const state = (page: Page) =>
  app(page, async (m) => ({
    trips: await m.db.trips.toArray(),
    stops: await m.db.stops.toArray(),
    conflicts: (await m.db.kv.where('key').startsWith('conflict:').toArray()).map((r: any) => r.value),
  }));

test('live NAS: two devices, concurrent pushes, deletion and a clear', async ({ makeContext }) => {
  const phone = await device(makeContext, nas);
  const urls: string[] = [];
  phone.on('request', (r) => urls.push(r.url()));
  const mac = await device(makeContext, nas);

  const { trip, stop } = await app(phone, async (m) => {
    const trip = await m.createTrip('custom');
    await m.updateTrip(trip, { planText: 'Original plan' });
    const stop = await m.addStop(trip, 'Belvedere');
    await m.updateStop(stop, { notes: 'Phone notes' });
    const gone = await m.addStop(trip, 'To be deleted');
    return { trip, stop, gone };
  });
  expect(await sync(phone)).toMatchObject({ ok: true });
  expect((await sync(mac)).ok).toBe(true);
  expect((await state(mac)).stops.map((s: any) => s.name).sort()).toEqual([
    'Belvedere',
    'To be deleted',
  ]);

  // 1. Edits to the same record on both devices, pushed at the same moment.
  await app(phone, (m, id) => m.updateTrip(id, { planText: 'Phone plan' }), trip);
  await app(mac, (m, id) => m.updateTrip(id, { nameManual: 'Mac name' }), trip);
  await Promise.all([sync(phone), sync(mac)]);
  for (let i = 0; i < 2; i += 1) {
    await sync(phone);
    await sync(mac);
  }
  for (const page of [phone, mac]) {
    const s = await state(page);
    expect(s.trips[0]).toMatchObject({ planText: 'Phone plan', nameManual: 'Mac name' });
    expect(s.conflicts).toEqual([]);
  }

  // 2. A deletion on one device reaches the other.
  const doomed = (await state(mac)).stops.find((s: any) => s.name === 'To be deleted');
  await app(mac, (m, id) => m.deleteStop(id), doomed.id);
  await sync(mac);
  await sync(phone);
  expect((await state(phone)).stops.map((s: any) => s.name)).toEqual(['Belvedere']);

  // 3. Clearing a field is not refilled by the other device's older copy.
  await app(phone, (m, id) => m.updateStop(id, { notes: '' }), stop);
  await sync(phone);
  await sync(mac);
  expect((await state(mac)).stops[0].notes).toBe('');

  // 4. The token never travelled in a URL.
  expect(urls.some((u) => u.includes('systema-backup.php'))).toBe(true);
  expect(urls.filter((u) => u.includes('token='))).toEqual([]);
});
