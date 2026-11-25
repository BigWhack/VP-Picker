import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:4410';
const VIEWPORTS = [{ name: 'laptop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];

async function visit(page: Page, url: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tiles\.openfreemap|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForTimeout(500);
  const [scrollW, innerW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW, 'no horizontal scroll').toBeLessThanOrEqual(innerW);
  expect(errors, 'no console errors').toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Today shows the headline and recovery score', async ({ page }) => {
      await visit(page, `${BASE}/`);
      await expect(page.locator('h1.headline')).toContainText(/recover|Not enough data/);
      await expect(page.getByRole('img', { name: /Recovery \d+ out of 100/ })).toBeVisible();
    });

    for (const path of ['/sleep', '/heart', '/activity', '/workouts', '/trends', '/settings']) {
      test(`${path} loads`, async ({ page }) => { await visit(page, `${BASE}${path}`); });
    }

    test('a workout detail page loads', async ({ page, request }) => {
      const { items } = await (await request.get(`${BASE}/api/workouts?sport=run`)).json();
      await visit(page, `${BASE}/workouts/${encodeURIComponent(items[0].id)}`);
      await expect(page.getByTestId('splits')).toBeVisible();
    });

    test('an empty database shows the setup checklist', async ({ page }) => {
      await visit(page, 'http://localhost:4411/');
      await expect(page.getByText('Setup checklist')).toBeVisible();
    });
  });
}
