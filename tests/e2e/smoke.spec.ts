import { test, expect } from '@playwright/test';

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

test('settings is reachable and shows capture sync', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Capture sync')).toBeVisible();
});

test('creating a Weekend Getaway lands on trip edit with cities', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /new trip/i }).click();
  await page.getByRole('button', { name: /Weekend Getaway/i }).click();
  await expect(page.getByRole('heading', { name: 'Edit trip' })).toBeVisible();
  await expect(page.getByText('Cities')).toBeVisible();
});
