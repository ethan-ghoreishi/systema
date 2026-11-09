import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
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

// The current receiver, the previous one, and the original one: the app must
// be safe against whichever a NAS still runs, without a redeploy.
for (const [label, receiver] of [
  ['current receiver', 'nas/systema-backup.php'],
  ['previous receiver', 'tests/e2e/systema-backup-v1.1.php'],
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
    expect(await sync(phone)).toMatchObject({ ok: true });

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
  // Each also edits a different field of the one record they already share:
  // both snapshots then descend from the same ancestor and neither from the
  // other, which is where an edit used to be reverted without a word.
  await run(phone, (m, id) => m.updateTrip(id, { planText: 'Phone plan' }), trip);
  await run(mac, (m, id) => m.updateTrip(id, { nameManual: 'Mac name' }), trip);
  const before = snapshots(rx.dir).length;
  await Promise.all([sync(phone), sync(mac)]);
  expect(snapshots(rx.dir).length).toBe(before + 2); // no overwrite
  await sync(phone);
  await sync(mac);
  await sync(phone);
  for (const page of [phone, mac]) {
    expect((await run(page, (m) => m.db.stops.toArray())).map((s: any) => s.name).sort()).toEqual([
      'From the Mac',
      'From the phone',
    ]);
    expect(await run(page, async (m) => (await m.db.trips.toArray())[0])).toMatchObject({
      planText: 'Phone plan',
      nameManual: 'Mac name',
    });
  }
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

test('the current receiver verifies uploads, replaces a damaged copy, lists photos and passes Test connection', async ({
  makeContext,
}) => {
  const rx = phpReceiver()!;
  const phone = await device(makeContext, rx);
  const ids = await run(phone, async (m) => {
    const trip = await m.createTrip('custom');
    const out: string[] = [];
    for (const [i, n] of [2_000, 3_000, 1_500_000].entries())
      out.push(
        await m.addPhoto(new Blob([new Uint8Array(n).fill(i + 7)], { type: 'image/png' }), {
          tripId: trip,
          kind: 'cover',
        }),
      );
    return out;
  });
  // A half-written copy of the second photo is already on the NAS.
  const photos = join(rx.dir, 'systema-backups', 'photos');
  mkdirSync(photos, { recursive: true });
  writeFileSync(join(photos, `${ids[1]}.png`), 'trunc');

  expect(await sync(phone)).toMatchObject({ ok: true });
  expect(readFileSync(join(photos, `${ids[1]}.png`)).length).toBe(3_000); // replaced, verified
  expect(readFileSync(join(photos, `${ids[2]}.png`)).length).toBe(1_500_000);
  expect(await run(phone, async (m) => m.nasBackup.failures)).toEqual({});

  // The listing answers the check in one request.
  const check = await run(phone, async (m) => m.nasBackup.check());
  expect(check.message).toContain('Every photo it lists is on the NAS.');

  const test = await run(phone, async (m) => m.nasBackup.testConnection());
  expect(test.checks.map((c: any) => [c.label.split(' ')[0], c.ok])).toEqual([
    ['Address', true],
    ['Receiver', true],
    ['Token', true],
    ['An', true],
  ]);
  expect(test.checks[1].detail).toContain('version 3');

  // The token travels in a header, so it never reaches the NAS's access log.
  const urls: string[] = [];
  phone.on('request', (r) => urls.push(r.url()));
  await sync(phone);
  expect(urls.some((u) => u.includes('systema-backup.php'))).toBe(true);
  expect(urls.filter((u) => u.includes('token='))).toEqual([]);
});

test('revised routes and mixed photo formats converge through current and legacy NAS receivers', async ({
  makeContext,
}) => {
  // Independently known: `shasum -a 256 tests/fixtures/reliability/*`.
  const HASH: Record<string, string> = {
    heic: '024afeaa6c5bf99e1bf8991d809a1506d2ebf9bf7e535fdd285b6b2e7f2d95bb',
    heif: 'a5d5667d41e91a4330dd6bde8cb01b9fba4d95b763030e9107d8321ec711afe7',
    jpg: 'fc720740d2ff97389e83dadf65a3e333d295ae2f3cfa7c5823e323e1d89c4f9d',
    png: '3421731e84b62704d2a6cde3d120c238c64d42ec8f770fdf88ca9e08e431c58e',
    webp: '34b7e5b7501f18f60bb2434989dcd593b754d9c82703846ec27b76ba1d4f8dbf',
  };
  const LATE = 'taken after the first sync';
  HASH.late = createHash('sha256').update(LATE).digest('hex');
  HASH.historical = HASH.heic;
  const MIME: Record<string, string> = {
    heic: 'image/heic',
    heif: 'image/heif',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    historical: 'image/heic',
    late: '',
  };
  // Every receiver keeps the names it always has: HEIC/HEIF under .jpg.
  const NAS_EXT: Record<string, string> = {
    heic: 'jpg',
    heif: 'jpg',
    jpg: 'jpg',
    png: 'png',
    webp: 'webp',
    historical: 'jpg',
    late: 'jpg',
  };
  const bytes = Object.fromEntries(
    ['heic', 'heif', 'jpg', 'png', 'webp'].map((e) => [
      e,
      [...readFileSync(`tests/fixtures/reliability/sample.${e}`)],
    ]),
  );
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const stopsOf = (page: Page) =>
    run(page, async (m) =>
      (await m.db.stops.toArray())
        .sort((a: any, b: any) => a.order - b.order)
        .map(({ updatedAt: _u, ...s }: any) => s),
    );
  const photosOf = (page: Page) =>
    run(page, async (m) =>
      Object.fromEntries(
        await Promise.all(
          (await m.db.photos.toArray()).map(async (p: any) => [
            p.id,
            [p.blob.type, await m.sha256Hex(await p.blob.arrayBuffer()), p.stopId],
          ]),
        ),
      ),
    );

  for (const receiver of [
    'nas/systema-backup.php',
    'tests/e2e/systema-backup-v1.1.php',
    'tests/e2e/systema-backup-v1.php',
  ]) {
    const rx = phpReceiver(receiver)!;
    const phone = await device(makeContext, rx);
    const t = await run(
      phone,
      async (m, b: Record<string, number[]>) => {
        Object.assign(m, await import(/* @vite-ignore */ '/src/lib/plan-revision.ts'));
        const trip = await m.createTrip('custom');
        const v1 = await m.addCity(trip, 'Vienna', 'EUR');
        const sb = await m.addCity(trip, 'Salzburg', 'EUR');
        const v2 = await m.addCity(trip, 'Vienna', 'EUR');
        const cities = await m.db.cities.where('tripId').equals(trip).sortBy('order');
        const names = cities.map((c: any) => c.name);
        const plan0 =
          '# Vienna\n## Route\n### Belvedere\n- [ ] Find the gate\n- [ ] Old cue\n# Salzburg\n## Route\n### Fortress\nFunicular\n# Vienna\n## Route\n### Prater\nWheel';
        await m.db.trips.update(trip, { planText: plan0 });
        await m.importStopsFromPlan(trip, plan0, [], cities);
        const belvedere = (await m.db.stops.toArray()).find((s: any) => s.name === 'Belvedere');
        await m.updateStop(belvedere.id, { cityId: v1 });
        await m.addStop(trip, 'Prater', v2);
        // Revised: Prater on both Vienna visits is decided explicitly; one cue retired.
        const plan1 =
          '# Vienna\n## Route\n### Belvedere\n- [ ] Find the gate\n- [ ] Upper terrace\n# Salzburg\n## Route\n### Fortress\nFunicular\n# Vienna\n## Route\n### Prater\nWheel\n### Naschmarkt\nStalls';
        const stops = await m.db.stops.where('tripId').equals(trip).sortBy('order');
        const candidates = m.extractStopsFromPlan(plan1, names);
        const prater = stops.filter((s: any) => s.name === 'Prater');
        const matches = m
          .reviewMatches(candidates, stops, cities)
          .map((id: string) =>
            id === m.UNDECIDED ? prater.find((s: any) => s.cityId === v2).id : id,
          );
        await m.savePlanRevision(
          await m.db.trips.get(trip),
          plan1,
          candidates,
          matches,
          stops,
          cities,
        );
        const target = { tripId: trip, stopId: belvedere.id, kind: 'stop' };
        const blob = (e: string, type: string) => new Blob([new Uint8Array(b[e])], { type });
        const id: Record<string, string> = {};
        for (const [k, type] of [
          ['heic', ''],
          ['heif', 'image/jpeg'],
          ['jpg', 'image/jpeg'],
          ['png', ''],
          ['webp', 'image/webp'],
        ])
          id[k] = await m.addPhoto(blob(k, type), target);
        // A HEIC as an older version stored it, typed JPEG.
        id.historical = '00000003-0ff1-4000-8000-000000000000';
        await m.db.photos.add({
          id: id.historical,
          tripId: trip,
          stopId: belvedere.id,
          expenseId: null,
          kind: 'stop',
          blob: blob('heic', 'image/jpeg'),
          createdAt: 1,
        });
        return { trip, v1, sb, v2, id, belvedere: belvedere.id };
      },
      bytes,
    );
    // The revision itself, checked by hand: legs kept, unknown stays unknown.
    expect((await stopsOf(phone)).map((s: any) => [s.name, s.cityId, !!s.offPlan])).toEqual([
      ['Belvedere', t.v1, false],
      ['Fortress', t.sb, false],
      ['Prater', t.v2, false],
      ['Naschmarkt', null, false],
      // Not chosen, and not provably the plan's own: kept on the route, with no leg.
      ['Prater', null, false],
    ]);
    expect(
      (await stopsOf(phone))[0].checklist.map((c: any) => [c.text, c.done, !!c.fromPlan]),
    ).toEqual([
      ['Find the gate', false, true],
      ['Upper terrace', false, true],
    ]);
    // The current receiver: a PNG an older app uploaded as .jpg (its type was
    // missing) is that photo's copy; the new .png name must not add a second.
    const current = receiver === 'nas/systema-backup.php';
    const dir = join(rx.dir, 'systema-backups', 'photos');
    const ext = { ...NAS_EXT, png: current ? 'jpg' : 'png' };
    if (current) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${t.id.png}.jpg`), Buffer.from(bytes.png));
    }
    expect(await sync(phone)).toMatchObject({ ok: true });

    // A photo whose upload lands but whose reply is lost on the way back.
    t.id.late = await run(
      phone,
      async (m, a: { trip: string; stop: string; text: string }) =>
        m.addPhoto(new Blob([a.text]), { tripId: a.trip, stopId: a.stop, kind: 'stop' }),
      { trip: t.trip, stop: t.belvedere, text: LATE },
    );
    let cut = 0;
    await phone.context().route(`${rx.url}*`, async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST' && url.searchParams.get('id') === t.id.late && !cut) {
        cut += 1;
        await route.fetch();
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    await sync(phone);
    await phone.context().unrouteAll();
    await sync(phone);
    expect(cut).toBe(1);
    expect(await run(phone, async (m) => m.nasBackup.failures)).toEqual({});

    // On the NAS: one file per photo, the original bytes, the names every version uses.
    const onNas = readdirSync(dir).filter((f) => !f.endsWith('.tmp'));
    expect(onNas.sort()).toEqual(
      Object.entries(t.id)
        .map(([k, id]) => `${id}.${ext[k]}`)
        .sort(),
    );
    for (const [k, id] of Object.entries(t.id))
      expect(sha(readFileSync(join(dir, `${id}.${ext[k]}`)))).toBe(HASH[k]);

    // A second device converges: the same route, legs and checklist marks, and
    // every original typed by its bytes — whatever the receiver called it.
    const mac = await device(makeContext, rx);
    expect(await sync(mac)).toMatchObject({ ok: true });
    expect(await stopsOf(mac)).toEqual(await stopsOf(phone));
    const want = Object.fromEntries(
      Object.entries(t.id).map(([k, id]) => [id, [MIME[k], HASH[k], t.belvedere]]),
    );
    expect(await photosOf(mac)).toEqual(want);

    // An explicit deletion reaches the other device.
    await run(mac, (m, id: string) => m.deletePhoto(id), t.id.jpg);
    expect(await sync(mac)).toMatchObject({ ok: true });
    expect(await sync(phone)).toMatchObject({ ok: true });
    expect(Object.keys(await photosOf(phone))).not.toContain(t.id.jpg);

    // A file lost from the NAS is reported as missing, never as downloaded.
    unlinkSync(join(dir, `${t.id.webp}.${ext.webp}`));
    const ipad = await device(makeContext, rx);
    const fresh = await sync(ipad);
    expect(fresh.message).toContain('1 photo not on the NAS yet');
    // Everything but the deleted photo and the lost file.
    const rest = Object.fromEntries(
      Object.entries(want).filter(([id]) => id !== t.id.jpg && id !== t.id.webp),
    );
    expect(await photosOf(ipad)).toEqual(rest);

    // Idle syncs write nothing.
    const before = snapshots(rx.dir);
    for (let i = 0; i < 2; i += 1)
      for (const page of [phone, mac]) expect((await sync(page)).message).toBe('Up to date.');
    expect(snapshots(rx.dir)).toEqual(before);
  }
});
