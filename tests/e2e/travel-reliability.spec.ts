import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { device, FakeNas, sync } from './nas-fake';

// Synthetic data in fresh browser contexts only. See
// docs/travel-reliability-closure.md for the proof route these belong to.

const run = <T, A>(page: Page, fn: (m: any, a: A) => Promise<T>, arg?: A) =>
  page.evaluate(
    async ([src, a]) => {
      const w = window as any;
      // A sync device (nas-fake) has some modules already; add the rest once.
      if (!w.m?.reviewMatches) {
        const paths = [
          '/src/lib/db.ts',
          '/src/lib/trips.ts',
          '/src/lib/stops.ts',
          '/src/lib/plan-revision.ts',
          '/src/lib/photos.ts',
          '/src/lib/photo-format.ts',
          '/src/lib/moments.ts',
          '/src/lib/export.ts',
          '/src/lib/zip.ts',
        ];
        w.m = Object.assign(
          w.m ?? {},
          ...(await Promise.all(paths.map((p) => import(/* @vite-ignore */ p)))),
        );
      }
      return new Function('m', 'a', `return (${src})(m, a)`)(w.m, a);
    },
    [fn.toString(), arg] as const,
  ) as Promise<T>;

/** A trip's stops in route order, as [name, leg id, off route]. */
const route = (page: Page, trip: string) =>
  run(
    page,
    async (m, t: string) =>
      (await m.db.stops.where('tripId').equals(t).sortBy('order')).map((s: any) => [
        s.name,
        s.cityId,
        !!s.offPlan,
      ]),
    trip,
  );

