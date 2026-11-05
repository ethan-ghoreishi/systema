import { test, expect } from './fixtures';

/**
 * The whole lifecycle, in the browser: a finder search arrives, the options are
 * compared with the traveller's own costs, one is chosen, it becomes an
 * ordinary trip, and booking the coach settles the requirement and the expense
 * at once.
 */

// Real Cheap-Trip Finder output.
const HEAD =
  'City,Country,Out date,Back date,Trip,£/usable h,True £pp,Fare £pp,Status,Usable h,Ground,Cities,Overnight,Paid nights,Out,Out flights,Out £pp,Back,Back flights,Back £pp,Out link,Back link,Checked,Notes';
const ROWS = [
  'Faro,Portugal,2027-02-12,2027-02-13,Fri→Sat · 1 night,4.99,96.0,34.5,OK,19.2,31h15,FAO 19h,Hotel ×1,1,LTN→FAO 09:25→12:15,Ryanair 5767,19.0,FAO→LTN 19:30→22:20,easyJet 2412,15.5,https://example.test/o,https://example.test/b,2027-01-20 00:46,',
  'Faro,Portugal,2027-02-19,2027-02-20,Fri→Sat · 1 night,6.10,120.0,52.0,OK,19.7,31h15,FAO 19h,Hotel ×1,1,STN→FAO 06:00→08:50,Ryanair 5769,26.0,FAO→STN 19:30→22:20,Ryanair 5770,26.0,https://example.test/o2,https://example.test/b2,2027-01-20 00:46,',
  'Nantes,France,2027-02-12,2027-02-13,Sat→Sun · 1 night,5.23,108.0,33.0,OK,20.7,32h40,NTE 21h,Hotel ×1,1,STN→NTE 06:00→08:25,Ryanair 2232,18.0,NTE→STN 17:05→17:30,Ryanair 2231,15.0,https://example.test/o3,https://example.test/b3,2027-01-20 00:46,',
].join('\n');

async function seedHistory(page: import('@playwright/test').Page) {
  // One past trip, so the ledger has something to say about Luton and hotels.
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    await db.trips.put({
      id: 'past',
      name: '',
      type: 'weekend',
      startDate: '2026-01-14',
      endDate: '2026-01-16',
      partySize: 2,
      returnFlightAt: '2026-01-16T18:00',
      accommodation: true,
      status: 'done',
      planText: '',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.cities.put({
      id: 'past-city',
      tripId: 'past',
      name: 'Cairo',
      currency: 'EGP',
      order: 0,
      sleep: 'hotel',
      arrival: '2026-01-14T15:00',
      departure: '2026-01-16T18:00',
    });
    await db.expenses.bulkPut([
      {
        id: 'past-uk',
        tripId: 'past',
        cityId: null,
        date: '2026-01-14',
        destination: 'Cairo',
        category: 'Transportation',
        subcategory: 'Airport Transfer (UK)',
        description: 'London to Luton Airport Bus Tickets (Return)',
        paymentMethod: 'Card Payment',
        amountGBP: 40,
        amountLocal: 0,
        notes: '',
        currency: 'GBP',
        fxRate: null,
        skeleton: false,
        order: 0,
        createdAt: 1,
      },
      {
        id: 'past-hotel',
        tripId: 'past',
        cityId: 'past-city',
        date: '2026-01-14',
        destination: 'Cairo',
        category: 'Accommodation',
        subcategory: 'Hotel',
        description: 'Hotel',
        paymentMethod: 'Online Payment',
        amountGBP: 43.2,
        amountLocal: 0,
        notes: '',
        currency: 'GBP',
        fxRate: null,
        skeleton: false,
        order: 1,
        createdAt: 1,
      },
    ]);
  });
}

