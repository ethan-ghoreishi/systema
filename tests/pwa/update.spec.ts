import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// The installed app must never reload under the user mid-entry when a new
// version deploys; it applies the update once they're back on Home.

const build = (version: string) =>
  execSync('npx vite build --outDir dist-pwa --emptyOutDir', {
    env: { ...process.env, APP_VERSION: version },
    stdio: 'ignore',
  });

test('an update waits while an expense is being entered, then applies on Home', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/systema/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by build A's service worker
  await page.evaluate(() => (location.hash = '/settings'));
  await expect(page.getByText('build-a', { exact: true })).toBeVisible();

  // Mid-entry: a new trip's expense capture open, an amount typed.
  await page.evaluate(() => (location.hash = '/new'));
  await page.getByRole('button', { name: /Day trip/ }).click();
  await expect(page.getByRole('heading', { name: 'Edit trip' })).toBeVisible();
  const trip = await page.evaluate(() => location.hash.split('/')[2]);
  await page.evaluate((id) => (location.hash = `/trip/${id}/expenses`), trip);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  for (const key of ['4', '2']) await page.getByRole('button', { name: key, exact: true }).click();
  await expect(page.getByText('£42', { exact: true })).toBeVisible();
  await page.evaluate(() => ((window as any).sameDocument = true));

  build('build-b');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  // Build B installs and takes control; the old version reloaded right here.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state), { timeout: 30_000 })
    .toBe('activated');
  await page.waitForTimeout(5_000);
  expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
  await expect(page.getByText('£42', { exact: true })).toBeVisible(); // draft intact

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(() => (location.hash = '/'));
  await expect
    .poll(() => page.evaluate(() => (window as any).sameDocument ?? 'reloaded'), {
      timeout: 15_000,
    })
    .toBe('reloaded');
  await page.evaluate(() => (location.hash = '/settings'));
  await expect(page.getByText('build-b', { exact: true })).toBeVisible();
});