test('manual Stops stay in the intended leg when retained records trail the itinerary', async ({
  page,
}) => {
  await page.goto('/');
  const t = await run(page, async (m) => {
    const trip = await m.createTrip('custom');
    const v1 = await m.addCity(trip, 'Vienna', 'EUR');
    const sb = await m.addCity(trip, 'Salzburg', 'EUR');
    const v2 = await m.addCity(trip, 'Vienna', 'EUR');
    // A revised route with gaps and a tie in its positions, and two places the
    // revision kept off the route, last — one on the first leg, one visited.
    const row = (id: string, name: string, cityId: string, order: number, extra = {}) => ({
      id,
      tripId: trip,
      cityId,
      name,
      notes: `${name} notes`,
      checklist: [],
      visited: false,
      order,
      createdAt: 1,
      ...extra,
    });
    await m.db.stops.bulkAdd([
      row('belvedere', 'Belvedere', v1, 0),
      row('fortress', 'Fortress', sb, 2),
      row('prater', 'Prater', v2, 5),
      row('old-sb', 'Old Salzburg place', sb, 6, { offPlan: true, visited: true, visitedAt: 77 }),
      row('old-v1', 'Old Vienna place', v1, 6, { offPlan: true }),
    ]);
    const other = await m.createTrip('custom');
    await m.addCity(other, 'Lisbon', 'EUR');
    await m.addStop(other, 'Castle');
    const one = await m.createTrip('custom');
    const lisbon = await m.addCity(one, 'Lisbon', 'EUR');
    const none = await m.createTrip('custom');
    // Two legs, and every place kept off the route: nothing says where the trip is.
    const kept = await m.createTrip('custom');
    const porto = await m.addCity(kept, 'Porto', 'EUR');
    await m.addCity(kept, 'Braga', 'EUR');
    await m.db.stops.add({ ...row('kept', 'Kept', porto, 0, { offPlan: true }), tripId: kept });
    const unrelated = await m.db.stops.where('tripId').equals(other).toArray();
    return { trip, v1, sb, v2, other, unrelated, one, lisbon, none, kept };
  });
  const before = await run(
    page,
    (m, id: string) => m.db.stops.where('tripId').equals(id).toArray(),
    t.trip,
  );

  await page.goto(`/#/trip/${t.trip}/stops`);
  const name = page.getByPlaceholder('Add a stop');
  const leg = page.getByRole('combobox', { name: 'Leg for the new stop' });
  // The planned route ends in Vienna's second visit; the retained tail says nothing.
  await expect(leg).toHaveValue(t.v2);
  await expect(leg.locator('option')).toHaveText([
    'Vienna · leg 1',
    'Salzburg',
    'Vienna · leg 3',
    'Unassigned',
  ]);
  await name.fill('Hofburg');
  await name.press('Enter');
  await expect(page.locator('.stop-name')).toContainText(['Hofburg']);
  // An explicit choice, then two quick additions without waiting in between.
  await leg.selectOption({ label: 'Salzburg' });
  await name.fill('Mirabell');
  await name.press('Enter');
  await name.fill('Hellbrunn');
  await name.press('Enter');
  await leg.selectOption({ label: 'Vienna · leg 1' });
  await name.fill('Stephansdom');
  await name.press('Enter');
  await expect(page.locator('.stop-name')).toHaveCount(7);

  expect(await route(page, t.trip)).toEqual([
    ['Belvedere', t.v1, false],
    ['Stephansdom', t.v1, false],
    ['Fortress', t.sb, false],
    ['Mirabell', t.sb, false],
    ['Hellbrunn', t.sb, false],
    ['Prater', t.v2, false],
    ['Hofburg', t.v2, false],
    ['Old Salzburg place', t.sb, true],
    ['Old Vienna place', t.v1, true],
  ]);
  const after = await run(
    page,
    (m, id: string) => m.db.stops.where('tripId').equals(id).sortBy('order'),
    t.trip,
  );
  // One position each, with no ties left.
  expect(after.map((s: any) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // Existing places keep their identity and history; only position (and its write stamp) may move.
  const content = ({ order: _o, updatedAt: _u, ...rest }: any) => rest;
  for (const s of before)
    expect(content(after.find((a: any) => a.id === s.id))).toEqual(content(s));
  expect(
    await run(page, (m, id: string) => m.db.stops.where('tripId').equals(id).toArray(), t.other),
  ).toEqual(t.unrelated);

  // One leg: it is the leg. No legs, or legs but no route: unassigned, not guessed.
  for (const [trip, expected] of [
    [t.one, t.lisbon],
    [t.none, null],
    [t.kept, null],
  ] as const) {
    await page.goto(`/#/trip/${trip}/stops`);
    if (trip === t.kept) await expect(leg).toHaveValue('');
    else await expect(leg).toHaveCount(0);
    await name.fill('Somewhere');
    await name.press('Enter');
    await expect(page.locator('.stop-name')).toHaveText(['Somewhere']);
    expect((await route(page, trip)).find(([n]) => n === 'Somewhere')).toEqual([
      'Somewhere',
      expected,
      false,
    ]);
  }
});

test('ambiguous plan matches require a deliberate reuse or new-place decision', async ({
  page,
}) => {
  await page.goto('/');
  const plan = [
    '# Vienna',
    '## Route',
    '### Belvedere',
    'Upper palace',
    '### Albertina',
    'Prints',
    '# Salzburg',
    '## Route',
    '### Fortress',
    'Above the river',
    '### Mozart house',
    'Birthplace',
    '# Vienna',
    '## Route',
    '### Belvedere',
    'Lower palace',
  ].join('\n');
  const t = await run(
    page,
    async (m, plan: string) => {
      const trip = await m.createTrip('custom');
      const v1 = await m.addCity(trip, 'Vienna', 'EUR');
      const sb = await m.addCity(trip, 'Salzburg', 'EUR');
      const v2 = await m.addCity(trip, 'Vienna', 'EUR');
      const row = (id: string, name: string, cityId: string | null, order: number, extra = {}) => ({
        id,
        tripId: trip,
        cityId,
        name,
        notes: `My ${name}`,
        checklist: [{ id: `${id}-tick`, text: 'Mine', done: true }],
        visited: false,
        order,
        createdAt: 1,
        ...extra,
      });
      await m.db.stops.bulkAdd([
        row('b1', 'Belvedere', v1, 0, { visited: true, visitedAt: 100 }),
        // Renamed by hand; the plan still calls it Albertina.
        row('alb', 'My print room', v1, 1, {
          planSource: { name: 'Albertina', notes: 'Prints', checklist: [] },
        }),
        row('fortress', 'Fortress', sb, 2),
        row('b2', 'Belvedere', v2, 3),
        row('alb-loose', 'Albertina', null, 4),
      ]);
      await m.db.trips.update(trip, { planText: plan });
      return { trip, v1, sb, v2 };
    },
    plan,
  );
  const saved = () =>
    run(page, (m, id: string) => m.db.stops.where('tripId').equals(id).sortBy('order'), t.trip);
  const before = await saved();

  await page.goto(`/#/trip/${t.trip}/stops`);
  const open = () => page.getByRole('button', { name: 'Review Stops from plan' }).click();
  await open();
  const sheet = page.locator('dialog[open]');
  const apply = sheet.getByRole('button', { name: 'Apply plan' });
  const rows = sheet.locator('.revision-row');
  // Known ambiguity is asked about, never shown as a new place.
  await expect(rows.nth(0)).toContainText('2 of your places could be this one');
  await expect(rows.nth(1)).toContainText('2 of your places could be this one');
  await expect(rows.nth(4)).toContainText('2 of your places could be this one');
  // An obvious match and an ordinary new place need nothing.
  await expect(rows.nth(2)).toContainText('Keeps your record');
  await expect(rows.nth(2).getByRole('combobox')).toHaveCount(0);
  await expect(rows.nth(3)).toContainText('New place');
  await expect(rows.nth(3).getByRole('combobox')).toHaveCount(0);
  await expect(sheet.getByRole('alert')).toContainText('Choose for 3 places');
  await expect(apply).toBeDisabled();
  // Only the plausible records are offered, with their leg and history.
  await expect(rows.nth(0).locator('option')).toHaveText([
    'Choose…',
    'Add as a new place',
    'Belvedere · Vienna · leg 1 · visited · keep this record',
    'Belvedere · Vienna · leg 3 · keep this record',
  ]);
  await expect(rows.nth(1).locator('option')).toHaveText([
    'Choose…',
    'Add as a new place',
    'My print room · Vienna · leg 1 · keep this record',
    'Albertina · keep this record',
  ]);

  // Cancelling writes nothing.
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  expect(await saved()).toEqual(before);

  await open();
  const first = rows.nth(0).getByRole('combobox');
  const second = rows.nth(4).getByRole('combobox');
  await first.selectOption('b1');
  await second.selectOption('b1');
  // One record can't be two places.
  await expect(sheet.getByText('Choose each existing place only once.')).toBeVisible();
  await expect(apply).toBeDisabled();
  await second.selectOption('b2');
  // A deliberate same-name new place.
  await rows.nth(1).getByRole('combobox').selectOption({ label: 'Add as a new place' });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(sheet).toHaveCount(0);

  const after = await saved();
  const byId = (id: string) => after.find((s: any) => s.id === id);
  // Chosen records keep their own leg and history; nothing moved between legs.
  expect(byId('b1')).toMatchObject({
    cityId: t.v1,
    visited: true,
    visitedAt: 100,
    notes: 'My Belvedere',
  });
  expect(byId('b2')).toMatchObject({ cityId: t.v2, visited: false, notes: 'My Belvedere' });
  expect(byId('fortress')).toMatchObject({ cityId: t.sb, notes: 'My Fortress' });
  for (const id of ['b1', 'b2', 'fortress', 'alb', 'alb-loose'])
    expect(byId(id).checklist).toEqual([{ id: `${id}-tick`, text: 'Mine', done: true }]);
  // Both Albertina records stay; the new one is unassigned: Vienna is two legs.
  const added = after.filter((s: any) => !before.some((b: any) => b.id === s.id));
  expect(added.map((s: any) => [s.name, s.cityId])).toEqual([
    ['Albertina', null],
    ['Mozart house', t.sb],
  ]);
  expect(after.map((s: any) => [s.name, s.cityId, !!s.offPlan])).toEqual([
    ['Belvedere', t.v1, false],
    ['My print room', t.v1, false],
    ['Albertina', null, false],
    ['Albertina', null, false],
    ['Fortress', t.sb, false],
    ['Mozart house', t.sb, false],
    ['Belvedere', t.v2, false],
  ]);
});

test('extraction and reviewed revisions never choose an arbitrary repeated-city leg', async ({
  page,
}) => {
  await page.goto('/');
  const out = await run(page, async (m) => {
    const trip = await m.createTrip('custom');
    const v1 = await m.addCity(trip, 'Vienna', 'EUR');
    const sb = await m.addCity(trip, 'Salzburg', 'EUR');
    const v2 = await m.addCity(trip, 'Vienna', 'EUR');
    const cities = await m.db.cities.where('tripId').equals(trip).sortBy('order');
    const names = cities.map((c: any) => c.name);
    const stops = () => m.db.stops.where('tripId').equals(trip).sortBy('order');
    const view = async () =>
      (await stops()).map((s: any) => [s.name, s.cityId, s.guide?.anchor ?? null]);
    const plan =
      '# Vienna\n## Route\n### Belvedere\nAnchor: Upper palace\n### Naschmarkt\nStalls\n# Salzburg\n## Route\n### Fortress\nAnchor: Funicular\n# Vienna\n## Route\n### Prater\nWheel';
    const r: Record<string, unknown> = {};
    // Legacy extraction: the Salzburg block has one leg; the Vienna blocks two.
    r.imported = await m.importStopsFromPlan(trip, plan, [], cities);
    r.extracted = await view();
    // Presence and repeated application: nothing found new, nothing added again.
    r.fresh = m.newStopCandidates(plan, await stops(), names, m.cityIds(cities));
    r.again = await m.importStopsFromPlan(trip, plan, await stops(), cities);

    // The traveller puts Belvedere on the first visit and adds one on the second.
    const belvedere = (await stops()).find((s: any) => s.name === 'Belvedere');
    await m.updateStop(belvedere.id, { cityId: v1, guide: undefined });
    const second = await m.addStop(trip, 'Belvedere', v2);
    const naschmarkt = (await stops()).find((s: any) => s.name === 'Naschmarkt');
    await m.updateStop(naschmarkt.id, { guide: undefined });
    // Identical names on two legs: which one a heading means is unknown, so
    // neither is filled; the unassigned Naschmarkt is the only one, so it is.
    r.backfill = m.guideBackfill(plan, await stops(), names, m.cityIds(cities));
    r.presentTwice = m.newStopCandidates(plan, await stops(), names, m.cityIds(cities));
    // A heading for a leg the trip no longer has, and a plan with no headings.
    r.unknownLeg = m
      .newStopCandidates(
        '# Graz\n## Route\n### Belvedere\nAnchor: Elsewhere',
        await stops(),
        names,
        m.cityIds(cities),
      )
      .map((c: any) => [c.name, c.city]);
    r.unknownBackfill = m.guideBackfill(
      '# Graz\n## Route\n### Belvedere\nAnchor: Elsewhere',
      await stops(),
      names,
      m.cityIds(cities),
    );
    r.noHeadings = m.newStopCandidates(
      '## Route\n### Belvedere\nx',
      await stops(),
      names,
      m.cityIds(cities),
    );
    r.noHeadingsBackfill = m.guideBackfill(
      '## Route\n### Belvedere\nAnchor: x',
      await stops(),
      names,
      m.cityIds(cities),
    );

    // Reviewed apply: the same plan, revised. Belvedere waits for a decision.
    const revised = `${plan}\n### Belvedere\nLower palace\n### Hofburg\nTreasury`;
    const candidates = m.extractStopsFromPlan(revised, names);
    const current = await stops();
    const matches = m.reviewMatches(candidates, current, cities);
    r.review = candidates.map((c: any, i: number) => [
      c.name,
      matches[i] === m.UNDECIDED
        ? 'decide'
        : matches[i]
          ? `keeps ${current.find((s: any) => s.id === matches[i]).cityId ?? 'no leg'}`
          : 'new',
    ]);
    await m.db.trips.update(trip, { planText: plan });
    const tripRow = await m.db.trips.get(trip);
    r.refused = await m
      .savePlanRevision(tripRow, revised, candidates, matches, current, cities)
      .then(
        () => 'saved',
        (e: Error) => e.message,
      );
    r.unchanged = JSON.stringify(await stops()) === JSON.stringify(current);
    const decided = matches.map((id: string, i: number) =>
      id !== m.UNDECIDED ? id : i === 0 ? belvedere.id : second,
    );
    await m.savePlanRevision(tripRow, revised, candidates, decided, current, cities);
    r.applied = (await stops()).map((s: any) => [s.name, s.cityId, !!s.offPlan]);
    // Applying it again finds every place and asks again only about Belvedere.
    const again = m.reviewMatches(m.extractStopsFromPlan(revised, names), await stops(), cities);
    r.reapplied = again.map((id: string) => (id === m.UNDECIDED ? 'decide' : id ? 'kept' : 'new'));
    r.ids = { belvedere: belvedere.id, second, naschmarkt: naschmarkt.id };
    return { r, v1, sb, v2 };
  });
  const { r, v1, sb, v2 } = out;
  // Never the last Vienna leg by default — the defect this closes put all three there.
  expect(r.imported).toBe(4);
  expect(r.extracted).toEqual([
    ['Belvedere', null, 'Upper palace'],
    ['Naschmarkt', null, null],
    ['Fortress', sb, 'Funicular'],
    ['Prater', null, null],
  ]);
  expect(r.fresh).toEqual([]);
  expect(r.again).toBe(0);
  expect(r.backfill).toEqual([]);
  expect(r.presentTwice).toEqual([]);
  // An unknown leg matches only places with no leg: never a Vienna one.
  expect(r.unknownLeg).toEqual([['Belvedere', 'Graz']]);
  expect(r.unknownBackfill).toEqual([]);
  expect(r.noHeadings).toEqual([]);
  expect(r.noHeadingsBackfill).toEqual([]);
  expect(r.review).toEqual([
    ['Belvedere', 'decide'],
    ['Naschmarkt', 'keeps no leg'],
    ['Fortress', `keeps ${sb}`],
    ['Prater', 'keeps no leg'],
    ['Belvedere', 'decide'],
    ['Hofburg', 'new'],
  ]);
  expect(r.refused).toBe('Choose which existing place each repeated name is, or add it as new');
  expect(r.unchanged).toBe(true);
  expect(r.applied).toEqual([
    ['Belvedere', v1, false],
    ['Naschmarkt', null, false],
    ['Fortress', sb, false],
    ['Prater', null, false],
    ['Belvedere', v2, false],
    ['Hofburg', null, false],
  ]);
  expect(r.reapplied).toEqual(['decide', 'kept', 'kept', 'kept', 'decide', 'kept']);
});

const fixture = (ext: string) => readFileSync(`tests/fixtures/reliability/sample.${ext}`);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A JPEG header carrying an EXIF capture time ('YYYY:MM:DD HH:MM:SS'), padded to `size`. */
function jpegTakenAt(date: string, size: number): Buffer {
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
  const d = str(date);
  const exifIfd = 8 + 2 + 12 + 4;
  const dataAt = exifIfd + 2 + 12 + 4;
  const tiff = [0x49, 0x49, ...u16(42), ...u32(8), ...u16(1), ...u16(0x8769), ...u16(4)];
  tiff.push(...u32(1), ...u32(exifIfd), ...u32(0), ...u16(1), ...u16(0x9003), ...u16(2));
  tiff.push(...u32(d.length), ...u32(dataAt), ...u32(0), ...d);
  const app1 = [...str('Exif'), 0, ...tiff];
  const head = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
  ]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, date.length)]);
}