test('a finder search becomes a compared shortlist, a trip, and a booked coach', async ({
  page,
}) => {
  await page.goto('/');
  await seedHistory(page);
  await page.reload();

  // --- The hand-off: paste the table, choose what is worth comparing ---
  await page.getByRole('button', { name: 'Add a finder search' }).click();
  await page.locator('summary', { hasText: 'Or paste the table' }).click();
  await page.getByLabel('Finder table').fill(`${HEAD}\n${ROWS}`);
  await page.getByRole('button', { name: 'Read the table' }).click();
  await expect(page.getByText('3 trips found')).toBeVisible();

  // Three rows, two destinations, all pre-ticked because the search is small.
  await page.locator('.finder-row', { hasText: 'Nantes' }).locator('input').uncheck();
  await page.getByRole('button', { name: /^Add 2$/ }).click();
  await expect(page.getByText(/Added 2 options across 1 destination/)).toBeVisible();

  // --- Home now has the destination under consideration ---
  const card = page.locator('.trip-card', { hasText: 'Faro' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 options');
  await card.click();

  // --- The comparison: re-priced against this traveller's own costs ---
  const first = page.locator('.opt').first();
  await expect(first).toContainText('Fri 12 – Sat 13 Feb');
  // The finder assumed £9 each way at Luton and £60 a night; the ledger says
  // £10 and £43.20, so the honest figure is higher than £96.
  await expect(first.locator('.opt-total')).toContainText('£');
  await first.getByRole('group').or(first.locator('details')).first().click();
  await expect(first).toContainText('LTN transfer out');
  await expect(first).toContainText('past journey');
  await expect(first).toContainText('hotel night');

  // A second option, and a sentence saying how it differs.
  await expect(page.locator('.opt')).toHaveCount(2);
  await expect(page.locator('.opt').nth(1).locator('.opt-diff')).toContainText(/more|less/);

  // Leaving home is a real clock time, not a £25 penalty.
  await expect(page.locator('.opt').nth(1)).toContainText('03:30');

  // --- Choosing makes an ordinary trip ---
  await first.getByRole('button', { name: 'Choose this' }).click();
  await expect(page.getByText(/Trip created/)).toBeVisible();
  await expect(page.locator('.opp-chosen')).toContainText('Faro');
  await page.locator('.opp-chosen').click();

  // --- The trip holds what the row said ---
  const trip = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const t = (await db.trips.toArray()).find((x) => x.opportunityId);
    const legs = await db.cities.where('tripId').equals(t.id).toArray();
    return {
      outbound: t.outbound,
      leg: {
        name: legs[0].name,
        arrival: legs[0].arrival,
        departure: legs[0].departure,
        sleep: legs[0].sleep,
        exit: legs[0].exit,
      },
      linked: !!t.optionId,
    };
  });
  expect(trip.outbound).toMatchObject({
    at: '2027-02-12T09:25',
    hub: 'LTN',
    number: 'Ryanair 5767',
  });
  expect(trip.leg).toMatchObject({
    name: 'Faro',
    arrival: '2027-02-12T12:15',
    departure: '2027-02-13T19:30',
    sleep: 'hotel',
  });
  expect(trip.leg.exit).toMatchObject({ hub: 'FAO', number: 'easyJet 2412' });
  expect(trip.linked).toBe(true);

  // --- Before you go: derived, not a checklist ---
  const before = page.locator('.before');
  await expect(before).toContainText('to sort out');
  await expect(before.locator('.need-label', { hasText: 'Ticket out' })).toBeVisible();
  await expect(before.locator('.need-label', { hasText: 'Getting to LTN' })).toBeVisible();
  await expect(
    before.locator('.need-label', { hasText: 'Somewhere to stay in Faro' }),
  ).toBeVisible();

  // --- Booking the coach once: the requirement and the expense together ---
  await before.locator('.need', { hasText: 'Getting to LTN' }).getByRole('button').click();
  await page.getByLabel('What it cost, for everyone').fill('22');
  await page.getByLabel('How you get there').fill('National Express');
  await page.getByLabel('Or how long it takes (minutes)').fill('75');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£22.00 is in Expenses/)).toBeVisible();

  // It leaves the outstanding list for the settled one, and the 75 minutes
  // reach the countdown: leave-by stops being a guess.
  await expect(before.locator('.before > .need', { hasText: 'Getting to LTN' })).toHaveCount(0);
  await expect(before.locator('.before-done')).toContainText('1 already sorted');
  await expect(page.locator('.depart')).toContainText('Leave for LTN by Fri 12 Feb, 06:25');
  const booked = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const t = (await db.trips.toArray()).find((x) => x.opportunityId);
    const rows = (await db.expenses.where('tripId').equals(t.id).toArray()).filter(
      (e) => e.need === 'transfer-uk:out',
    );
    return {
      count: rows.length,
      amount: rows[0]?.amountGBP,
      skeleton: rows[0]?.skeleton,
      shared: rows[0]?.shared,
      transport: t.outbound.transport,
      journeyMin: t.outbound.journeyMin,
    };
  });
  expect(booked).toEqual({
    count: 1,
    amount: 22,
    skeleton: false,
    shared: true,
    transport: 'National Express',
    journeyMin: 75,
  });

  // Booking the hotel fills the placeholder the preset seeded rather than
  // sitting beside it: one Accommodation row, and no skeleton left over.
  await before
    .locator('.need', { hasText: 'Somewhere to stay in Faro' })
    .getByRole('button')
    .click();
  await page.getByLabel('What it cost, for everyone').fill('58');
  await page.getByLabel('Where you are staying').fill('Hotel Faro Boutique');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£58.00 is in Expenses/)).toBeVisible();
  const hotel = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const t = (await db.trips.toArray()).find((x) => x.opportunityId);
    const rows = (await db.expenses.where('tripId').equals(t.id).toArray()).filter(
      (e) => e.category === 'Accommodation',
    );
    const leg = (await db.cities.where('tripId').equals(t.id).toArray())[0];
    return {
      rows: rows.length,
      skeletons: rows.filter((e) => e.skeleton).length,
      amount: rows[0]?.amountGBP,
      base: leg.base?.name,
    };
  });
  expect(hotel).toEqual({ rows: 1, skeletons: 0, amount: 58, base: 'Hotel Faro Boutique' });

  // A return bus into town is one purchase. The two journeys keep their own
  // lines — they happen at different hours — but buying it settles both.
  await before
    .locator('.need', { hasText: 'Getting into Faro from FAO' })
    .getByRole('button')
    .click();
  await page.getByLabel('What it cost, for everyone').fill('9');
  await page.getByLabel('How you get there').fill('Próximo bus 16');
  await page.getByLabel('Or how long it takes (minutes)').fill('20');
  await page.getByText('The same ticket covers the way back').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(before.locator('.before > .need', { hasText: 'Getting into Faro' })).toHaveCount(0);
  await expect(before.locator('.before > .need', { hasText: 'Getting from Faro' })).toHaveCount(0);

  // And it shows up in Expenses as a real row, never to be typed again.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(
    page.locator('.expense-row', { hasText: 'Airport transfer (UK) — outbound' }),
  ).toContainText('22');
});

