import { test, expect } from '@playwright/test';

test.describe('Settings page', () => {
	test('settings page renders with config', async ({ page }) => {
		await page.route('**/api/config', (route) =>
			route.fulfill({
				json: { appMode: 'client', serverUrl: 'http://localhost:9000' }
			})
		);
		await page.goto('/settings');
		await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
		await expect(page.getByText('http://localhost:9000')).toBeVisible();
	});
});