/** Make the next photo writes fail: `after` succeed first, then every one fails until cleared. */
const failPhotoWrites = (page: Page, after: number) =>
  run(
    page,
    async (m, after: number) => {
      let n = 0;
      const w = window as any;
      w.failWrites = () => {
        n += 1;
        if (n > after) throw new Error('Synthetic quota exceeded');
      };
      m.db.photos.hook('creating', w.failWrites);
    },
    after,
  );
const allowPhotoWrites = (page: Page) =>
  run(page, async (m) => m.db.photos.hook('creating').unsubscribe((window as any).failWrites));

test('photo batch failures preserve committed records and retry without duplicating completed work', async ({
  page,
}) => {
  await page.goto('/');
  // Fixed files in pick order: two carry EXIF times (out of order), three have none.
  const picked = [
    {
      name: 'late.jpg',
      mimeType: 'image/jpeg',
      buffer: jpegTakenAt('2026:10:02 12:00:00', 300_000),
    },
    {
      name: 'early.jpg',
      mimeType: 'image/jpeg',
      buffer: jpegTakenAt('2026:10:01 09:00:00', 40_000),
    },
    { name: 'sample.png', mimeType: 'image/png', buffer: fixture('png') },
    { name: 'sample.heic', mimeType: 'image/heic', buffer: fixture('heic') },
    { name: 'sample.webp', mimeType: 'image/webp', buffer: fixture('webp') },
  ];
  const [late, early, png, heic, webp] = picked.map((f) => sha(f.buffer));
  const existing = Buffer.from('an original already on this stop');
  const t = await run(
    page,
    async (m, existing: number[]) => {
      const trip = await m.createTrip('custom');
      const city = await m.addCity(trip, 'Barcelona', 'EUR', { tz: 'Europe/Madrid' });
      const stop = await m.addStop(trip, 'Sagrada Familia', city);
      const id = await m.addPhoto(new Blob([new Uint8Array(existing)], { type: 'image/png' }), {
        tripId: trip,
        stopId: stop,
        kind: 'stop',
      });
      // Taken before everything picked below.
      await m.db.photos.update(id, { takenAt: Date.UTC(2026, 8, 1) });
      return { trip, stop };
    },
    [...existing],
  );
  const photos = () =>
    run(page, async (m) =>
      Promise.all(
        (await m.db.photos.toArray())
          .sort((a: any, b: any) => m.photoTime(a) - m.photoTime(b))
          .map(async (p: any) => ({
            sha: await m.sha256Hex(await p.blob.arrayBuffer()),
            stopId: p.stopId,
            momentId: p.momentId ?? null,
            expenseId: p.expenseId,
          })),
      ),
    );
  const shas = async () => (await photos()).map((p) => p.sha);

  await page.goto(`/#/trip/${t.trip}/stops/${t.stop}`);
  const library = page.locator('input[type="file"]:not([capture])');
  const alert = page.getByRole('alert');

  // A failure before the first save: nothing saved, the one file offered again.
  await failPhotoWrites(page, 0);
  await library.setInputFiles(picked[2]);
  await expect(alert).toContainText('0 photos saved; 1 not saved: Synthetic quota exceeded');
  await allowPhotoWrites(page);
  await page.getByRole('button', { name: 'Retry 1 photo' }).click();
  await expect(alert).toHaveCount(0);
  await expect.poll(shas).toEqual([sha(existing), png]);

  // Storage fills mid-batch: the photos taken first are saved, the rest wait.
  // (The PNG saved above is removed first, so this batch starts clean.)
  await run(
    page,
    async (m, png: string) => {
      for (const p of await m.db.photos.toArray())
        if ((await m.sha256Hex(await p.blob.arrayBuffer())) === png) await m.deletePhoto(p.id);
    },
    png,
  );
  await failPhotoWrites(page, 2);
  await library.setInputFiles(picked);
  await expect(alert).toContainText('2 photos saved; 3 not saved: Synthetic quota exceeded');
  expect(await shas()).toEqual([sha(existing), early, late]);
  await allowPhotoWrites(page);
  await page.getByRole('button', { name: 'Retry 3 photos' }).click();
  await expect(alert).toHaveCount(0);
  // Every photo once, in the order taken (EXIF first, then as picked); the
  // original already there untouched.
  await expect.poll(shas).toEqual([sha(existing), early, late, png, heic, webp]);
  expect((await photos()).every((p) => p.stopId === t.stop)).toBe(true);

  // Read and hash failures part-way stop the batch the same way.
  const partial = await run(
    page,
    async (m, a: { trip: string; stop: string }) => {
      const target = { tripId: a.trip, stopId: a.stop, kind: 'stop' };
      const unreadable = new Blob([new Uint8Array([1, 2, 3])]);
      unreadable.arrayBuffer = () => Promise.reject(new Error('Synthetic read failure'));
      const out: unknown[] = [];
      try {
        await m.addPhotos([new Blob(['read ok']), unreadable, new Blob(['read later'])], target);
      } catch (e: any) {
        out.push([e.message, e.saved.length, e.remaining.length]);
        await m.addPhotos(e.remaining.slice(1), target);
      }
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let calls = 0;
      crypto.subtle.digest = ((...args: [any, any]) =>
        (calls += 1) === 2
          ? Promise.reject(new Error('Synthetic hash failure'))
          : digest(...args)) as any;
      try {
        await m.addPhotos(
          [new Blob(['hash ok']), new Blob(['hash fails']), new Blob(['hash later'])],
          target,
        );
      } catch (e: any) {
        out.push([e.message, e.saved.length, e.remaining.length]);
        await m.addPhotos(e.remaining, target);
      } finally {
        crypto.subtle.digest = digest;
      }
      const texts = await Promise.all(
        (await m.db.photos.toArray())
          .filter((p: any) => !p.blob.type)
          .map((p: any) => p.blob.text()),
      );
      return { out, texts: texts.sort() };
    },
    t,
  );
  expect(partial.out).toEqual([
    ['Synthetic read failure', 1, 2],
    ['Synthetic hash failure', 1, 2],
  ]);
  expect(partial.texts).toEqual(['hash fails', 'hash later', 'hash ok', 'read later', 'read ok']);
  await run(page, async (m) =>
    m.db.photos.bulkDelete(
      (await m.db.photos.toArray()).filter((p: any) => !p.blob.type).map((p: any) => p.id),
    ),
  );

  // A new Moment and its photos save together or not at all; the draft stays.
  await page.goto(`/#/trip/${t.trip}/stops`);
  await page.getByRole('button', { name: 'What happened?' }).click();
  const sheet = page.locator('dialog.modal[open]');
  await sheet.getByLabel('Place or event').fill('Choir in the nave');
  await sheet.locator('input[type="file"]:not([capture])').setInputFiles([picked[1], picked[4]]);
  await failPhotoWrites(page, 1);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Not saved: Synthetic quota exceeded');
  await expect(sheet.getByLabel('Place or event')).toHaveValue('Choir in the nave');
  expect(await run(page, async (m) => m.db.moments.count())).toBe(0);
  expect((await shas()).length).toBe(6);
  await allowPhotoWrites(page);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const moment = await run(page, async (m) => (await m.db.moments.toArray())[0].id);
  expect((await photos()).filter((p) => p.momentId === moment).map((p) => p.sha)).toEqual([
    early,
    webp,
  ]);

  // Adding to that existing Moment: a failure adds nothing and changes nothing.
  const before = await run(page, async (m) => (await m.db.moments.toArray())[0]);
  await page.getByRole('button', { name: /Choir in the nave/ }).click();
  await sheet.locator('input[type="file"]:not([capture])').setInputFiles(picked[3]);
  await failPhotoWrites(page, 0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Not saved');
  expect(await run(page, async (m) => (await m.db.moments.toArray())[0])).toEqual(before);
  expect((await shas()).length).toBe(8);
  await allowPhotoWrites(page);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect((await photos()).filter((p) => p.momentId === moment).map((p) => p.sha)).toEqual([
    early,
    webp,
    heic,
  ]);

  // A new expense and its receipt: the same, and the amount typed stays.
  await page.goto(`/#/trip/${t.trip}/expenses`);
  await page.getByRole('button', { name: 'Add' }).click();
  for (const k of '18') await sheet.getByRole('button', { name: k, exact: true }).click();
  await sheet.getByRole('button', { name: 'Museum', exact: true }).click();
  await sheet.locator('input[type="file"]:not([capture])').setInputFiles(picked[2]);
  await failPhotoWrites(page, 0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Not saved: Synthetic quota exceeded');
  await expect(sheet.getByText('1 receipt photo attached.')).toBeAttached();
  expect(await run(page, async (m) => m.db.expenses.count())).toBe(0);
  await allowPhotoWrites(page);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const expense = await run(page, async (m) => (await m.db.expenses.toArray())[0]);
  expect(expense.amountLocal || expense.amountGBP).toBe(18);
  expect((await photos()).filter((p) => p.expenseId === expense.id).map((p) => p.sha)).toEqual([
    png,
  ]);
  // The Stop's photos, from first to last, are exactly as saved above.
  expect(
    (await photos()).filter((p) => p.stopId === t.stop && !p.momentId).map((p) => p.sha),
  ).toEqual([sha(existing), early, late, png, heic, webp]);
});

/** A stored ZIP's entries, read here rather than by the app's own reader. */
function zipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let p = 0; buf.readUInt32LE(p) === 0x04034b50; ) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const start = p + 30 + nameLen + buf.readUInt16LE(p + 28);
    out.set(buf.toString('utf8', p + 30, p + 30 + nameLen), buf.subarray(start, start + size));
    p = start + size;
  }
  return out;
}