test('an option whose dates have gone stops asking, and the research is kept', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    await db.opportunities.put({
      id: 'old-idea',
      city: 'Gdansk',
      country: 'Poland',
      research: 'Bus 210 from the airport, about 35 minutes.',
      options: [
        {
          id: 'gone',
          outDate: '2026-03-01',
          backDate: '2026-03-02',
          outRoute: ['STN', 'GDN'],
          backRoute: ['GDN', 'STN'],
          finderPP: 99,
        },
      ],
      createdAt: 1,
    });
  });
  await page.reload();

  // Fares that have been overtaken are research to come back to, not a
  // shortlist to read past: they fold away behind one line.
  await page.locator('summary', { hasText: /dates have gone/ }).click();
  const card = page.locator('.trip-card', { hasText: 'Gdansk' });
  await expect(card).toContainText('dates passed');
  await card.click();
  await expect(page.getByText('Nothing still ahead')).toBeVisible();
  await expect(page.getByText('Bus 210 from the airport')).toBeVisible();
  // Kept, not dropped: what that trip would have cost is the best guide to
  // what the next one will cost.
  await page.locator('summary', { hasText: /dates have gone/ }).click();
  await expect(page.locator('.opt')).toContainText('STN → GDN');
});

// The search writes a price map beside its results, with the same first four
// columns. Reading that as trips made destinations with no flights and no
// fares — nothing you could act on.
test('the search’s price map is refused, by name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a finder search' }).click();
  await page.locator('summary', { hasText: 'Or paste the table' }).click();
  await page
    .getByLabel('Finder table')
    .fill(
      'City,Country,Out date,Back date,Trip,From £pp,Trip £pp,Fits,Details\n' +
        'Tirane,Albania,2027-03-05,2027-03-06,Fri→Sat · 1 night,41.0,41.0,True,found',
    );
  await page.getByRole('button', { name: 'Read the table' }).click();
  await expect(page.getByRole('alert')).toContainText('price map');
  await expect(page.locator('.finder-row')).toHaveCount(0);
});

