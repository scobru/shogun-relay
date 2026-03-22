import { test, expect } from '@playwright/test';

test('graph', async ({ page }) => {
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  await page.goto('http://localhost:3000/dashboard/visual-graph');
  await page.waitForTimeout(1000);
});