// Independently known: `shasum -a 256 tests/fixtures/reliability/*` when the fixtures were made.
const HASH = {
  heic: '024afeaa6c5bf99e1bf8991d809a1506d2ebf9bf7e535fdd285b6b2e7f2d95bb',
  heif: 'a5d5667d41e91a4330dd6bde8cb01b9fba4d95b763030e9107d8321ec711afe7',
  jpg: 'fc720740d2ff97389e83dadf65a3e333d295ae2f3cfa7c5823e323e1d89c4f9d',
  png: '3421731e84b62704d2a6cde3d120c238c64d42ec8f770fdf88ca9e08e431c58e',
  webp: '34b7e5b7501f18f60bb2434989dcd593b754d9c82703846ec27b76ba1d4f8dbf',
};
const MIME: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const JUNK = 'neither an image nor anything else';

/**
 * One trip whose Stop holds every format, picked with a missing or wrong type
 * where browsers give one, plus two rows as an older version left them (HEIC
 * and HEIF bytes typed JPEG) and a file nothing can read; and an unrelated trip.
 */
async function mixedFormats(page: Page) {
  const bytes = Object.fromEntries(
    ['heic', 'heif', 'jpg', 'png', 'webp'].map((e) => [e, [...fixture(e)]]),
  );
  return run(
    page,
    async (m, b: Record<string, number[]>) => {
      const blob = (e: string, type: string) => new Blob([new Uint8Array(b[e])], { type });
      const trip = await m.createTrip('custom');
      const city = await m.addCity(trip, 'Porto', 'EUR');
      const stop = await m.addStop(trip, 'Livraria', city);
      const target = { tripId: trip, stopId: stop, kind: 'stop' };
      const id: Record<string, string> = {};
      for (const [k, type] of [
        ['heic', ''],
        ['heif', 'image/jpeg'],
        ['jpg', 'image/jpeg'],
        ['png', ''],
        ['webp', 'image/webp'],
      ])
        id[k] = await m.addPhoto(blob(k, type), target);
      id.junk = await m.addPhoto(new Blob(['neither an image nor anything else']), target);
      for (const k of ['heic', 'heif']) {
        id[`old-${k}`] = `0000000${k === 'heic' ? 1 : 2}-0ff1-4000-8000-000000000000`;
        await m.db.photos.add({
          id: id[`old-${k}`],
          tripId: trip,
          stopId: stop,
          expenseId: null,
          kind: 'stop',
          blob: blob(k, 'image/jpeg'),
          createdAt: 1,
        });
      }
      const other = await m.createTrip('custom');
      id.other = await m.addPhoto(blob('jpg', 'image/jpeg'), { tripId: other, kind: 'stop' });
      return { trip, stop, other, id };
    },
    bytes,
  );
}

