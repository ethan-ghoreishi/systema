import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Multi-city maps and covers. Map tiles are blocked (offline-safe); markers
// and lines are what matter. Synthetic places only.

async function seedTwoCities(page: Page): Promise<string> {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await page.goto('/');
  return page.evaluate(async () => {
    const trips = '/src/lib/trips.ts';
    const db = '/src/lib/db.ts';
    const { createTrip, addCity, updateTrip } = await import(/* @vite-ignore */ trips);
    const { db: d } = await import(/* @vite-ignore */ db);
    const id = await createTrip('custom');
    await updateTrip(id, { status: 'done', journalText: 'A short journal.' });
    const blq = await addCity(id, 'Bologna', 'EUR', {
      arrival: '2026-10-16T09:00',
      departure: '2026-10-16T19:00',
    });
    const bcn = await addCity(id, 'Barcelona', 'EUR', {
      arrival: '2026-10-16T21:00',
      departure: '2026-10-17T21:00',
      sleep: 'hotel',
    });
    const stop = (name: string, cityId: string, lat: number, lng: number, order: number) => ({
      id: `${name}-${order}`.replace(/\s/g, ''),
      tripId: id,
      cityId,
      name,
      notes: '',
      checklist: [],
      visited: false,
      lat,
      lng,
      order,
      createdAt: order,
    });
    await d.stops.bulkAdd([
      stop('Archiginnasio', blq, 44.4935, 11.3431, 0),
      stop('Piazza Maggiore', blq, 44.4938, 11.3426, 1),
      stop('Due Torri', blq, 44.4943, 11.3467, 2),
      stop('Sagrada Família', bcn, 41.4036, 2.1744, 3),
      stop('Casa Milà', bcn, 41.3953, 2.1619, 4),
    ]);
    return id;
  });
}

async function pinsInsideCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.map-canvas')!.getBoundingClientRect();
    return [...document.querySelectorAll('.map-pin')].every((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= canvas.left &&
        r.right <= canvas.right &&
        r.top >= canvas.top &&
        r.bottom <= canvas.bottom
      );
    });
  });
}

test('the map shows one city at a time, numbered within it, and transfers apart', async ({
  page,
}) => {
  const id = await seedTwoCities(page);
  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('tab', { name: 'Map' }).click();

  const pins = page.locator('.map-pin');
  await expect(pins).toHaveText(['1', '2', '3']); // Bologna only
  expect(await pinsInsideCanvas(page)).toBe(true);
  await expect(page.locator('path.map-route')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Barcelona' }).click();
  await expect(pins).toHaveText(['1', '2']); // numbering starts again
  // Refitted: the Barcelona pins are in view, though Bologna was framed before.
  await expect.poll(() => pinsInsideCanvas(page)).toBe(true);

  await page.getByRole('tab', { name: 'Transfers' }).click();
  await expect(pins).toHaveCount(0);
  await expect(page.locator('.map-city')).toHaveText(['Bologna', 'Barcelona']);
  await expect(page.locator('path.map-transfer')).toHaveCount(1);
  await expect(page.locator('path.map-route')).toHaveCount(0); // never a walking line across countries
  await expect(page.getByText('Straight lines show the sequence, not a route.')).toBeVisible();

  // The journal map is the same, and stays still until asked.
  await page.getByRole('link', { name: 'Plan' }).click();
  await expect(page.getByRole('tab', { name: 'Journal' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Tap to explore the map' })).toBeVisible();
  await expect(page.locator('.journal-map .map-pin')).toHaveCount(3);
});

test('a multi-city cover is a journey card, not a continent-wide sketch', async ({ page }) => {
  const id = await seedTwoCities(page);
  await page.goto('/#/');
  const cover = page.locator('.trip-card--past .trip-cover');
  await expect(cover).toHaveAttribute('data-cover', 'journey');
  await expect(cover).toContainText('BOL·BAR');

  await page.goto(`/#/trip/${id}/edit`);
  const big = page.locator('.trip-cover--cover');
  await expect(big).toContainText('Bologna → Barcelona');
  await expect(big).toContainText('16–17 Oct');
  await expect(big).toContainText('Bologna, day → Barcelona, 1 night');
  // The broad map remains, as an explicit overview.
  await page.getByRole('button', { name: 'Route overview' }).click();
  await expect(big).toHaveAttribute('data-cover', 'sketch');
});