// Manual Google Flights research is the way in, not a lesser path: a
// destination and a way of getting there, typed, compared and chosen.
test('a destination and an option written by hand go all the way to a trip', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a destination' }).click();
  await page.getByLabel('Where').fill('Valencia');
  await page.getByLabel('Country').fill('Spain');
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(page.getByRole('heading', { name: 'Valencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Add an option' }).click();
  const form = page.locator('dialog[open] .modal-body');
  await form.getByLabel('Out on').fill('2027-04-16');
  await form.getByLabel('Back on').fill('2027-04-18');
  const fill = async (label: string | RegExp, i: number, value: string) =>
    form
      .getByLabel(label, typeof label === 'string' ? { exact: true } : undefined)
      .nth(i)
      .fill(value);
  for (const [i, leg] of [
    { from: 'stn', to: 'vlc', dep: '07:10', arr: '10:45', no: 'Ryanair 3012', fare: '28' },
    { from: 'vlc', to: 'stn', dep: '19:20', arr: '21:05', no: 'Ryanair 3013', fare: '34' },
  ].entries()) {
    await fill('From', i, leg.from);
    await fill('To', i, leg.to);
    // Each clock names the airport it belongs to: 'Departs · STN time'.
    await fill(/^Departs · /, i, leg.dep);
    await fill(/^Arrives · /, i, leg.arr);
    await form.locator('summary', { hasText: 'More about this flight' }).nth(i).click();
    await fill('Flight number', i, leg.no);
    await fill('Fare, each', i, leg.fare);
  }
  await form.getByLabel('Where you sleep').selectOption('hotel');
  await form.getByLabel('Nights to pay for').fill('2');
  await page.getByRole('button', { name: 'Save' }).click();

  // Added up from its own parts — fares plus transfers and nights — and said
  // to be, rather than sinking to the bottom of the list with no figure.
  const card = page.locator('.opt').first();
  await expect(card).toContainText('STN → VLC');
  await expect(card.locator('.opt-total')).not.toContainText('—');
  await card.locator('summary').first().click();
  await expect(card).toContainText('Added up from what you typed');

  await card.getByRole('button', { name: 'Choose this' }).click();
  await expect(page.getByText(/Trip created/)).toBeVisible();
  const trip = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const t = (await db.trips.toArray()).find((x) => x.opportunityId);
    const legs = await db.cities.where('tripId').equals(t.id).toArray();
    return { at: t.outbound?.at, hub: t.outbound?.hub, leg: legs[0]?.name, sleep: legs[0]?.sleep };
  });
  expect(trip).toMatchObject({
    at: '2027-04-16T07:10',
    hub: 'STN',
    leg: 'Valencia',
    sleep: 'hotel',
  });

  // And the research is still a tap away from the trip it became.
  await page.locator('.opp-chosen').click();
  await expect(page.getByText(/What you know about Valencia/)).toBeVisible();
});