test('HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore', async ({
  page,
  makeContext,
}) => {
  await page.goto('/');
  const t = await mixedFormats(page);
  // What each record must be: from the fixture files, never from the app.
  const expected: Record<string, { sha: string; ext: string; mime: string }> = {
    junk: { sha: sha(Buffer.from(JUNK)), ext: 'bin', mime: '' },
    other: { sha: HASH.jpg, ext: 'jpg', mime: MIME.jpg },
  };
  for (const k of ['heic', 'heif', 'jpg', 'png', 'webp'])
    expected[k] = { sha: HASH[k as keyof typeof HASH], ext: k, mime: MIME[k] };
  for (const k of ['heic', 'heif']) expected[`old-${k}`] = expected[k];
  const keyOf = Object.fromEntries(Object.entries(t.id).map(([k, id]) => [id, k]));

  // Captured with the type the bytes show; an older row keeps what it had.
  const stored = await run(page, async (m) =>
    Object.fromEntries(
      await Promise.all(
        (await m.db.photos.toArray()).map(async (p: any) => [
          p.id,
          {
            type: p.blob.type,
            sha: await m.sha256Hex(await p.blob.arrayBuffer()),
            stopId: p.stopId,
          },
        ]),
      ),
    ),
  );
  for (const [id, s] of Object.entries<any>(stored)) {
    const k = keyOf[id];
    expect(s.sha).toBe(expected[k].sha);
    expect(s.type).toBe(k.startsWith('old-') ? 'image/jpeg' : expected[k].mime);
  }

  // Single downloads: every Save gives the original bytes under their real extension.
  await page.goto(`/#/trip/${t.trip}/stops/${t.stop}`);
  const saves = page.getByRole('button', { name: 'Save photo' });
  await expect(saves).toHaveCount(8);
  const downloaded: [string, string][] = [];
  for (let i = 0; i < 8; i += 1) {
    const [download] = await Promise.all([page.waitForEvent('download'), saves.nth(i).click()]);
    downloaded.push([
      download.suggestedFilename().split('.').pop()!,
      sha(readFileSync((await download.path())!)),
    ]);
  }
  const ownTrip = Object.keys(t.id).filter((k) => k !== 'other');
  expect(downloaded.sort()).toEqual(ownTrip.map((k) => [expected[k].ext, expected[k].sha]).sort());

  // The numbered photos for the journaling prompt, as handed to the share sheet.
  await page.goto(`/#/trip/${t.trip}/export`);
  await page.evaluate(() => {
    const nav = navigator as any;
    nav.canShare = () => true;
    nav.share = async ({ files }: { files: File[] }) => {
      (window as any).shared = await Promise.all(
        files.map(async (f) => [f.name, f.type, [...new Uint8Array(await f.arrayBuffer())]]),
      );
    };
  });
  await page.getByRole('button', { name: /Share the photos/ }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).shared)).toBe(true);
  const shared: [string, string, number[]][] = await page.evaluate(() => (window as any).shared);
  expect(
    shared
      .map(([name, type, b]) => [name.replace(/^\d+-P-[0-9a-f]+/, ''), type, sha(Buffer.from(b))])
      .sort(),
  ).toEqual(ownTrip.map((k) => [`.${expected[k].ext}`, expected[k].mime, expected[k].sha]).sort());

  // A full backup names each photo for what it is, with the bytes unchanged.
  const backup = Buffer.from(
    await run(page, async (m) => [
      ...new Uint8Array(await (await m.buildZipBackup()).arrayBuffer()),
    ]),
  );
  const entries = zipEntries(backup);
  for (const [id, k] of Object.entries(keyOf))
    expect(sha(entries.get(`photos/${id}.${expected[k].ext}`)!)).toBe(expected[k].sha);
  // As an older version wrote it: HEIC and HEIF named .jpg.
  const json = entries.get('systema-backup.json')!.toString();
  const old = await run(
    page,
    async (m, a: { json: string; names: [string, number[]][] }) => {
      const z = await m.zip([
        { name: 'systema-backup.json', data: new Blob([a.json]) },
        ...a.names.map(([name, b]) => ({ name, data: new Blob([new Uint8Array(b)]) })),
      ]);
      return [...new Uint8Array(await z.arrayBuffer())];
    },
    {
      json,
      names: [...entries]
        .filter(([n]) => n.startsWith('photos/'))
        .map(([n, b]) => [n.replace(/\.(heic|heif)$/, '.jpg'), [...b]] as [string, number[]]),
    },
  );

  const restore = async (target: Page, file: number[] | Buffer) =>
    run(
      target,
      async (m, bytes: number[]) => {
        const { backup, files } = await m.readBackupFile(new Blob([new Uint8Array(bytes)]));
        return m.importBackup(backup, files);
      },
      [...file],
    );
  const restored = async (target: Page) =>
    run(target, async (m) =>
      Object.fromEntries(
        await Promise.all(
          (await m.db.photos.toArray()).map(async (p: any) => [
            p.id,
            [p.blob.type, await m.sha256Hex(await p.blob.arrayBuffer()), p.stopId, p.tripId],
          ]),
        ),
      ),
    );
  const want = Object.fromEntries(
    Object.entries(t.id).map(([k, id]) => [
      id,
      [
        expected[k].mime,
        expected[k].sha,
        k === 'other' ? null : t.stop,
        k === 'other' ? t.other : t.trip,
      ],
    ]),
  );
  for (const file of [backup, old]) {
    const fresh = await makeContext();
    const other = fresh.pages()[0] ?? (await fresh.newPage());
    await other.goto('/');
    expect(await restore(other, file)).toMatchObject({
      trips: 2,
      stops: 1,
      photos: 9,
      missingPhotos: 0,
    });
    // Bytes, links and the format the bytes show — even from .jpg names.
    expect(await restored(other)).toEqual(want);
    // Restoring again only adds what is missing: nothing, and nothing changes.
    await run(other, (m, s: string) => m.updateStop(s, { notes: 'Edited after restore' }), t.stop);
    expect(await restore(other, file === backup ? old : backup)).toMatchObject({
      photos: 0,
      stops: 0,
    });
    expect(await restored(other)).toEqual(want);
    expect(await run(other, (m, s: string) => m.db.stops.get(s), t.stop)).toMatchObject({
      notes: 'Edited after restore',
    });
  }
});

