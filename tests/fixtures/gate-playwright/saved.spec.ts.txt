import { expect, test } from '@playwright/test';

test('loaded items are saved', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load items' }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-saved', 'true');
});