// The obvious thing to do is pick everything the search saved — results, price
// map and settings — so the results have to be found among them, and the
// settings have to be read rather than silently defaulted.
test('picking everything the search saved finds the results and its settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a finder search' }).click();
  await page.locator('input[type=file]').setInputFiles([
    {
      name: 'trips_custom_20270212_price_map.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'City,Country,Out date,Back date,Trip,From £pp,Trip £pp,Fits,Details\n' +
          'Faro,Portugal,2027-02-12,2027-02-13,Fri→Sat · 1 night,34.5,34.5,True,found\n',
      ),
    },
    {
      name: 'trips_custom_20270212.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${HEAD}\n${ROWS}\n`),
    },
    {
      name: 'trips_custom_20270212.config.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"travellers":3,"dest_transfer_pp":14,"hotel_per_night":72}'),
    },
  ]);

  await expect(page.getByText('3 trips found')).toBeVisible();
  await expect(page.getByText(/Priced for 3 travellers/)).toContainText('£14 a transfer');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // And what the run priced for travels with each option, so a re-priced
  // figure is measured against that run and not against a copied constant.
  await page.locator('.finder-row', { hasText: 'Nantes' }).locator('input').uncheck();
  await page.getByRole('button', { name: /^Add 2$/ }).click();
  await expect(page.getByText(/Added 2 options across 1 destination/)).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const opp = await db.opportunities.toCollection().first();
      return opp?.options[0]?.finderAssumptions;
    }),
  ).toEqual({
    travellers: 3,
    destTransferPP: 14,
    hotelPerNight: 72,
    bagStoragePerDay: undefined,
    esimPerTrip: undefined,
    earlyDepPenalty: undefined,
  });
});

// The half of a trip no booking covers. The rules are unit-tested; what the
// browser has to prove is that a tick survives, since it lives on the trip and
// so travels with it through backup and sync.
test('getting ready appears close to the day, and a tick sticks', async ({ page }) => {
  await page.goto('/');
  const tripId = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    const at = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 16);
    await db.trips.put({
      id: 'soon',
      name: '',
      type: 'weekend',
      startDate: at.slice(0, 10),
      endDate: at.slice(0, 10),
      partySize: 2,
      returnFlightAt: '',
      accommodation: true,
      status: 'planning',
      planText: '',
      outbound: { at: `${at.slice(0, 10)}T05:40`, tz: 'Europe/London', hub: 'STN' },
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.cities.put({
      id: 'soon-city',
      tripId: 'soon',
      name: 'Faro',
      currency: 'EUR',
      order: 0,
      sleep: 'hotel',
      arrival: `${at.slice(0, 10)}T09:25`,
      tz: 'Europe/Lisbon',
    });
    return 'soon';
  });

  await page.goto(`/#/trip/${tripId}/plan`);
  const prep = page.locator('.card', { hasText: 'Getting ready' });
  await expect(prep).toBeVisible();
  // The reason is this trip's own: a 05:40 flight means leaving in the dark.
  await expect(prep).toContainText('nothing is open on the way');
  // 'Buy the food' also appears in what the next step waits for, so this is
  // the line itself, not the one that names it.
  await prep.getByRole('checkbox', { name: /^Buy the food/ }).check();
  // The card reads the trip back through its own live query, so this is the
  // write landing — reloading before it has is a race, not a test.
  await expect(prep.locator('.need--done', { hasText: 'nuts, coffee' })).toBeVisible();
  await page.reload();
  await expect(prep.locator('.need--done', { hasText: 'nuts, coffee' })).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.trips.get('soon'))?.prep?.done;
    }),
  ).toEqual(['food:buy']);
});

/**
 * The money path, end to end, in the browser — the one that was broken.
 *
 * A trip typed by hand with the two tickets priced in different currencies;
 * choosing it carries the fares forward as quotes, not as spending; booking
 * writes the real price once; and correcting that price afterwards in Expenses
 * actually sticks (it used to spring back to the original figure).
 */