test('undecodable photo previews keep the original available to save', async ({ page }) => {
  await page.goto('/');
  // Bytes no browser can decode, labelled JPEG as a damaged file would be; and a real PNG.
  const broken = Buffer.from('a damaged original that no browser can decode');
  const t = await run(
    page,
    async (m, a: { broken: number[]; png: number[] }) => {
      const trip = await m.createTrip('custom');
      const city = await m.addCity(trip, 'Porto', 'EUR');
      const stop = await m.addStop(trip, 'Ribeira', city);
      const target = { tripId: trip, stopId: stop, kind: 'stop' };
      const brokenId = await m.addPhoto(
        new Blob([new Uint8Array(a.broken)], { type: 'image/jpeg' }),
        target,
      );
      await m.addPhoto(new Blob([new Uint8Array(a.png)], { type: 'image/png' }), target);
      const moment = await m.addMoment({
        tripId: trip,
        cityId: city,
        stopId: null,
        title: 'Fado',
        at: 1,
      });
      await m.addPhoto(new Blob([new Uint8Array(a.broken)], { type: 'image/jpeg' }), {
        tripId: trip,
        momentId: moment,
        kind: 'stop',
      });
      await m.updateTrip(trip, {
        coverMode: 'photo',
        coverPhotoId: brokenId,
        journalText: 'A day by the river.',
        status: 'done',
      });
      const photos = await m.db.photos.toArray();
      return { trip, stop, photos: photos.map((p: any) => [p.id, p.blob.type, p.bytes, p.sha256]) };
    },
    { broken: [...broken], png: [...fixture('png')] },
  );
  const savedSha = async (click: () => Promise<void>) => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    return sha(readFileSync((await download.path())!));
  };

  // Stop gallery: an honest badge on the one that can't be shown, none on the PNG.
  await page.goto(`/#/trip/${t.trip}/stops/${t.stop}`);
  const badge = page.getByText('Preview unavailable. Save the original.');
  await expect(badge).toHaveCount(1);
  const views = page.getByRole('button', { name: 'View photo of Ribeira' });
  await views.nth(0).click();
  const viewer = page.locator('dialog[open]');
  await expect(viewer.getByText("This browser can't show this photo.")).toBeVisible();
  expect(
    await savedSha(() => viewer.getByRole('button', { name: 'Save the original' }).click()),
  ).toBe(sha(broken));
  await viewer.getByRole('button', { name: 'Close photo' }).click();
  // A decodable image still opens normally.
  await views.nth(1).click();
  await expect
    .poll(() =>
      viewer.locator('img.photo-full').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(32);
  await viewer.getByRole('button', { name: 'Close photo' }).click();

  // Moment gallery: the same.
  await page.goto(`/#/trip/${t.trip}/stops`);
  await page.getByRole('button', { name: /Fado/ }).click();
  const sheet = page.locator('dialog.modal[open]');
  await expect(sheet.getByText('Preview unavailable. Save the original.')).toHaveCount(1);
  expect(await savedSha(() => sheet.getByRole('button', { name: 'Save photo' }).click())).toBe(
    sha(broken),
  );
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  // The cover falls back to its drawing rather than a broken image.
  await page.goto(`/#/trip/${t.trip}/edit`);
  await expect(page.locator('.trip-cover--cover')).not.toHaveAttribute('data-cover', 'photo');
  // The picker labels the two it can't show, still offers them, and shows the PNG.
  const thumbs = page.getByRole('button', { name: 'Use this photo as the cover' });
  await expect(thumbs).toHaveCount(3);
  await page.locator('.cover-grid').scrollIntoViewIfNeeded(); // thumbnails load lazily
  await expect(page.getByText('No preview in this browser')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.cover-thumb img')
        .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth)),
    )
    .toEqual([32]);
  // A cover upload that can't be stored says so instead of failing silently.
  await run(page, async (m) => {
    m.db.photos.add = () => Promise.reject(new Error('QuotaExceededError'));
  });
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: fixture('png'),
  });
  await expect(page.getByRole('alert')).toHaveText('Cover photo not set: QuotaExceededError');
  await page.reload();

  // The journal says so, keeps the original saveable, and still shows the PNG.
  await page.goto(`/#/trip/${t.trip}/plan`);
  await expect(page.getByText('Preview unavailable in this browser.')).toHaveCount(2);
  expect(
    await savedSha(() => page.getByRole('button', { name: 'Save the original' }).first().click()),
  ).toBe(sha(broken));
  await expect
    .poll(() =>
      page
        .locator('.journal img')
        .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth)),
    )
    .toEqual([32]);

  // Looking changed nothing: every original is as it was.
  expect(
    await run(page, async (m) =>
      (await m.db.photos.toArray()).map((p: any) => [p.id, p.blob.type, p.bytes, p.sha256]),
    ),
  ).toEqual(t.photos);
});

