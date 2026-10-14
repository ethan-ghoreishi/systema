import { test, expect } from './fixtures';

// Insights over a small synthetic ledger.

test('Insights discloses its data, compares one question at a time, and crowns no city', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createTrip, addCity } = await import(/* @vite-ignore */ '/src/lib/trips.ts');
    const { addExpense } = await import(/* @vite-ignore */ '/src/lib/expenses.ts');
    const id = await createTrip('custom');
    const blq = await addCity(id, 'Bologna', 'EUR', {
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T21:00',
      tz: 'Europe/Rome',
    });
    await addCity(id, 'Barcelona', 'EUR', {
      arrival: '2026-10-16T22:00',
      departure: '2026-10-17T22:00',
      tz: 'Europe/Madrid',
      exit: { transport: 'Aerobús', journeyMin: 35 },
    });
    const base = {
      date: '2026-10-16',
      paymentMethod: 'Card Payment',
      amountLocal: 0,
      currency: 'GBP',
      fxRate: null,
      notes: '',
      description: '',
    };
    await addExpense(id, {
      ...base,
      cityId: blq,
      destination: 'Bologna',
      category: 'Food',
      subcategory: 'Grocery Shopping',
      amountGBP: 30,
    });
    await addExpense(id, {
      ...base,
      cityId: null,
      shared: true,
      destination: 'Bologna/Barcelona',
      category: 'Transportation',
      subcategory: 'Flight',
      amountGBP: 200,
    });
    await addExpense(id, {
      ...base,
      cityId: null,
      destination: 'Barcelona',
      category: 'Transportation',
      subcategory: 'Airport Transfer (Abroad)',
      description: 'Aerobús',
      amountGBP: 12,
    });
  });
  await page.goto('/#/insights');
  await page.getByText('What this rests on').click();
  await expect(page.getByText('kept apart — never split between cities')).toBeVisible();
  await expect(page.getByText('Best value')).toHaveCount(0);
  await expect(page.locator('.bar-row', { hasText: 'Bologna' }).first()).toContainText('£60.00');
  await expect(page.getByText('one visit, a reading not a pattern').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Airport transfer, per person' }).click();
  await expect(page.getByText('Not enough data: Bologna.')).toBeVisible();
  await expect(page.locator('.transit-row', { hasText: 'Aerobús' })).toContainText(
    '£6.00 per person · 35 min',
  );
});