test('a quoted fare becomes a booking, and a corrected price stays corrected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a destination' }).click();
  await page.getByLabel('Where').fill('Amman');
  await page.getByLabel('Country').fill('Jordan');
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: 'Add an option' }).click();
  const form = page.locator('dialog[open] .modal-body');

  // Coming back before you set off is not offered at all now: moving the
  // outbound past the return takes the return with it.
  await form.getByLabel('Out on').fill('2027-05-14');
  await form.getByLabel('Back on').fill('2027-05-17');
  await form.getByLabel('Out on').fill('2027-05-20');
  await expect(form.getByLabel('Back on')).toHaveValue('2027-05-20');
  await form.getByLabel('Out on').fill('2027-05-14');
  await form.getByLabel('Back on').fill('2027-05-17');

  const nth = (label: string | RegExp, i: number) =>
    form.getByLabel(label, typeof label === 'string' ? { exact: true } : undefined).nth(i);
  await nth('From', 0).fill('stn');
  await nth('To', 0).fill('amm');
  await nth(/^Departs · /, 0).fill('09:30');
  await nth(/^Arrives · /, 0).fill('17:05');
  await nth('From', 1).fill('amm');
  await nth('To', 1).fill('stn');
  await nth(/^Departs · /, 1).fill('11:00');
  await nth(/^Arrives · /, 1).fill('14:40');

  // The clocks name the airport whose time they are: a 09:30 departure and a
  // 17:05 arrival are two different clocks, and the card has to say so.
  await expect(nth(/^Departs · /, 0)).toHaveAttribute('id', 'out-dep');
  await expect(form.getByText('Departs · STN time')).toBeVisible();
  await expect(form.getByText('Arrives · AMM time')).toBeVisible();

  // Two tickets, two currencies. The dinar has no published rate, so the £ is
  // asked for rather than promised.
  await nth('Fare, each', 0).fill('180');
  await nth('Paid in', 0).selectOption('GBP');
  await nth('Fare, each', 1).fill('95');
  await nth('Paid in', 1).selectOption('JOD');
  await expect(form.getByText(/No JOD rate is published/)).toBeVisible();
  await nth(/^…which is, in £ each$/, 0).fill('106');

  await form.getByLabel('Where you sleep').selectOption('hotel');
  await form.getByLabel('Nights to pay for').fill('3');
  await page.getByRole('button', { name: 'Save' }).click();

  // The fare is shown as it was really quoted, with the sterling beside it.
  const card = page.locator('.opt').first();
  await card.locator('summary').first().click();
  await expect(card).toContainText('£180 + 95 JOD each (£180 + £106)');

  await card.getByRole('button', { name: 'Choose this' }).click();
  await expect(page.getByText(/Trip created/)).toBeVisible();
  await page.locator('.opp-chosen').click();

  // Jordan spends dinars, so nothing has to be typed for that either.
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.cities.toArray()).find((c) => c.name === 'Amman')?.currency;
    }),
  ).toBe('JOD');

  // --- A quote is not a payment ---
  const before = page.getByRole('region', { name: 'Before you go' });
  await expect(before.locator('.need', { hasText: 'Ticket out' })).toContainText(
    'historical quote £360',
  );
  await expect(before.locator('.need', { hasText: 'Ticket home' })).toContainText(
    'historical quote £212',
  );
  await page.getByRole('link', { name: 'Expenses' }).click();
  // Nothing has been spent: the quotes are beside the rows, not in the total.
  await expect(
    page.locator('.expense-row--skeleton', { hasText: 'Outbound flight' }),
  ).toContainText('quoted £360.00');
  await expect(page.getByText('£0.00').first()).toBeVisible();

  // --- Booking it offers the quote, and records what was really paid ---
  await page.getByRole('link', { name: 'Plan' }).click();
  await before.locator('.need', { hasText: 'Ticket out' }).getByRole('button').click();
  await expect(page.getByLabel('What it cost, for everyone')).toHaveValue('360');
  await page.getByLabel('What it cost, for everyone').fill('372');
  await page.getByLabel('Booking reference').fill('RY-99KL');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£372.00 is in Expenses/)).toBeVisible();

  // --- And a mistake in Expenses can be corrected ---
  await page.getByRole('link', { name: 'Expenses' }).click();
  const row = page.locator('.expense-row', { hasText: 'Outbound flight' });
  await expect(row).toContainText('372');
  await row.click();
  await expect(page.getByText(/answers for the ticket out/)).toBeVisible();
  // The booking wrote the £ as a hand-typed one, which used to be held in a
  // hidden field and written straight back over any correction.
  const keypad = page.locator('dialog[open]');
  for (let i = 0; i < 3; i += 1)
    await keypad.getByRole('button', { name: 'Delete', exact: true }).click();
  for (const k of ['3', '0', '8'])
    await keypad.getByRole('button', { name: k, exact: true }).click();
  await keypad.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('308');
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const e = (await db.expenses.toArray()).find((x) => x.need === 'flight:outbound');
      return { amountGBP: e?.amountGBP, ref: e?.notes, quote: e?.quote?.amountGBP };
    }),
  ).toEqual({ amountGBP: 308, ref: 'Booking RY-99KL', quote: 360 });

  // The reference went onto the flight, not into the ledger's description.
  expect(
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      return (await db.trips.toArray()).find((t) => t.opportunityId)?.outbound?.ref;
    }),
  ).toBe('RY-99KL');
});

