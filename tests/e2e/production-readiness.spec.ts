import { test, expect } from './fixtures';

// Synthetic trips in fresh contexts only, including deliberate write failures.
test.beforeEach(async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({
      json: { date: '2026-11-04', rates: { GBP: 0.85 } },
    }),
  );
  await page.goto('/');
});

test('return ticket keeps each timetable and follows its payment through edits and deletion', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const { updateExpense, deleteExpense } = await import('/src/lib/expenses.ts');
    const id = await createTrip('custom');
    const cityId = await addCity(id, 'Faro', 'EUR', {
      arrival: '2027-02-12T09:00',
      departure: '2027-02-13T19:00',
      exit: { transport: 'Train', transferAt: '16:00', transferArr: '16:30' },
    });
    const trip = (await db.trips.get(id))!;
    const needs = async () =>
      tripNeeds(
        (await db.trips.get(id))!,
        await db.cities.where('tripId').equals(id).toArray(),
        await db.expenses.where('tripId').equals(id).toArray(),
        [],
      );
    const key = `transfer-in:${cityId}`;
    const backKey = `transfer-out:${cityId}`;
    const book = async (ref?: string) =>
      bookNeed(trip, (await needs()).find((n) => n.key === key)!, {
        amountGBP: 12,
        bothWays: true,
        transport: 'Bus',
        transferAt: '09:30',
        transferArr: '10:00',
        ref,
      });
    const { expenseId } = await book();
    const after = await db.cities.get(cityId);
    const initiallyCovered = (await needs()).find((n) => n.key === backKey)!.done;
    await updateExpense(expenseId!, { description: 'Return ticket with my note', amountGBP: 14 });
    const stillCovered = (await needs()).find((n) => n.key === backKey)!.done;
    await updateExpense(expenseId!, { category: 'Food' });
    const moved = await db.expenses.get(expenseId!);
    const afterReclassify = (await needs()).find((n) => n.key === backKey)!.done;
    const second = await book();
    await deleteExpense(second.expenseId!);
    const afterDelete = (await needs()).find((n) => n.key === backKey)!.done;
    const reserved = await book('RETURN-REF');
    await deleteExpense(reserved.expenseId!);
    const reservedNeeds = await needs();
    return {
      entry: after!.entry,
      exit: after!.exit,
      initiallyCovered,
      stillCovered,
      detached: !moved!.need,
      afterReclassify,
      afterDelete,
      reservationKept: reservedNeeds.find((n) => n.key === key)!.state,
      returnReservationKept: reservedNeeds.find((n) => n.key === backKey)!.done,
    };
  });
  expect(result.entry).toMatchObject({
    transport: 'Bus',
    transferAt: '09:30',
    transferArr: '10:00',
  });
  expect(result.exit).toMatchObject({
    transport: 'Train',
    transferAt: '16:00',
    transferArr: '16:30',
  });
  expect(result).toMatchObject({
    initiallyCovered: true,
    stillCovered: true,
    detached: true,
    afterReclassify: false,
    afterDelete: false,
    reservationKept: 'booked',
    returnReservationKept: true,
  });
});

test('UK return ticket shares coverage without copying times, including a money-only purchase', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip } = await import('/src/lib/trips.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const id = await createTrip('custom');
    await db.trips.update(id, {
      outbound: { transport: 'Coach', transferAt: '04:00', transferArr: '05:00' },
      homeward: { transport: 'Train', transferAt: '22:00', transferArr: '23:00' },
    });
    const old = (await db.trips.get(id))!;
    const need = tripNeeds(old, [], [], []).find((n) => n.key === 'transfer-uk:back')!;
    await bookNeed(old, need, { amountGBP: 22, bothWays: true });
    const trip = (await db.trips.get(id))!;
    const expenses = await db.expenses.where('tripId').equals(id).toArray();
    return {
      outbound: trip.outbound,
      homeward: trip.homeward,
      done: tripNeeds(trip, [], expenses, []).find((n) => n.key === 'transfer-uk:out')!.done,
    };
  });
  expect(result.outbound).toMatchObject({
    transferAt: '04:00',
    transferArr: '05:00',
    coveredBy: 'transfer-uk:back',
  });
  expect(result.homeward).toMatchObject({ transferAt: '22:00', transferArr: '23:00' });
  expect(result.done).toBe(true);
});

