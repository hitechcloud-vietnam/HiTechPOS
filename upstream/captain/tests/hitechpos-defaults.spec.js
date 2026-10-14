import { test, expect } from '@playwright/test';

/* A phone nobody has set up yet: no stored language. */
test.use({ storageState: { cookies: [], origins: [] } });

test('a fresh phone opens in Vietnamese and credits Posnic', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.locator('.brand-subtitle')).toHaveText('HiTechPOS · dựa trên Posnic (AGPL-3.0)');
  await expect(page.locator('#captain-server')).toHaveAttribute('placeholder', 'azure.hitechpos.vn');
});

test('a bare shop code is a HiTechPOS cloud address', async ({ page }) => {
  await page.goto('/index.html');
  const resolved = await page.evaluate(() => ({
    code: POSNIC.server.normalize('azure'),
    origin: POSNIC.constants.ACCOUNT_ORIGIN,
  }));
  expect(resolved).toEqual({ code: 'https://azure.hitechpos.vn/api', origin: 'https://app.hitechpos.vn' });
});
