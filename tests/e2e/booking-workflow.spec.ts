import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function seed(page: Page, quote = false) {
  await page.goto('/');
  return page.evaluate(async (quote) => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity, updateTrip } = await import('/src/lib/trips.ts');
    const id = await createTrip('same-day');
    await updateTrip(id, {
      outbound: { at: '2027-02-12T08:00', hub: 'STN', tz: 'Europe/London' },
      homeward: {
        transport: 'Train',
        transferAt: '22:30',
        transferArr: '23:15',
        transferRef: 'HOME',
      },
    });
    const cityId = await addCity(id, 'Faro', 'EUR', {
      arrival: '2027-02-12T11:00',
      departure: '2027-02-13T19:00',
      exit: {
        hub: 'FAO',
        ref: 'FLIGHT-HOME',
        transferAt: '16:00',
        transferArr: '16:30',
        transport: 'Train',
      },
    });
    if (quote)
      await db.expenses
        .where('tripId')
        .equals(id)
        .filter((e) => e.need === 'flight:outbound')
        .modify({ quote: { amountGBP: 80 } });
    return { id, cityId };
  }, quote);
}

async function capture(page: Page, name: string) {
  if (test.info().project.name !== 'mobile-safari') return;
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, scale: 'css' });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true }).click();
const sorted = (page: Page) => page.locator('.before-done > summary').click();
const need = (page: Page, label: string) => page.locator('.need', { hasText: label });

for (const direction of ['out', 'home']) {
  test(`reference-first ticket ${direction} confirms booked, then records one payment with no rate`, async ({
    page,
  }) => {
    await page.route('https://api.frankfurter.dev/**', (r) => r.abort());
    const { id } = await seed(page);
    const label = direction === 'out' ? 'Ticket out' : 'Ticket home';
    const key = direction === 'out' ? 'flight:outbound' : 'flight:inbound';
    // The homeward flight in the seed starts reserved; exercise an unreserved ticket here.
    if (direction === 'home')
      await page.evaluate(async () => {
        const { db } = await import('/src/lib/db.ts');
        const city = await db.cities.toCollection().first();
        await db.cities.update(city!.id, { exit: { ...city!.exit, ref: undefined } });
      });
    await page.goto(`/#/trip/${id}/plan`);
    await need(page, label).getByRole('button').click();
    await page.getByLabel('Paid in', { exact: true }).selectOption('EUR');
    await page.getByLabel('Booking reference', { exact: true }).fill('REF-FIRST');
    await save(page);
    await expect(page.getByRole('status')).toHaveText(`${label}: booked.`);
    await sorted(page);
    await need(page, label).scrollIntoViewIfNeeded();
    await capture(page, `02-reference-${direction}`);
    await expect(need(page, label)).toContainText('Booking REF-FIRST');
    await need(page, label).getByRole('button').click();
    await expect(page.getByRole('dialog', { name: label })).toBeVisible();
    await expect(page.getByLabel('Booking reference', { exact: true })).toHaveValue('REF-FIRST');
    await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('');
    await page.getByLabel('Paid in', { exact: true }).selectOption('EUR');
    await page.getByLabel('What it cost, for everyone').fill('100');
    await save(page);
    await expect(page.getByRole('status')).toContainText(
      'paid, saved in Expenses with GBP still awaiting a rate',
    );
    const result = await page.evaluate(
      async ({ id, key }) => {
        const { db } = await import('/src/lib/db.ts');
        const { tripNeeds } = await import('/src/lib/needs.ts');
        const rows = await db.expenses.where('tripId').equals(id).toArray();
        return {
          rows: rows.filter((e) => e.need === key),
          state: tripNeeds((await db.trips.get(id))!, await db.cities.toArray(), rows, []).find(
            (n) => n.key === key,
          )!.state,
        };
      },
      { id, key },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      amountGBP: 0,
      amountLocal: 100,
      fxPending: true,
      skeleton: false,
      notes: 'Booking REF-FIRST',
    });
    expect(result.state).toBe('paid');
    await page.getByRole('link', { name: 'Expenses', exact: true }).click();
    await expect(
      page.locator('.expense-list .expense-row:not(.expense-row--skeleton)'),
    ).toHaveCount(1);
    await expect(page.getByText('1 unpriced expense excluded.', { exact: false })).toBeVisible();
  });
}