test('a failed expense write rolls back booking references, stop reservations and journey coverage', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { addStop } = await import('/src/lib/stops.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const id = await createTrip('custom');
    const cityId = await addCity(id, 'Faro', 'EUR', {
      arrival: '2027-02-12T09:00',
      sleep: 'hotel',
    });
    const stopId = await addStop(id, 'Museum');
    await db.stops.update(stopId, { bookAhead: 'Reserve a time' });
    const before = JSON.stringify({
      trip: await db.trips.get(id),
      city: await db.cities.get(cityId),
      stop: await db.stops.get(stopId),
    });
    const fail = () => {
      throw new Error('Synthetic disk full');
    };
    db.expenses.hook('creating', fail);
    let failures = 0;
    try {
      for (const key of [
        'flight:outbound',
        `hotel:${cityId}`,
        `book:${stopId}`,
        `transfer-in:${cityId}`,
      ]) {
        const trip = (await db.trips.get(id))!;
        const needs = tripNeeds(trip, await db.cities.toArray(), [], await db.stops.toArray());
        try {
          await bookNeed(trip, needs.find((n) => n.key === key)!, {
            amountGBP: 12,
            ref: 'SHOULD-ROLL-BACK',
            place: 'Hotel',
            bothWays: true,
            transport: 'Bus',
            transferAt: '09:30',
            transferArr: '10:00',
          });
        } catch {
          failures++;
        }
      }
    } finally {
      db.expenses.hook('creating').unsubscribe(fail);
    }
    const after = JSON.stringify({
      trip: await db.trips.get(id),
      city: await db.cities.get(cityId),
      stop: await db.stops.get(stopId),
    });
    return { failures, unchanged: before === after, expenses: await db.expenses.count() };
  });
  expect(result).toEqual({ failures: 4, unchanged: true, expenses: 0 });
});

test('booking currency clears the pound quote and uses the chosen payment date', async ({
  page,
}) => {
  const id = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const id = await createTrip('same-day');
    await addCity(id, 'Faro', 'EUR', {
      arrival: '2027-02-12T09:00',
      departure: '2027-02-12T19:00',
    });
    await db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.description === 'Outbound flight')
      .modify({ need: 'flight:outbound', quote: { amountGBP: 80 } });
    return id;
  });
  await page.goto(`/#/trip/${id}/plan`);
  await page.locator('.need', { hasText: 'Ticket out' }).getByRole('button').click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('80');
  await page.getByLabel('Paid in', { exact: true }).selectOption('EUR');
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('');
  await page.getByLabel('What it cost, for everyone').fill('100');
  await page.getByLabel('Paid on', { exact: true }).fill('2026-10-01');
  await expect(page.getByText('About £85.00 at the rate for the payment date.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const row = await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    return db.expenses
      .where('tripId')
      .equals(id)
      .filter((e) => e.need === 'flight:outbound')
      .first();
  }, id);
  expect(row).toMatchObject({
    amountLocal: 100,
    amountGBP: 85,
    currency: 'EUR',
    date: '2026-10-01',
  });
});

test('unsupported-currency Expenses require a visible GBP amount and retain the saved money', async ({
  page,
}) => {
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const id = await createTrip('custom');
    await addCity(id, 'Amman', 'JOD');
    return id;
  });
  await page.goto(`/#/trip/${id}/expenses`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Museum', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByLabel('Amount (GBP)', { exact: true }).fill('13.5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.expense-row')).toContainText('£13.50');
});

