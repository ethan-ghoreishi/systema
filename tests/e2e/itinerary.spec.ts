import { test, expect } from './fixtures';

// Legs, time zones, chronology and the calm departure card, with the phone on
// UK time and the trip on Continental time. Synthetic trip only.

test('a two-city stopover: scenario, zones, refused bad times, and a calm leave-by', async ({
  makeContext,
}) => {
  const context = await makeContext({ timezoneId: 'Europe/London' });
  const page = context.pages()[0] ?? (await context.newPage());
  // Fri 16 Oct 2026, 11:00 in London, 12:00 in Bologna.
  await page.clock.setFixedTime(new Date('2026-10-16T10:00:00Z'));
  await page.goto('/');
  await page.getByRole('link', { name: /new trip/i }).click();
  await page.getByRole('button', { name: /Two-City Stopover/ }).click();

  await expect(page.getByRole('radio', { name: /1 Stopover on the way out/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByLabel('Stopover city').fill('Bologna');
  await page.getByLabel('Destination', { exact: true }).fill('Barcelona');
  await page.getByRole('button', { name: 'Set up the legs' }).click();
  await expect(page.locator('.trip-summary-meta')).toContainText(
    'two-city stopover 1 · out via Bologna, night in Barcelona',
  );

  const bologna = page.locator('.leg').nth(0);
  await bologna.getByRole('button', { name: 'Yes' }).click();
  await expect(bologna.getByText('Central European')).toBeVisible();

  // A departure before arrival is refused, with the way to repair it.
  await bologna.getByLabel('Arrival').fill('2026-10-16T09:00');
  await bologna.getByLabel('Arrival').blur();
  await bologna.getByLabel('Departure', { exact: true }).fill('2026-10-15T21:00');
  await bologna.getByLabel('Departure', { exact: true }).blur();
  await expect(bologna.getByRole('alert')).toContainText(
    'departure (Thu 15 Oct, 21:00) is before arrival (Fri 16 Oct, 09:00)',
  );
  await expect(bologna.getByLabel('Departure', { exact: true })).toHaveValue('');
  await bologna.getByLabel('Departure', { exact: true }).fill('2026-10-16T19:00');
  await bologna.getByLabel('Departure', { exact: true }).blur();
  await expect(bologna.getByRole('alert')).toHaveCount(0);

  await bologna.getByRole('button', { name: /Departs Fri 16 Oct, 19:00/ }).click();
  const editor = page.locator('dialog.modal[open]');
  await editor.getByLabel('Airport').fill('BLQ');
  await editor.getByLabel('Journey (min)').fill('25');
  await expect(editor.getByRole('status')).toHaveText('Leave by 16:50.');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  await expect(bologna.getByText('leave by 16:50')).toBeVisible();

  const barcelona = page.locator('.leg').nth(1);
  await barcelona.getByRole('button', { name: 'Yes' }).click();
  await barcelona.getByLabel('Arrival').fill('2026-10-16T21:00');
  await barcelona.getByLabel('Arrival').blur();
  await barcelona.getByLabel('Departure', { exact: true }).fill('2026-10-17T21:00');
  await barcelona.getByLabel('Departure', { exact: true }).blur();

  await page.getByRole('button', { name: 'Done' }).click();
  const card = page.getByRole('region', { name: 'Next departure' });
  // The next departure is the evening hop, not the flight home.
  await expect(card).toContainText('Leave for BLQ by 16:50 (Bologna time).');
  await expect(card).toContainText('You are on track.');
  await expect(card).toContainText('Later');
  await expect(card).not.toContainText(/\d+s\b/); // no seconds ticking

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Calendar reminders' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('systema-departures.ics');
  const ics = await (await file.createReadStream()).toArray();
  const text = Buffer.concat(ics).toString();
  expect(text).toContain('SUMMARY:Leave now for BLQ');
  expect(text).toContain('DTSTART:20261016T145000Z');
});