test('departure details prefill Price it; return tickets keep their two timetables through payment and editing', async ({
  page,
}) => {
  const { id } = await seed(page);
  await page.goto(`/#/trip/${id}/edit`);
  await page.getByRole('button', { name: /Flight out ·/ }).click();
  await page.getByLabel('By', { exact: true }).fill('National Express');
  await page.getByLabel('It leaves at').fill('04:00');
  await page.getByLabel('…and arrives', { exact: true }).fill('05:00');
  await page.getByLabel('Transfer booking ref').fill('COACH-RETURN');
  await save(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await sorted(page);
  await need(page, 'Getting to STN').getByRole('button').click();
  await expect(page.getByLabel('How you get there')).toHaveValue('National Express');
  await capture(page, '03-transport-prefill');
  await expect(page.getByLabel('It leaves at')).toHaveValue('04:00');
  await expect(page.getByLabel('…and arrives', { exact: true })).toHaveValue('05:00');
  await expect(page.getByLabel('Booking reference', { exact: true })).toHaveValue('COACH-RETURN');
  await page.getByLabel('The same ticket covers the way back.', { exact: false }).check();
  await page.getByLabel('What it cost, for everyone').fill('22');
  await save(page);
  await expect(need(page, 'Getting to STN')).toContainText('£22');
  await need(page, 'Getting to STN').getByRole('button').click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('22');
  await expect(
    page.getByLabel('The same ticket covers the way back.', { exact: false }),
  ).toBeChecked();
  await page.getByLabel('What it cost, for everyone').fill('24');
  await page.getByLabel('…and arrives', { exact: true }).fill('');
  await save(page);
  const result = await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    return {
      trip: await db.trips.get(id),
      rows: await db.expenses
        .where('tripId')
        .equals(id)
        .filter((e) => !e.skeleton)
        .toArray(),
    };
  }, id);
  expect(result.trip!.outbound).toMatchObject({
    transport: 'National Express',
    transferAt: '04:00',
    transferRef: 'COACH-RETURN',
  });
  expect(result.trip!.outbound!.transferArr).toBeUndefined();
  expect(result.trip!.homeward).toMatchObject({
    transport: 'Train',
    transferAt: '22:30',
    transferArr: '23:15',
    transferRef: 'HOME',
    coveredBy: 'transfer-uk:out',
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    amountGBP: 24,
    description: 'Airport transfer (UK) (Return)',
  });
  // Editing the covered journey opens the original ticket, preventing a second payment.
  await need(page, 'Getting home from the airport').getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Getting to STN' })).toBeVisible();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('24');
  await page.getByLabel('The same ticket covers the way back.', { exact: false }).uncheck();
  await save(page);
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import('/src/lib/db.ts');
      return (await db.trips.get(id))!.homeward!.coveredBy;
    }, id),
  ).toBeUndefined();
});