test('an unsupported currency cannot be settled with a zero pound conversion', async ({ page }) => {
  const id = await page.evaluate(async () => {
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const id = await createTrip('custom');
    await addCity(id, 'Amman', 'JOD');
    return id;
  });
  await page.goto(`/#/trip/${id}/expenses`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Museum', exact: true }).click();
  const gbp = page.getByLabel('Amount (GBP)', { exact: true });
  await gbp.fill('0');
  await expect(page.getByRole('alert')).toContainText('out of every total');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await gbp.fill('13.5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.expense-row')).toContainText('£13.50');
});

for (const width of [375, 390]) {
  test(`Leaving home fields align and late arrival warns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
    const id = await page.evaluate(async () => {
      const { db } = await import('/src/lib/db.ts');
      const { createTrip } = await import('/src/lib/trips.ts');
      const id = await createTrip('custom');
      await db.trips.update(id, {
        outbound: {
          at: '2027-02-12T06:30',
          tz: 'Europe/London',
          hub: 'London Stansted Airport',
          transport: 'Coach',
          transferAt: '05:10',
          transferArr: '06:45',
        },
      });
      return id;
    });
    await page.goto(`/#/trip/${id}/edit`);
    await page.getByRole('button', { name: /Flight out ·/ }).click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByRole('alert')).toContainText('arrives at or after the departure');
    for (const grid of await dialog.locator('.dep-grid').all()) {
      const fields = await grid.locator('input').all();
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const a = (await fields[i].boundingBox())!;
        const b = (await fields[i + 1].boundingBox())!;
        expect(Math.abs(a.y - b.y)).toBeLessThan(1);
        expect(a.height).toBeGreaterThanOrEqual(44);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    }
    expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
    // The same shared sheet remains scrollable with simulated keyboard clearance.
    await page.evaluate(() => document.documentElement.style.setProperty('--kb', '300px'));
    await page.getByLabel('Notes', { exact: true }).fill('Synthetic gate note');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

test('changed Finder accommodation and airports recalculate costs, while unknown accommodation cannot become no hotel', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createOpportunity, putOption, chooseOption } =
      await import('/src/lib/opportunities.ts');
    const { priceOption } = await import('/src/lib/options.ts');
    const id = await createOpportunity('Faro', 'Portugal');
    const option = {
      id: 'synthetic-option',
      outDate: '2027-02-12',
      backDate: '2027-02-13',
      outRoute: ['LTN', 'FAO'],
      backRoute: ['FAO', 'LTN'],
      outFarePP: 20,
      backFarePP: 30,
      paidNights: 1,
      overnight: 'Hotel ×1',
      finderPP: 100,
      usableH: 20,
    };
    await putOption(id, option);
    await putOption(id, {
      ...option,
      paidNights: 3,
      overnight: 'Hotel ×3',
      outRoute: ['STN', 'FAO'],
    });
    const edited = (await db.opportunities.get(id))!.options[0];
    const facts = { ukTransfer: {}, destTransfer: {}, hotelNight: null, partySize: 2 };
    const price = priceOption(edited, facts, 'Faro');
    const undecided = { ...edited, paidNights: undefined, overnight: undefined };
    let refused = false;
    try {
      await chooseOption((await db.opportunities.get(id))!, undecided);
    } catch {
      refused = true;
    }
    return { edited, total: price.totalPP, refused, trips: await db.trips.count() };
  });
  expect(result.edited.finderPP).toBeUndefined();
  expect(result.edited.usableH).toBeUndefined();
  expect(result.total).toBeGreaterThan(150);
  expect(result.refused).toBe(true);
  expect(result.trips).toBe(0);
});

