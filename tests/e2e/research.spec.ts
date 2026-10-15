import { test, expect } from './fixtures';

// City-by-city research and visit anchors. Synthetic plans only.

const bologna = `# Bologna

## Route

### Archiginnasio
- The old university's seat.
Anchor: Start in the Anatomical Theatre.
Minimum visit: 15 minutes: the theatre, then the stair.
Look for: coats of arms; the skinless statues; the canopy.
Stretch: the Stabat Mater hall.
Exit rule: skip the corridors.
- [ ] Count the coats of arms on one bay
Location: 44.4935, 11.3431

### Piazza Maggiore
- The civic stage.
Location: 44.4938, 11.3426
`;
const barcelona = `## Route

### Sagrada Família
- A cathedral still being built.
Location: 41.4036, 2.1744
`;

test('research one city at a time, paste each answer, and see its anchors', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).copies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => ((window as any).copies.push(t), Promise.resolve()),
      },
    });
  });
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const path = '/src/lib/trips.ts';
    const { createTrip, applyStopoverScenario } = await import(/* @vite-ignore */ path);
    const id = await createTrip('two-city');
    await applyStopoverScenario(
      id,
      1,
      { name: 'Bologna', currency: 'EUR' },
      { name: 'Barcelona', currency: 'EUR' },
    );
    return id;
  });
  await page.goto(`/#/trip/${id}/prompt`);
  await expect(page.getByText('not researched yet')).toHaveCount(2);

  await page.getByRole('button', { name: 'Research Bologna' }).click();
  await expect(page.getByRole('status')).toContainText('Bologna prompt copied');
  const [prompt] = await page.evaluate(() => (window as any).copies);
  expect(prompt).toContain('City: **Bologna**');
  expect(prompt).not.toContain('City: **Barcelona**');

  await page.getByRole('button', { name: 'Paste Bologna plan' }).click();
  await page.getByLabel('Plan text').fill(bologna);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText(
    "Bologna's plan saved, and 2 stops added to Stops.",
  );
  await expect(page.getByText('plan in · 2 stops')).toBeVisible();

  await page.getByRole('button', { name: 'Paste Barcelona plan' }).click();
  await page.getByLabel('Plan text').fill(barcelona);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText("Barcelona's plan saved, and 1 stop added");

  const plan = await page.evaluate(async (id) => {
    const path = '/src/lib/db.ts';
    const { db } = await import(/* @vite-ignore */ path);
    return (await db.trips.get(id)).planText as string;
  }, id);
  expect(plan.indexOf('# Bologna')).toBeLessThan(plan.indexOf('# Barcelona'));

  await page.goto(`/#/trip/${id}/stops`);
  await page.getByRole('button', { name: /Archiginnasio/ }).click();
  const anchor = page.getByRole('region', { name: 'Visit anchor' });
  await expect(anchor).toContainText('Begin: Start in the Anatomical Theatre.');
  await expect(anchor).toContainText('Minimum visit: 15 minutes');
  await expect(anchor.getByRole('listitem')).toHaveCount(3);
  await expect(anchor).toContainText('Can skip: skip the corridors.');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    "- The old university's seat.",
  );
});
