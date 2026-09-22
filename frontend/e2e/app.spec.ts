import { expect, test } from '@playwright/test';

const plan = {
  action: 'query',
  message: 'Revenue by month',
  metrics: ['revenue'],
  dimensions: ['month'],
  filters: {
    date_from: '2018-01-01',
    date_to: '2018-12-31',
    category: null,
    customer_state: null,
    seller_state: null,
    status: null,
  },
  sort_by: 'month',
  sort_direction: 'asc',
  limit: 100,
};

test('live warehouse metadata renders with no browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
  await expect(page.getByText('Warehouse connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Warehouse connection' })).toContainText(
    /112[,.]650/,
  );
  await page.getByRole('button', { name: 'Warehouse guide' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('table, chart, SQL, follow-up and reset UI using an explicit API fixture', async ({
  page,
}) => {
  const requests: { question: string; history: unknown[] }[] = [];
  await page.route('**/api/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        request_id: 'browser-fixture',
        answer: 'Showing 2 groups, ordered by month (asc).',
        plan,
        columns: [
          { key: 'month', label: 'Month', format: 'text' },
          { key: 'revenue', label: 'Merchandise revenue', format: 'currency' },
        ],
        rows: [
          { month: '2018-01', revenue: '100.25' },
          { month: '2018-02', revenue: '150.50' },
        ],
        sql: 'SELECT month, SUM(price) AS revenue FROM reviewed_fixture GROUP BY month',
        parameters: [20180101, 20181231, 101],
        truncated: false,
        notes: ['Revenue excludes freight. This is an explicit browser-test fixture.'],
        timings_ms: { planning: 10, database: 5, total: 15 },
        model: 'gpt-4.1-nano',
        usage: {},
      },
    });
  });
  await page.goto('/');
  await page.getByRole('textbox').fill('Show monthly revenue for 2018.');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'R$100.25' })).toBeVisible();
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(page.getByRole('img', { name: /Merchandise revenue by Month/ })).toBeVisible();
  await page.getByText('View query & definitions').click();
  await expect(page.locator('pre')).toContainText('SUM(price)');
  await page.getByRole('textbox').fill('Only delivered orders');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.turn')).toHaveCount(2);
  await expect(page.locator('.thinking')).toHaveCount(0);
  expect(requests[1].history).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.locator('.turn')).toHaveCount(0);
});

test('API errors are displayed and submission can be retried', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'The model service rejected the configured credentials.' },
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox').fill('Total revenue?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the configured credentials');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('mobile layout fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('textbox')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