// An option that names its night in words but has no night count is not
// undecided, and opening its editor must not turn those words into nothing.
test('editing an option that names its hotel night keeps the night and the cost', async ({
  page,
}) => {
  const oppId = await page.evaluate(async () => {
    const { createOpportunity, putOption } = await import('/src/lib/opportunities.ts');
    const id = await createOpportunity('Faro', 'Portugal');
    await putOption(id, {
      id: 'named-night',
      source: 'manual',
      outDate: '2027-02-12',
      backDate: '2027-02-13',
      outRoute: ['LTN', 'FAO'],
      backRoute: ['FAO', 'LTN'],
      outDep: '07:00',
      outArr: '09:50',
      backDep: '18:00',
      backArr: '20:50',
      outFarePP: 20,
      backFarePP: 30,
      overnight: 'Hotel ×1',
    });
    return id;
  });
  await page.goto(`/#/opp/${oppId}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const saved = await page.evaluate(async (id) => {
    const { db } = await import('/src/lib/db.ts');
    const { accommodationUndecided } = await import('/src/lib/options.ts');
    const o = (await db.opportunities.get(id))!.options[0];
    return { overnight: o.overnight, nights: o.paidNights, undecided: accommodationUndecided(o) };
  }, oppId);
  expect(saved).toEqual({ overnight: 'Hotel ×1', nights: 1, undecided: false });
});

test('an option with no cost is never labelled the best one', async ({ page }) => {
  const oppId = await page.evaluate(async () => {
    const { createOpportunity, putOption } = await import('/src/lib/opportunities.ts');
    const id = await createOpportunity('Faro', 'Portugal');
    const base = {
      outRoute: ['LTN', 'FAO'],
      backRoute: ['FAO', 'LTN'],
      outDep: '07:00',
      outArr: '09:50',
      backDep: '18:00',
      backArr: '20:50',
      outFarePP: 20,
      backFarePP: 30,
    };
    await putOption(id, {
      ...base,
      id: 'priced',
      outDate: '2027-02-12',
      backDate: '2027-02-13',
      paidNights: 1,
      overnight: 'Hotel ×1',
      finderPP: 100,
    });
    await putOption(id, {
      ...base,
      id: 'undecided',
      source: 'manual',
      outDate: '2027-03-12',
      backDate: '2027-03-13',
    });
    return id;
  });
  await page.goto(`/#/opp/${oppId}`);
  const cards = page.locator('.opt');
  await expect(cards).toHaveCount(2);
  const undecided = cards.filter({ hasText: 'Overnight accommodation has not been decided' });
  await expect(undecided).toHaveCount(1);
  await expect(undecided).not.toContainText('using these estimates');
  await expect(undecided.getByRole('button', { name: 'Choose this' })).toBeDisabled();
});

test('choosing a trip rolls back all new rows when a leg cannot be written', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createOpportunity, chooseOption } = await import('/src/lib/opportunities.ts');
    const id = await createOpportunity('Faro', 'Portugal');
    const fail = () => {
      throw new Error('Synthetic disk full');
    };
    db.cities.hook('creating', fail);
    let refused = false;
    try {
      await chooseOption((await db.opportunities.get(id))!, {
        id: 'synthetic-option',
        outDate: '2027-02-12',
        backDate: '2027-02-12',
        outRoute: ['LTN', 'FAO'],
        backRoute: ['FAO', 'LTN'],
        outFarePP: 20,
        backFarePP: 30,
      });
    } catch {
      refused = true;
    } finally {
      db.cities.hook('creating').unsubscribe(fail);
    }
    return {
      refused,
      trips: await db.trips.count(),
      expenses: await db.expenses.count(),
      opportunities: await db.opportunities.count(),
    };
  });
  expect(result).toEqual({ refused: true, trips: 0, expenses: 0, opportunities: 1 });
});