test('Expenses offers the quote, keeps a reference-only save unpaid, and purchases into the same row', async ({
  page,
}) => {
  const { id } = await seed(page, true);
  await page.goto(`/#/trip/${id}/expenses`);
  const row = page.locator('.expense-row', { hasText: 'Outbound flight' });
  await expect(row).toContainText('quoted £80.00');
  await row.click();
  await expect(page.getByRole('dialog', { name: 'Ticket out' })).toBeVisible();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('80');
  await expect(page.getByLabel('Record this amount as paid')).not.toBeChecked();
  await capture(page, '04-quote-ready-to-purchase');
  await page.getByLabel('Booking reference', { exact: true }).fill('QUOTED-REF');
  await save(page);
  await expect(page.getByRole('status')).toHaveText('Ticket out: booked.');
  await expect(row).toHaveClass(/skeleton/);
  await expect(page.locator('.total-value')).toHaveText('£0.00');
  await row.click();
  await page.getByLabel('Paid in', { exact: true }).selectOption('JOD');
  await page.getByLabel('What it cost, for everyone').fill('95');
  await page.getByLabel('Amount (GBP)', { exact: true }).fill('100');
  await page.getByLabel('Record this amount as paid').uncheck();
  await save(page);
  await expect(page.locator('.total-value')).toHaveText('£0.00');
  await expect(row).toHaveClass(/skeleton/);
  await row.click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('80');
  await expect(page.getByLabel('Booking reference', { exact: true })).toHaveValue('QUOTED-REF');
  await page.getByLabel('Record this amount as paid').check();
  await save(page);
  await expect(page.locator('.total-value')).toHaveText('£80.00');
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await sorted(page);
  await need(page, 'Ticket out').getByRole('button').click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('80');
  await page.getByLabel('What it cost, for everyone').fill('83');
  await save(page);
  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(row).not.toHaveClass(/skeleton/);
  await expect(page.locator('.total-value')).toHaveText('£83.00');
  await capture(page, '05-purchased-once');
  await expect(page.locator('.expense-row', { hasText: 'Outbound flight' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await sorted(page);
  await need(page, 'Ticket out').getByRole('button').click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('83');
  await expect(page.getByLabel('Booking reference', { exact: true })).toHaveValue('QUOTED-REF');
});

test('a reference cannot claim to save a ticket home without a destination leg', async ({
  page,
}) => {
  await page.goto('/');
  const id = await page.evaluate(async () =>
    (await import('/src/lib/trips.ts')).createTrip('custom'),
  );
  await page.goto(`/#/trip/${id}/plan`);
  await need(page, 'Ticket home').getByRole('button').click();
  await page.getByLabel('Booking reference', { exact: true }).fill('NO-HOME-LEG');
  await save(page);
  await expect(page.getByRole('alert')).toContainText(
    'Add the city you fly home from in Edit trip first',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Booking reference', { exact: true })).toHaveValue('NO-HOME-LEG');
  expect(
    await page.evaluate(async () => (await import('/src/lib/db.ts')).db.expenses.count()),
  ).toBe(0);
});

test('Edit trip keeps bottom fields clear of a reduced and panned visual viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const { id } = await seed(page);
  await page.goto(`/#/trip/${id}/edit`);
  await page.getByLabel('Custom name (optional)').focus();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 300 },
      offsetTop: { configurable: true, value: 0 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const fieldBottom = () =>
    page.getByLabel('Custom name (optional)').evaluate((el) => el.getBoundingClientRect().bottom);
  await expect.poll(fieldBottom).toBeLessThanOrEqual(276);
  await capture(page, '01-edit-trip-reduced-viewport');
  // Safari can pan after resize without another resize event.
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 260 },
      offsetTop: { configurable: true, value: 250 },
    });
    window.visualViewport!.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() =>
      page.getByLabel('Custom name (optional)').evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(274);
  await expect.poll(fieldBottom).toBeLessThanOrEqual(486);
  await page.getByLabel('Custom name (optional)').fill('Keyboard journey');
  await page.getByLabel('Status', { exact: true }).focus();
  await expect
    .poll(() =>
      page
        .getByLabel('Status', { exact: true })
        .evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(486);
  await page.getByLabel('Status', { exact: true }).blur();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: window.innerHeight },
      offsetTop: { configurable: true, value: 0 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('header.topbar')).toContainText('Keyboard journey');
});