/**
 * A field you empty has to stay empty. The editor is handed the stored plan to
 * start from, so laying its result back over that plan put every cleared field
 * straight back — including a coach reference written into the flight's slot,
 * which is how a trip read as having a booked flight it did not have.
 */
test('a detail cleared on the London end stays cleared', async ({ page }) => {
  await page.goto('/');
  const tripId = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const { createTrip, addCity, updateTrip } = await import(
      /* @vite-ignore */ '/src/lib/trips.ts'
    );
    await db.open();
    const id = await createTrip('weekend');
    await updateTrip(id, {
      outbound: {
        at: '2027-06-18T06:30',
        tz: 'Europe/London',
        hub: 'STN',
        ref: 'WRONG-REF',
        transport: 'National Express',
        payOnDay: true,
      },
    });
    await addCity(id, 'Faro', 'EUR', {
      arrival: '2027-06-18T09:20',
      departure: '2027-06-20T19:30',
      sleep: 'hotel',
    });
    return id;
  });

  await page.goto(`/#/trip/${tripId}/edit`);
  await page.getByRole('button', { name: /Flight out/ }).click();
  const editor = page.locator('dialog.modal[open]');
  await editor.getByLabel('Flight booking ref').fill('');
  await editor.getByLabel(/pay on the day/i).uncheck();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();

  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const t = await db.trips.get(id);
      return {
        ref: t?.outbound?.ref ?? null,
        payOnDay: t?.outbound?.payOnDay ?? null,
        // Everything the editor was not asked about is still there.
        at: t?.outbound?.at,
        hub: t?.outbound?.hub,
      };
    }, tripId),
  ).toEqual({ ref: null, payOnDay: null, at: '2027-06-18T06:30', hub: 'STN' });

  // And the ticket out is outstanding again, because nothing books it now.
  await page.goto(`/#/trip/${tripId}/plan`);
  const before = page.getByRole('region', { name: 'Before you go' });
  await expect(before.locator('.need-label', { hasText: 'Ticket out' })).toBeVisible();
  await expect(before.locator('.need', { hasText: 'Getting to STN' })).toContainText(
    'not booked yet',
  );
});

/**
 * Editing an option must not quietly re-price it. Re-opening one whose fare is
 * in another currency used to carry its stored £ in a hidden field: change the
 * fare and the £ stayed as it was — the same defect as the ledger's, in the
 * other direction.
 */
test('a fare in another currency re-prices when it changes, and only then', async ({ page }) => {
  await page.goto('/');
  await page.route('https://api.frankfurter.dev/**', (r) =>
    r.fulfill({ json: { date: '2027-01-02', rates: { GBP: 0.85 } } }),
  );
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    await db.open();
    await db.opportunities.put({
      id: 'eur',
      city: 'Nantes',
      country: 'France',
      options: [
        {
          id: 'o-eur',
          source: 'manual',
          outDate: '2027-09-10',
          backDate: '2027-09-12',
          outRoute: ['STN', 'NTE'],
          backRoute: ['NTE', 'STN'],
          outFarePP: 40,
          outFareLocal: 50,
          outFareCcy: 'EUR',
          backFarePP: 30,
          // Checked long ago: an untouched save must not make it look fresh.
          checked: '2027-01-02 00:00',
        },
      ],
      createdAt: 1,
    });
  });
  await page.goto('/#/opp/eur');

  const stored = async () =>
    page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const o = (await db.opportunities.get('eur'))!.options[0];
      return { outFarePP: o.outFarePP, outFareLocal: o.outFareLocal, checked: o.checked };
    });

  // Saving without touching the fare keeps the £ it was recorded with — and
  // keeps saying how old the fare is.
  await page.locator('.opt').first().getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dialog.modal[open]')).toHaveCount(0);
  expect(await stored()).toEqual({
    outFarePP: 40,
    outFareLocal: 50,
    checked: '2027-01-02 00:00',
  });

  // Changing it re-prices at the day's rate, and the fare is fresh again.
  await page.locator('.opt').first().getByRole('button', { name: 'Edit' }).click();
  const form = page.locator('dialog[open] .modal-body');
  await form.getByLabel('Fare, each', { exact: true }).first().fill('80');
  await expect(form.getByText('About £68 each in sterling')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dialog.modal[open]')).toHaveCount(0);
  const after = await stored();
  expect(after.outFarePP).toBe(68);
  expect(after.outFareLocal).toBe(80);
  expect(after.checked).not.toBe('2027-01-02 00:00');
});

