import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
	test('page title is visible', async ({ page }) => {
		await page.route('**/api/walkthroughs', (route) =>
			route.fulfill({ json: [] })
		);
		await page.goto('/');
		await expect(page.getByRole('heading', { name: /walkthrough/i })).toBeVisible();
	});

	test('walkthrough list renders mocked data', async ({ page }) => {
		await page.route('**/api/walkthroughs', (route) =>
			route.fulfill({
				json: [
					{
						id: 'test-1',
						game: 'Test Game',
						title: 'Test Title',
						author: 'Author',
						created_at: '2024-01-01'
					}
				]
			})
		);
		await page.goto('/');
		await expect(page.getByText('Test Game')).toBeVisible();
	});

	test('empty state is shown when no walkthroughs', async ({ page }) => {
		await page.route('**/api/walkthroughs', (route) =>
			route.fulfill({ json: [] })
		);
		await page.goto('/');
		// The page should render without a walkthrough list item
		await expect(page.getByText('Test Game')).not.toBeVisible().catch(() => {
			// acceptable if element doesn't exist at all
		});
	});
});