test('money-only edits preserve a reserved return, and legacy payments are updated rather than duplicated', async ({
  page,
}) => {
  const { id, cityId } = await seed(page);
  const result = await page.evaluate(
    async ({ id, cityId }) => {
      const { db } = await import('/src/lib/db.ts');
      const { tripNeeds, bookNeed } = await import('/src/lib/needs.ts');
      const trip = (await db.trips.get(id))!;
      const needs = async () =>
        tripNeeds(
          (await db.trips.get(id))!,
          await db.cities.where('tripId').equals(id).toArray(),
          await db.expenses.where('tripId').equals(id).toArray(),
          [],
        );
      const key = `transfer-in:${cityId}`;
      await bookNeed(trip, (await needs()).find((n) => n.key === key)!, {
        amountGBP: 0,
        ref: 'RESERVED-RETURN',
        bothWays: true,
        transport: 'Bus',
        transferAt: '11:30',
        transferArr: '12:00',
      });
      const first = await bookNeed(trip, (await needs()).find((n) => n.key === key)!, {
        amountGBP: 12,
      });
      await db.expenses.update(first.expenseId!, {
        description: 'My return bus ticket',
        notes: 'Keep my note · Booking RESERVED-RETURN',
        date: '2026-10-01',
      });
      await bookNeed(trip, (await needs()).find((n) => n.key === key)!, { amountGBP: 14 });
      await bookNeed(trip, (await needs()).find((n) => n.key === key)!, {
        amountGBP: 0,
        ref: 'UPDATED-RETURN',
      });
      const city = await db.cities.get(cityId);
      const row = await db.expenses.get(first.expenseId!);
      // A legacy manually entered flight payment already settles the need.
      const flight = (await needs()).find((n) => n.key === 'flight:outbound')!;
      const old = await db.expenses
        .where('tripId')
        .equals(id)
        .filter((e) => e.need === flight.key)
        .first();
      await db.expenses.update(old!.id, {
        need: undefined,
        skeleton: false,
        amountGBP: 50,
        // A reference this trip no longer carries anywhere structured: an
        // older backup, or one changed in the departure editor since.
        notes: 'Personal note · Booking OLD-FLIGHT',
        currency: 'GBP',
        date: '2026-10-02',
      });
      const updated = await bookNeed(trip, flight, { amountGBP: 55, ref: 'LEGACY-FLIGHT' });
      return {
        city,
        row,
        legacyNotes: (await db.expenses.get(old!.id))!.notes,
        covered: (await needs()).find((n) => n.key === `transfer-out:${cityId}`)!.done,
        reused: updated.expenseId === old!.id,
        flightRows: await db.expenses
          .where('tripId')
          .equals(id)
          .filter((e) => e.subcategory === 'Flight')
          .count(),
      };
    },
    { id, cityId },
  );
  expect(result.city!.entry).toMatchObject({
    transport: 'Bus',
    transferAt: '11:30',
    transferArr: '12:00',
    transferRef: 'UPDATED-RETURN',
  });
  expect(result.city!.exit).toMatchObject({
    transport: 'Train',
    transferAt: '16:00',
    transferArr: '16:30',
    ref: 'FLIGHT-HOME',
    coveredBy: `transfer-in:${cityId}`,
  });
  expect(result.row).toMatchObject({
    amountGBP: 14,
    description: 'My return bus ticket',
    notes: 'Keep my note · Booking UPDATED-RETURN',
    date: '2026-10-01',
  });
  expect(result.covered).toBe(true);
  expect(result.reused).toBe(true);
  expect(result.flightRows).toBe(2);
  // One booking line, and the author's own note still there.
  expect(result.legacyNotes).toBe('Personal note · Booking LEGACY-FLIGHT');
});

test('Opportunity mutations advance sync timestamps and country determines an ambiguous city currency', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { createOpportunity, putOption, removeOption, addFinderRows, chooseOption } =
      await import('/src/lib/opportunities.ts');
    const tripId = await createTrip('custom');
    await addCity(tripId, 'Tripoli', 'EUR');
    const id = await createOpportunity('Tripoli', 'Lebanon');
    const option = {
      id: 'fare',
      outDate: '2027-03-01',
      backDate: '2027-03-01',
      outRoute: ['STN', 'BEY'],
      backRoute: ['BEY', 'STN'],
      outFarePP: 30,
      backFarePP: 35,
      paidNights: 0,
      source: 'manual' as const,
    };
    const timestamps: number[] = [];
    await db.opportunities.update(id, { updatedAt: 1 });
    await putOption(id, option);
    timestamps.push((await db.opportunities.get(id))!.updatedAt!);
    await db.opportunities.update(id, { updatedAt: 1 });
    await removeOption(id, option.id);
    timestamps.push((await db.opportunities.get(id))!.updatedAt!);
    await db.opportunities.update(id, { updatedAt: 1 });
    await addFinderRows([{ city: 'Tripoli', country: 'Lebanon', option }]);
    const opp = (await db.opportunities.get(id))!;
    timestamps.push(opp.updatedAt!);
    const chosen = await chooseOption(opp, opp.options[0]);
    const currency = (await db.cities.where('tripId').equals(chosen.tripId).first())!.currency;
    return { timestamps, currency, toFill: chosen.toFill };
  });
  expect(result.timestamps.every((t) => t > 1)).toBe(true);
  // Lebanon is not in the currency table: ask for it, rather than inherit another Tripoli's euro.
  expect(result.currency).toBe('');
  expect(result.toFill).toContain('the currency for Tripoli');
});