// A dinar has no published rate and never will, so a booking in one with no £
// would sit in the ledger as nothing paid while the sheet said it was.
test('a booking in a currency with no rate asks for the £ before it saves', async ({ page }) => {
  await page.goto('/');
  const tripId = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
    const { createTrip, addCity, updateTrip } = await import(
      /* @vite-ignore */ '/src/lib/trips.ts'
    );
    await db.open();
    const id = await createTrip('weekend');
    await updateTrip(id, { outbound: { at: '2027-07-02T09:30', tz: 'Europe/London', hub: 'STN' } });
    await addCity(id, 'Amman', 'JOD', {
      arrival: '2027-07-02T17:05',
      departure: '2027-07-05T11:00',
      sleep: 'hotel',
    });
    return id;
  });
  await page.goto(`/#/trip/${tripId}/plan`);
  const before = page.getByRole('region', { name: 'Before you go' });
  await before.locator('.need', { hasText: 'Getting into Amman' }).getByRole('button').click();

  await page.getByLabel('What it cost, for everyone').fill('12');
  await page.getByLabel('Paid in').selectOption('JOD');
  await expect(page.getByText(/No JOD rate is available/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.getByLabel('Amount (GBP)').fill('13.40');
  await page.getByLabel('How you get there').fill('Airport bus 1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£13.40 is in Expenses/)).toBeVisible();

  expect(
    await page.evaluate(async (id) => {
      const { db } = await import(/* @vite-ignore */ '/src/lib/db.ts');
      const e = (await db.expenses.where('tripId').equals(id).toArray()).find((x) =>
        x.need?.startsWith('transfer-in:'),
      );
      return {
        amountGBP: e?.amountGBP,
        amountLocal: e?.amountLocal,
        currency: e?.currency,
        fxPending: e?.fxPending ?? false,
        gbpManual: e?.gbpManual,
      };
    }, tripId),
  ).toEqual({
    amountGBP: 13.4,
    amountLocal: 12,
    currency: 'JOD',
    fxPending: false,
    gbpManual: true,
  });
});

test('manual fares use decimal commas and refuse ambiguous GBP equivalents', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a destination' }).click();
  await page.getByLabel('Where').fill('Money test');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add an option' }).click();
  await page.locator('#out-from').fill('STN');
  await page.locator('#out-to').fill('FAO');
  await page.locator('#out-dep').fill('08:00');
  await page.locator('#out-arr').fill('11:00');
  await page.locator('#back-from').fill('FAO');
  await page.locator('#back-to').fill('STN');
  await page.locator('#back-dep').fill('18:00');
  await page.locator('#back-arr').fill('21:00');
  await page.locator('#out-fare').fill('12,50');
  await page.locator('#back-fare').fill('1,234');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await page.locator('#back-fare').fill('1.234,56');
  await page.locator('#back-ccy').selectOption('JOD');
  await page.locator('#back-gbp').fill('1,234');
  await expect(save).toBeDisabled();
  await page.locator('#back-gbp').fill('300,50');
  await save.click();
  const options = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts');
    return (await db.opportunities.toArray())[0].options;
  });
  expect(options[0]).toMatchObject({ outFarePP: 12.5, backFareLocal: 1234.56, backFarePP: 300.5 });
});
