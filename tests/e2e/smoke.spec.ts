import { test, expect } from './fixtures';

// Phase 1 smoke test. Run with `npm run test:e2e` (after `npx playwright install`).

test('home loads with the systema title and a New trip action', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/systema/i);
  await expect(page.getByRole('link', { name: /new trip/i })).toBeVisible();
});

test('a web manifest is linked', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});

test('settings is reachable and shows backup and storage controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NAS backup vault' })).toBeVisible();
});

test('creating a City break lands on trip edit with legs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /new trip/i }).click();
  await page.getByRole('button', { name: /City break/i }).click();
  await expect(page.getByRole('heading', { name: 'Edit trip' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Legs' })).toBeVisible();
});