test('booking keeps concurrent trip edits and never consumes another need’s placeholder', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const id = await createTrip('same-day');
    const cityId = await addCity(id, 'Faro', 'EUR', { arrival: '2027-02-12T09:00' });
    const staleTrip = (await db.trips.get(id))!;
    const oldNeeds = tripNeeds(staleTrip, await db.cities.toArray(), [], []);
    await db.trips.update(id, { outbound: { hub: 'STN', checkedIn: true, notes: 'Newer detail' } });
    await bookNeed(staleTrip, oldNeeds.find((n) => n.key === 'flight:outbound')!, {
      amountGBP: 20,
      ref: 'FLIGHT',
    });
    const templates = await db.expenses.where('tripId').equals(id).toArray();
    const spare = templates.find(
      (e) => e.skeleton && e.subcategory === 'Airport Transfer (Abroad)',
    )!;
    await db.expenses.update(spare.id, { need: `transfer-out:${cityId}` });
    const booked = await bookNeed(
      staleTrip,
      oldNeeds.find((n) => n.key === `transfer-in:${cityId}`)!,
      { amountGBP: 12 },
    );
    return {
      outbound: (await db.trips.get(id))!.outbound,
      differentRow: booked.expenseId !== spare.id,
      spare: await db.expenses.get(spare.id),
    };
  });
  expect(result.outbound).toMatchObject({
    hub: 'STN',
    checkedIn: true,
    notes: 'Newer detail',
    ref: 'FLIGHT',
  });
  expect(result.differentRow).toBe(true);
  expect(result.spare.skeleton).toBe(true);
});

test('a failed payment update preserves the original quote and all booking details', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip } = await import('/src/lib/trips.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const id = await createTrip('same-day');
    const trip = (await db.trips.get(id))!;
    const rows = await db.expenses.where('tripId').equals(id).toArray();
    const row = rows.find((e) => e.need === 'flight:outbound')!;
    await db.expenses.update(row.id, { quote: { amountGBP: 80 } });
    const before = JSON.stringify(await db.expenses.get(row.id));
    const fail = () => {
      throw new Error('Synthetic disk full');
    };
    db.expenses.hook('updating', fail);
    let failed = false;
    try {
      await bookNeed(
        trip,
        tripNeeds(trip, [], rows, []).find((n) => n.key === 'flight:outbound')!,
        { amountGBP: 84, ref: 'NO-PARTIAL-REF' },
      );
    } catch {
      failed = true;
    } finally {
      db.expenses.hook('updating').unsubscribe(fail);
    }
    return {
      failed,
      unchanged: before === JSON.stringify(await db.expenses.get(row.id)),
      outbound: (await db.trips.get(id))!.outbound ?? null,
    };
  });
  expect(result).toEqual({ failed: true, unchanged: true, outbound: null });
});

// A row from before `shared` existed reads as trip-wide from its 'A/B'
// destination, and the editor writes that reading back as the flag. Normalising
// it is not reclassifying it: the payment must stay on its booking.
test('an older trip-wide payment survives an ordinary edit still attached', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { tripNeeds } = await import('/src/lib/needs.ts');
    const { addExpense, updateExpense } = await import('/src/lib/expenses.ts');
    const { isShared } = await import('/src/lib/expense-defaults.ts');
    const id = await createTrip('weekend');
    await addCity(id, 'Bologna', 'EUR');
    await addCity(id, 'Barcelona', 'EUR');
    // As an older release wrote it: no flag, no need stamp, the sheet's words.
    const expenseId = await addExpense(id, {
      cityId: null,
      destination: 'Bologna/Barcelona',
      date: '2026-11-01',
      category: 'Transportation',
      subcategory: 'Flight',
      description: 'Outbound flight',
      paymentMethod: 'Online Payment',
      amountGBP: 58,
      amountLocal: 0,
      currency: 'GBP',
      fxRate: null,
      notes: '',
    });
    const row = (await db.expenses.get(expenseId))!;
    const needs = async () =>
      tripNeeds(
        (await db.trips.get(id))!,
        await db.cities.where('tripId').equals(id).sortBy('order'),
        await db.expenses.where('tripId').equals(id).toArray(),
        [],
      );
    const before = (await needs()).find((n) => n.key === 'flight:outbound')!.state;
    // Exactly what the editor saves when only the notes are touched.
    await updateExpense(expenseId, {
      ...row,
      shared: isShared(row),
      notes: 'Checked in',
      skeleton: false,
    });
    const kept = await db.expenses.get(expenseId);
    const after = (await needs()).find((n) => n.key === 'flight:outbound')!.state;
    // Moving it out of Transportation is a reclassification and must detach.
    await updateExpense(expenseId, { category: 'Food', subcategory: 'Lunch' });
    const moved = (await needs()).find((n) => n.key === 'flight:outbound')!.state;
    return { before, after, moved, need: kept!.need ?? null, shared: kept!.shared };
  });
  expect(result).toEqual({
    before: 'paid',
    after: 'paid',
    moved: 'open',
    need: null,
    shared: true,
  });
});