test('a planned destination never becomes an asserted previous visit in the research prompt', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as any).copiedPrompt = text;
          return Promise.resolve();
        },
      },
    }),
  );
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createTrip, addCity, updateTrip } = await import('/src/lib/trips.ts');
    const { createOpportunity } = await import('/src/lib/opportunities.ts');
    const id = await createOpportunity('Faro', 'Portugal');
    const tripId = await createTrip('custom');
    await updateTrip(tripId, { opportunityId: id });
    await addCity(tripId, 'Faro', 'EUR');
    return id;
  });
  await page.goto(`/#/opp/${id}`);
  await page.getByRole('button', { name: 'Copy a prompt' }).click();
  const prompt = await page.evaluate(() => (window as any).copiedPrompt as string);
  expect(prompt).toContain('Do not assume this is my first visit');
  expect(prompt).not.toContain('I have been to Faro before');
  await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    await db.trips.toCollection().modify({ status: 'done' });
  });
  await expect
    .poll(async () => {
      await page.getByRole('button', { name: 'Copy a prompt' }).click();
      return page.evaluate(() => (window as any).copiedPrompt as string);
    })
    .toContain('I have been to Faro before');
});

test('editing a legacy transfer keeps its reference out of the flight slot when restamping its payment', async ({
  page,
}) => {
  const { id, cityId } = await seed(page);
  const result = await page.evaluate(
    async ({ id, cityId }) => {
      const { db } = await import('/src/lib/db.ts');
      const { tripNeeds, bookNeed, bookingDetails } = await import('/src/lib/needs.ts');
      const { addExpense } = await import('/src/lib/expenses.ts');
      await db.cities.update(cityId, { exit: { ref: 'OLD-COACH', hub: 'FAO', transport: 'Bus' } });
      const expenseId = await addExpense(id, {
        cityId,
        destination: 'Faro',
        date: '2026-10-01',
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: 'Airport transfer',
        amountGBP: 10,
        amountLocal: 0,
        currency: 'GBP',
        paymentMethod: 'Card Payment',
        fxRate: null,
        notes: 'Booking OLD-COACH',
      });
      await db.expenses.update(expenseId, { need: `transfer:${cityId}` });
      const trip = (await db.trips.get(id))!;
      const cities = await db.cities.where('tripId').equals(id).toArray();
      const rows = await db.expenses.where('tripId').equals(id).toArray();
      const need = tripNeeds(trip, cities, rows, []).find(
        (n) => n.key === `transfer-out:${cityId}`,
      )!;
      const ref = bookingDetails(trip, need, cities, [], rows).ref;
      const updated = await bookNeed(trip, need, { amountGBP: 12 });
      const after = tripNeeds(
        (await db.trips.get(id))!,
        await db.cities.where('tripId').equals(id).toArray(),
        await db.expenses.where('tripId').equals(id).toArray(),
        [],
      );
      return {
        ref,
        reused: updated.expenseId === expenseId,
        exit: (await db.cities.get(cityId))!.exit,
        flight: after.find((n) => n.key === 'flight:inbound')!.state,
        transfer: updated.need.state,
      };
    },
    { id, cityId },
  );
  expect(result).toMatchObject({
    ref: 'OLD-COACH',
    reused: true,
    transfer: 'paid',
    flight: 'open',
    exit: { transferRef: 'OLD-COACH', transport: 'Bus', hub: 'FAO' },
  });
  expect(result.exit!.ref).toBeUndefined();
});