/**
 * The behaviour before this change, kept here only as a negative control: the
 * same expectations below must reject it, or the proof proves nothing.
 */
const BEFORE = {
  // cityIds: one id per name, so a city the trip returns to meant its last leg.
  legOf: (name: string, cities: { id: string; name: string }[]) =>
    new Map(cities.map((c) => [c.name.toLowerCase(), c.id])).get(name.toLowerCase()) ?? null,
  // photoExt: anything not PNG or WebP by its stored type was .jpg.
  ext: (type: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'),
  // revisedStop: plan items were only ever added.
  checklist: (have: string[], next: string[]) => [
    ...have,
    ...next.filter((t) => !have.includes(t)),
  ],
  // addStopNow: the leg of the last saved place, retained or not.
  newLeg: (stops: { cityId: string | null }[]) => stops.at(-1)?.cityId ?? null,
};

test('travel reliability family proof preserves identities and originals across revision restore and sync', async ({
  makeContext,
}) => {
  const nas = new FakeNas();
  const phone = await device(makeContext, nas);
  const bytes = Object.fromEntries(['heic', 'heif', 'png'].map((e) => [e, [...fixture(e)]]));
  const plan0 = [
    '# Vienna',
    '## Route',
    '### Belvedere',
    '- [ ] Find the gate',
    '- [ ] Old cue',
    '# Salzburg',
    '## Route',
    '### Fortress',
    'Funicular',
    '### Cathedral',
    'Domplatz',
    '# Vienna',
    '## Route',
    '### Prater',
    'Wheel',
  ].join('\n');
  const plan1 = [
    '# Vienna',
    '## Route',
    '### Belvedere',
    '- [ ] Find the gate',
    '- [ ] Upper terrace',
    '# Salzburg',
    '## Route',
    '### Fortress',
    'Funicular',
    '# Vienna',
    '## Route',
    '### Prater',
    'Wheel',
  ].join('\n');

  const t = await run(
    phone,
    async (m, a: { plan0: string; plan1: string; b: Record<string, number[]> }) => {
      const trip = await m.createTrip('custom');
      const v1 = await m.addCity(trip, 'Vienna', 'EUR');
      const sb = await m.addCity(trip, 'Salzburg', 'EUR');
      const v2 = await m.addCity(trip, 'Vienna', 'EUR');
      const cities = await m.db.cities.where('tripId').equals(trip).sortBy('order');
      const names = cities.map((c: any) => c.name);
      const stops = () => m.db.stops.where('tripId').equals(trip).sortBy('order');
      await m.db.trips.update(trip, { planText: a.plan0 });
      // 1. Legacy extraction.
      await m.importStopsFromPlan(trip, a.plan0, [], cities);
      const extracted = (await stops()).map((s: any) => [s.name, s.cityId]);
      const id = Object.fromEntries((await stops()).map((s: any) => [s.name, s.id]));
      // The traveller places Belvedere, ticks one cue, adds one of their own.
      await m.updateStop(id.Belvedere, { cityId: v1 });
      const gate = (await m.db.stops.get(id.Belvedere)).checklist[0];
      await m.toggleChecklistItem({ id: id.Belvedere }, gate.id);
      await m.addChecklistItem({ id: id.Belvedere }, 'Old cue');
      // 2. Reviewed revision: Cathedral leaves the route and is kept off it.
      const current = await stops();
      const candidates = m.extractStopsFromPlan(a.plan1, names);
      const matches = m.reviewMatches(candidates, current, cities);
      await m.savePlanRevision(
        await m.db.trips.get(trip),
        a.plan1,
        candidates,
        matches,
        current,
        cities,
      );
      // 3. A place added by hand after the revision, with a retained tail.
      const beforeAdd = await stops();
      id.Hofburg = await m.addStop(
        trip,
        'Hofburg',
        beforeAdd.filter((s: any) => !s.offPlan).at(-1).cityId,
      );
      // 4. Originals: HEIC with no type, HEIF typed JPEG, and a HEIC as an older version stored it.
      const target = { tripId: trip, stopId: id.Belvedere, kind: 'stop' };
      const blob = (e: string, type: string) => new Blob([new Uint8Array(a.b[e])], { type });
      const photo: Record<string, string> = {
        heic: await m.addPhoto(blob('heic', ''), target),
        heif: await m.addPhoto(blob('heif', 'image/jpeg'), target),
        png: await m.addPhoto(blob('png', 'image/png'), target),
        historical: '00000004-0ff1-4000-8000-000000000000',
      };
      await m.db.photos.add({
        id: photo.historical,
        tripId: trip,
        stopId: id.Belvedere,
        expenseId: null,
        kind: 'stop',
        blob: blob('heic', 'image/jpeg'),
        createdAt: 1,
      });
      return {
        trip,
        v1,
        sb,
        v2,
        cities: cities.map((c: any) => ({ id: c.id, name: c.name })),
        extracted,
        beforeAdd: beforeAdd.map((s: any) => ({ cityId: s.cityId })),
        id,
        photo,
      };
    },
    { plan0, plan1, b: bytes },
  );

  // Expected, written out by hand.
  const route = [
    ['Belvedere', t.v1, false],
    ['Fortress', t.sb, false],
    ['Prater', null, false],
    ['Hofburg', null, false],
    ['Cathedral', t.sb, true],
  ];
  const checklist = [
    ['Find the gate', true, true],
    ['Old cue', false, false],
    ['Upper terrace', false, true],
  ];
  const photos = {
    [t.photo.heic]: ['image/heic', HASH.heic, 'heic'],
    [t.photo.heif]: ['image/heif', HASH.heif, 'heif'],
    [t.photo.png]: ['image/png', HASH.png, 'png'],
    [t.photo.historical]: ['image/heic', HASH.heic, 'heic'],
  };
  const extracted = [
    ['Belvedere', null],
    ['Fortress', t.sb],
    ['Cathedral', t.sb],
    ['Prater', null],
  ];

  const state = (page: Page) =>
    run(
      page,
      async (m, trip: string) => {
        const stops = await m.db.stops.where('tripId').equals(trip).sortBy('order');
        const ps = await m.db.photos.where('tripId').equals(trip).toArray();
        return {
          ids: stops.map((s: any) => s.id),
          route: stops.map((s: any) => [s.name, s.cityId, !!s.offPlan]),
          orders: stops.map((s: any) => s.order),
          checklist: stops[0].checklist.map((c: any) => [c.text, c.done, !!c.fromPlan]),
          photos: Object.fromEntries(
            await Promise.all(
              ps.map(async (p: any) => [
                p.id,
                [
                  p.blob.type,
                  await m.sha256Hex(await p.blob.arrayBuffer()),
                  (await m.blobFormat(p.blob)).ext,
                ],
              ]),
            ),
          ),
          links: ps.every((p: any) => p.stopId === stops[0].id),
        };
      },
      t.trip,
    );
  const ids = ['Belvedere', 'Fortress', 'Prater', 'Hofburg', 'Cathedral'].map((n) => t.id[n]);
  const check = (s: Awaited<ReturnType<typeof state>>, typed: boolean) => {
    expect(s.ids).toEqual(ids);
    expect(s.route).toEqual(route);
    expect(s.orders).toEqual([0, 1, 2, 3, 4]);
    expect(s.checklist).toEqual(checklist);
    expect(s.links).toBe(true);
    for (const [pid, [mime, hash, ext]] of Object.entries(photos)) {
      // The historical row keeps the type it had on the device that holds it.
      expect(s.photos[pid]).toEqual([
        typed || pid !== t.photo.historical ? mime : 'image/jpeg',
        hash,
        ext,
      ]);
    }
  };

  expect(t.extracted).toEqual(extracted);
  check(await state(phone), false);

  // Sync to a second device (the receiver serves every photo as PNG).
  expect(await sync(phone)).toMatchObject({ ok: true });
  const mac = await device(makeContext, nas);
  expect(await sync(mac)).toMatchObject({ ok: true });
  check(await state(mac), true);
  for (let i = 0; i < 2; i += 1) {
    expect((await sync(mac)).message).toBe('Up to date.');
    expect((await sync(phone)).message).toBe('Up to date.');
  }

  // A ZIP backup from the phone, restored add-only on a fresh device.
  const zipped = await run(phone, async (m) => [
    ...new Uint8Array(await (await m.buildZipBackup()).arrayBuffer()),
  ]);
  const entries = zipEntries(Buffer.from(zipped));
  for (const [pid, [, hash, ext]] of Object.entries(photos))
    expect(sha(entries.get(`photos/${pid}.${ext}`)!)).toBe(hash);
  const ctx = await makeContext();
  const ipad = ctx.pages()[0] ?? (await ctx.newPage());
  await ipad.goto('/');
  await run(
    ipad,
    async (m, b: number[]) => {
      const { backup, files } = await m.readBackupFile(new Blob([new Uint8Array(b)]));
      return m.importBackup(backup, files);
    },
    zipped,
  );
  check(await state(ipad), true);

  // Negative control: the previous behaviour fails these same expectations.
  expect(
    t.extracted.map(([n]) => [
      n,
      BEFORE.legOf(n === 'Fortress' || n === 'Cathedral' ? 'Salzburg' : 'Vienna', t.cities),
    ]),
  ).not.toEqual(extracted);
  expect(BEFORE.ext('')).not.toBe(photos[t.photo.heic][2]);
  expect(BEFORE.ext('image/jpeg')).not.toBe(photos[t.photo.historical][2]);
  expect(
    BEFORE.checklist(['Find the gate', 'Old cue', 'Old cue'], ['Find the gate', 'Upper terrace']),
  ).not.toEqual(checklist.map(([text]) => text));
  expect(BEFORE.newLeg(t.beforeAdd)).not.toBe(route[3][1]);
});

// The fixed baseline for larger selections (docs/travel-reliability-closure.md):
// 24 photos of 5 MiB and one of 20 MiB through the Stop ingestion path.
// Opt-in — it stores 140 MiB — with SYSTEMA_PHOTO_PROBE=1.
test('photo batch probe: 24 × 5 MiB and 1 × 20 MiB save in order with the page responsive', async ({
  page,
  browserName,
}, info) => {
  test.skip(!process.env.SYSTEMA_PHOTO_PROBE, 'Set SYSTEMA_PHOTO_PROBE=1 to run the probe.');
  test.setTimeout(300_000);
  await page.goto('/');
  const r = await run(page, async (m) => {
    const MiB = 1024 * 1024;
    const files = [...Array(25)].map((_, i) => {
      const size = i === 12 ? 20 * MiB : 5 * MiB;
      const b = new Uint8Array(size);
      b.fill(i + 1);
      b.set(new TextEncoder().encode(`probe-${i}`));
      return new Blob([b], { type: 'image/jpeg' });
    });
    const trip = await m.createTrip('custom');
    const stop = await m.addStop(trip, 'Probe');
    // Concurrent header reads, and the longest the page went without a turn.
    let reads = 0;
    let peakReads = 0;
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, ...args: any[]) {
      const part = slice.apply(this, args as any);
      const read = part.arrayBuffer.bind(part);
      part.arrayBuffer = async () => {
        peakReads = Math.max(peakReads, ++reads);
        try {
          return await read();
        } finally {
          reads -= 1;
        }
      };
      return part;
    } as any;
    let last = performance.now();
    let longest = 0;
    const tick = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 10);
    const start = performance.now();
    const ids = await m.addPhotos(files, { tripId: trip, stopId: stop, kind: 'stop' });
    const ms = performance.now() - start;
    clearInterval(tick);
    Blob.prototype.slice = slice;
    const saved = await m.db.photos.where('stopId').equals(stop).toArray();
    const heap = (performance as any).memory?.usedJSHeapSize;
    return {
      saved: saved.length,
      ids: ids.length,
      bytes: saved.reduce((n: number, p: any) => n + p.bytes, 0),
      inOrder: saved
        .sort((a: any, b: any) => a.createdAt - b.createdAt)
        .every((p: any, i: number) => p.bytes === (i === 12 ? 20 : 5) * MiB),
      ms: Math.round(ms),
      peakHeaderReads: peakReads,
      longestPauseMs: Math.round(longest),
      heapMiB: heap ? Math.round(heap / MiB) : null,
    };
  });
  info.annotations.push({ type: 'probe', description: `${browserName}: ${JSON.stringify(r)}` });
  console.log(`photo probe ${info.project.name}: ${JSON.stringify(r)}`);
  expect(r).toMatchObject({ saved: 25, ids: 25, bytes: 140 * 1024 * 1024, inOrder: true });
});