// Paying the seeded "Outbound flight" row is filling the list, not moving a
// payment off its booking.
test('filling a seeded row keeps the booking it was seeded for', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { tripNeeds } = await import('/src/lib/needs.ts');
    const { updateExpense } = await import('/src/lib/expenses.ts');
    const id = await createTrip('weekend');
    await addCity(id, 'Bologna', 'EUR');
    const seeded = (await db.expenses.where('tripId').equals(id).toArray()).find(
      (e) => e.need === 'flight:outbound',
    )!;
    // What the editor saves when the row is paid and marked trip-wide.
    await updateExpense(seeded.id, {
      shared: true,
      cityId: null,
      destination: 'Bologna',
      amountGBP: 58,
      paymentMethod: 'Online Payment',
      date: '2026-11-01',
      skeleton: false,
    });
    const rows = await db.expenses.where('tripId').equals(id).toArray();
    return {
      need: rows.find((e) => e.id === seeded.id)!.need,
      state: tripNeeds(
        (await db.trips.get(id))!,
        await db.cities.where('tripId').equals(id).toArray(),
        rows,
        [],
      ).find((n) => n.key === 'flight:outbound')!.state,
      rows: rows.length,
    };
  });
  expect(result).toMatchObject({ need: 'flight:outbound', state: 'paid' });
});

// The same seeded row, filled in as something else entirely: a seeded row
// carries a category, so this is a reclassification and must detach.
test('paying for a hotel on a seeded flight row never reports the flight paid', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip, addCity } = await import('/src/lib/trips.ts');
    const { tripNeeds } = await import('/src/lib/needs.ts');
    const { updateExpense } = await import('/src/lib/expenses.ts');
    const id = await createTrip('weekend');
    await addCity(id, 'Bologna', 'EUR');
    const seeded = (await db.expenses.where('tripId').equals(id).toArray()).find(
      (e) => e.need === 'flight:outbound',
    )!;
    await updateExpense(seeded.id, {
      category: 'Accommodation',
      subcategory: 'Hotel',
      description: 'Hotel night',
      amountGBP: 90,
      paymentMethod: 'Online Payment',
      date: '2026-11-01',
      skeleton: false,
    });
    const rows = await db.expenses.where('tripId').equals(id).toArray();
    return {
      need: rows.find((e) => e.id === seeded.id)!.need,
      state: tripNeeds(
        (await db.trips.get(id))!,
        await db.cities.where('tripId').equals(id).toArray(),
        rows,
        [],
      ).find((n) => n.key === 'flight:outbound')!.state,
    };
  });
  expect(result).toEqual({ need: '', state: 'open' });
});

test('a reclassified flight payment cannot reattach itself through its old description', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    const { createTrip } = await import('/src/lib/trips.ts');
    const { bookNeed, tripNeeds } = await import('/src/lib/needs.ts');
    const { updateExpense } = await import('/src/lib/expenses.ts');
    const id = await createTrip('same-day');
    const trip = (await db.trips.get(id))!;
    const need = tripNeeds(trip, [], [], []).find((n) => n.key === 'flight:outbound')!;
    const { expenseId } = await bookNeed(trip, need, { amountGBP: 30 });
    await updateExpense(expenseId!, { category: 'Food', subcategory: 'Lunch' });
    const rows = await db.expenses.where('tripId').equals(id).toArray();
    return {
      need: rows.find((e) => e.id === expenseId)!.need,
      state: tripNeeds(trip, [], rows, []).find((n) => n.key === 'flight:outbound')!.state,
    };
  });
  expect(result).toEqual({ need: '', state: 'open' });
});
