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
  await page.getByLabel('What it cost, for everyone (£)').fill('22');
  await page.getByLabel('How you get there').fill('National Express');
  await page.getByLabel('How long it takes (minutes)').fill('75');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£22 is in Expenses/)).toBeVisible();

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
  await page.getByLabel('What it cost, for everyone (£)').fill('58');
  await page.getByLabel('Where you are staying').fill('Hotel Faro Boutique');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/£58 is in Expenses/)).toBeVisible();
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
  const fill = async (label: string, i: number, value: string) =>
    form.getByLabel(label, { exact: true }).nth(i).fill(value);
  for (const [i, leg] of [
    { from: 'stn', to: 'vlc', dep: '07:10', arr: '10:45', no: 'Ryanair 3012', fare: '28' },
    { from: 'vlc', to: 'stn', dep: '19:20', arr: '21:05', no: 'Ryanair 3013', fare: '34' },
  ].entries()) {
    await fill('From', i, leg.from);
    await fill('To', i, leg.to);
    await fill('Departs', i, leg.dep);
    await fill('Arrives', i, leg.arr);
    await fill('Flight number', i, leg.no);
    await fill('Fare, each (£)', i, leg.fare);
  }
  await form.getByLabel('Hotel nights to pay for').fill('2');
  await page.getByRole('button', { name: 'Save' }).click();

  // Added up from its own parts — fares plus transfers and nights — and said
  // to be, rather than sinking to the bottom of the list with no figure.
  const card = page.locator('.opt').first();
  await expect(card).toContainText('STN → VLC');
  await expect(card.locator('.opt-total')).not.toContainText('—');
  await card.locator('summary').first().click();
  await expect(card).toContainText('added up from what you typed');

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