test('a reference-only quote sheet never overwrites a payment arriving from sync', async ({
  page,
}) => {
  const { id } = await seed(page, true);
  await page.goto(`/#/trip/${id}/expenses`);
  await page.locator('.expense-row', { hasText: 'Outbound flight' }).click();
  await expect(page.getByLabel('Record this amount as paid')).not.toBeChecked();
  await page.getByLabel('Booking reference', { exact: true }).fill('AFTER-SYNC');
  await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    await db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.need === 'flight:outbound')
      .modify({
        skeleton: false,
        amountGBP: 91,
        currency: 'GBP',
        date: '2026-10-01',
        quote: { amountGBP: 81 },
      });
  }, id);
  // Saying the payment arrived proves the live query has observed the synced
  // row, and the sheet stops offering a quote that has been overtaken.
  await expect(page.getByRole('status')).toContainText('A payment of £91.00 was recorded');
  await expect(page.getByText(/Quote: £81.00/)).toBeHidden();
  await expect(page.getByLabel('Record this amount as paid')).not.toBeChecked();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('80');
  await save(page);
  await expect(page.getByRole('status')).toHaveText('Ticket out: paid.');
  await expect(page.locator('.total-value')).toHaveText('£91.00');
  const rows = await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    return db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.need === 'flight:outbound')
      .toArray();
  }, id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amountGBP: 91, date: '2026-10-01', notes: 'Booking AFTER-SYNC' });
});

test('a hand-typed GBP conversion stays on screen and editable once a rate exists', async ({
  page,
}) => {
  // The rate for the payment date is available: £85 was still typed by hand.
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({ json: { date: '2026-10-01', rates: { GBP: 0.9 } } }),
  );
  const { id } = await seed(page);
  await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    await db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.need === 'flight:outbound')
      .modify({
        skeleton: false,
        currency: 'EUR',
        amountLocal: 100,
        amountGBP: 85,
        fxRate: null,
        gbpManual: true,
        date: '2026-10-01',
      });
  }, id);
  await page.goto(`/#/trip/${id}/plan`);
  await sorted(page);
  await need(page, 'Ticket out').getByRole('button', { name: 'Ticket out: Edit' }).click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('100');
  // The label says "override" only once a rate is in hand, so finding it this
  // way proves the figure is deciding the row against an available rate.
  const override = page.getByLabel('Amount (GBP) override', { exact: true });
  await expect(override).toHaveValue('85');
  await page.getByLabel('What it cost, for everyone').fill('200');
  await expect(override).toHaveValue('85');
  await expect(page.getByText(/at the rate for the payment date/)).toBeHidden();
  await capture(page, '11-manual-gbp-visible');
  await override.fill('');
  await expect(page.getByText('About £180.00 at the rate for the payment date.')).toBeVisible();
  await save(page);
  const row = await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    return (
      await db.expenses
        .where('tripId')
        .equals(id)
        .filter((e) => e.need === 'flight:outbound')
        .toArray()
    )[0];
  }, id);
  expect(row).toMatchObject({
    amountGBP: 180,
    amountLocal: 200,
    currency: 'EUR',
    fxRate: 0.9,
    gbpManual: false,
  });
});

test('a confirmed quote never replaces a payment that arrived while the sheet was open', async ({
  page,
}) => {
  const { id } = await seed(page, true);
  await page.goto(`/#/trip/${id}/expenses`);
  await page.locator('.expense-row', { hasText: 'Outbound flight' }).click();
  await page.getByLabel('Record this amount as paid').check();
  await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    await db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.need === 'flight:outbound')
      .modify({ skeleton: false, amountGBP: 91, currency: 'GBP', date: '2026-10-01' });
  }, id);
  await expect(page.getByRole('alert')).toContainText('£91.00');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.total-value')).toHaveText('£91.00');
});
