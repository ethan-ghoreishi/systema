import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Navigation, layout stability, dialogs and copying — on Chromium and on
// WebKit with an iPhone profile (the iPhone's engine). Synthetic data only.
// What WebKit here can't show — the installed app's status bar, a real
// keyboard — is listed for checking on the phone in the README.

async function seed(page: Page, stops = 40): Promise<{ id: string; stopIds: string[] }> {
  await page.goto('/');
  return page.evaluate(async (n) => {
    const tripsPath = '/src/lib/trips.ts';
    const stopsPath = '/src/lib/stops.ts';
    const { createTrip, updateTrip, addCity } = await import(/* @vite-ignore */ tripsPath);
    const { addStop } = await import(/* @vite-ignore */ stopsPath);
    const id = await createTrip('custom');
    await updateTrip(id, { nameManual: 'Layout test' });
    await addCity(id, 'Bologna', 'EUR');
    const stopIds: string[] = [];
    for (let i = 1; i <= n; i += 1) stopIds.push(await addStop(id, `Stop ${i}`));
    return { id, stopIds };
  }, stops);
}

const pane = (page: Page) => page.locator('.screen-body');
const scrollTop = (page: Page) => pane(page).evaluate((el) => el.scrollTop);

test('Back from a stop returns to the same place in the list, then leaves the trip', async ({
  page,
}) => {
  const { id } = await seed(page);
  await page.goto('/#/');
  await page.getByRole('link', { name: /Layout test/ }).click();
  await page.getByRole('link', { name: 'Stops' }).click();
  await expect(page.getByRole('button', { name: 'Stop 40' })).toBeAttached();

  await page.getByRole('button', { name: 'Stop 30', exact: true }).scrollIntoViewIfNeeded();
  const before = await scrollTop(page);
  expect(before).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Stop 30', exact: true }).click();
  await expect(page.getByLabel('Stop name')).toHaveValue('Stop 30');

  // Back lives in the persistent header, not in the scrolling content.
  const backBtn = page.locator('header.topbar').getByRole('button', { name: 'Back to Stops' });
  await expect(backBtn).toBeVisible();
  await backBtn.click();
  await expect(page).toHaveURL(new RegExp(`#/trip/${id}/stops$`));
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before - 4);
  expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(4);
  await expect(page.getByRole('button', { name: 'Stop 30', exact: true })).toBeFocused();

  // Tabs replace each other, so Back leaves the trip instead of walking tabs.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('link', { name: 'Plan' }).click();
  await page.locator('header.topbar').getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('link', { name: /New trip/ })).toBeVisible();
});

test('a deep link falls back to the natural parent, and List/Map is remembered', async ({
  page: seeder,
  context,
}) => {
  const { id, stopIds } = await seed(seeder, 3);
  // A cold start straight onto a stop: a new tab has no in-app history.
  const page = await context.newPage();
  await page.goto(`/#/trip/${id}/stops/${stopIds[1]}`);
  await expect(page.getByLabel('Stop name')).toHaveValue('Stop 2');
  await page.getByRole('button', { name: 'Back to Stops' }).click();
  await expect(page).toHaveURL(new RegExp(`#/trip/${id}/stops$`));
  await page.getByRole('tab', { name: 'Map' }).click();
  await page.getByRole('link', { name: 'Plan' }).click();
  await page.getByRole('link', { name: 'Stops' }).click();
  await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('header.topbar').getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('the bars stay put: only the pane scrolls, never the document', async ({ page }) => {
  const { id } = await seed(page);
  await page.goto(`/#/trip/${id}/stops`);
  await expect(page.getByRole('button', { name: 'Stop 40' })).toBeAttached();
  const vp = page.viewportSize()!;
  const top = await page.locator('header.topbar').boundingBox();
  const tabs = await page.locator('nav.tabbar').boundingBox();
  expect(top!.y).toBeCloseTo(0, 0);
  expect(tabs!.y + tabs!.height).toBeCloseTo(vp.height, 0);

  await pane(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.evaluate(() => window.scrollTo(0, 400)); // a stray document scroll
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  expect(await page.locator('header.topbar').boundingBox()).toEqual(top);
  expect(await page.locator('nav.tabbar').boundingBox()).toEqual(tabs);
  expect(await scrollTop(page)).toBeGreaterThan(500);

  // Typing in a field and leaving it puts nothing out of place.
  await page.getByRole('button', { name: 'Stop 40' }).click();
  const name = page.getByLabel('Stop name');
  await name.fill('Stop 40 renamed');
  await name.blur();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator('header.topbar').boundingBox()).toEqual(top);
});

test('no double-tap zoom on controls; pinch zoom is never disabled', async ({ page }) => {
  const { id } = await seed(page, 1);
  await page.goto(`/#/trip/${id}/expenses`);
  const meta = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(meta).not.toMatch(/maximum-scale|user-scalable/);
  for (const sel of ['a.tab', 'button.btn', 'html']) {
    expect(
      await page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).touchAction),
    ).toBe('manipulation');
  }
});

test('the expense sheet is a modal dialog in the top layer, above the bars', async ({ page }) => {
  const { id } = await seed(page, 1);
  await page.goto(`/#/trip/${id}/expenses`);
  await page.getByRole('button', { name: 'Add' }).click();
  const dialog = page.locator('dialog.modal[open]');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.matches(':modal'))).toBe(true);
  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeCloseTo(0, 0);
  expect(box.height).toBeCloseTo(vp.height, 0);
  // Where the tab bar sits, the dialog is what receives the tap.
  const hit = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('dialog'),
    [vp.width / 2, vp.height - 10],
  );
  expect(hit).toBe(true);
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('copying happens inside the tap; a refused copy shows the text to copy by hand', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.copies = [];
    w.refuse = false;
    // A tap's permission lasts while it's handled: mark that window.
    document.addEventListener(
      'click',
      () => {
        w.inTap = true;
        setTimeout(() => (w.inTap = false), 0);
      },
      true,
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.copies.push({ text, inTap: w.inTap === true });
          return w.refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
        },
      },
    });
  });
  const { id } = await seed(page, 1);
  await page.goto(`/#/trip/${id}/prompt`);
  await page.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(page.getByText('Prompt copied')).toBeVisible();
  const [first] = await page.evaluate(() => (window as any).copies);
  expect(first.inTap).toBe(true);
  expect(first.text).toContain('Traveller profile');

  await page.evaluate(() => ((window as any).refuse = true));
  await page.getByRole('button', { name: 'Copy prompt' }).click();
  const sheet = page.locator('dialog.modal[open]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Text to copy')).toHaveValue(/Traveller profile/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});
