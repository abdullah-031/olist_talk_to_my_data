import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', configured: true, agent: 'olist-agent' } }),
  );
  await page.route('**/api/conversations', (route) => route.fulfill({ json: [] }));
});

test('home page renders with no browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
  await expect(page.getByText('olist-agent')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('markdown answers, follow-ups in the Foundry conversation and reset', async ({ page }) => {
  const requests: { question: string; conversation_id: string | null }[] = [];
  await page.route('**/api/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        request_id: 'browser-fixture',
        conversation_id: 'conv_1',
        answer: 'Revenue by month:\n\n| Month | Revenue |\n| --- | --- |\n| 2018-01 | R$ 100.25 |',
      },
    });
  });
  await page.goto('/');
  await page.getByRole('textbox').fill('Show monthly revenue for 2018.');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('cell', { name: 'R$ 100.25' })).toBeVisible();
  await page.getByRole('textbox').fill('Only delivered orders');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.turn')).toHaveCount(2);
  await expect(page.locator('.thinking')).toHaveCount(0);
  expect(requests).toEqual([
    { question: 'Show monthly revenue for 2018.', conversation_id: null },
    { question: 'Only delivered orders', conversation_id: 'conv_1' },
  ]);
  await expect(page).toHaveURL(/\?c=conv_1$/);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.locator('.turn')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?c=/);
});

test('past conversations are listed and reopened from Foundry', async ({ page }) => {
  await page.route('**/api/conversations', (route) =>
    route.fulfill({
      json: [
        { id: 'conv_1', title: 'Total revenue?', created_at: 1 },
        { id: 'conv_2', title: 'Top sellers', created_at: 0 },
      ],
    }),
  );
  await page.route('**/api/conversations/conv_1', (route) =>
    route.fulfill({
      json: {
        id: 'conv_1',
        messages: [
          { id: 'm1', role: 'user', content: 'Total revenue?' },
          { id: 'm2', role: 'assistant', content: 'Total revenue is **R$ 13.6M**.' },
        ],
      },
    }),
  );
  const requests: { question: string; conversation_id: string | null }[] = [];
  await page.route('**/api/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: { request_id: 'fixture', conversation_id: 'conv_1', answer: 'R$ 7.4M' },
    });
  });
  await page.goto('/');
  const history = page.getByRole('navigation', { name: 'Conversation history' });
  await history.getByRole('link', { name: 'Total revenue?' }).click();
  await expect(page).toHaveURL(/\?c=conv_1$/);
  await expect(page.locator('.turn')).toHaveCount(1);
  await expect(page.getByText('R$ 13.6M')).toBeVisible();
  await expect(history.getByRole('link', { name: 'Total revenue?' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('textbox').fill('Only 2018');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.turn')).toHaveCount(2);
  expect(requests).toEqual([{ question: 'Only 2018', conversation_id: 'conv_1' }]);

  await page.reload();
  await expect(page.getByText('R$ 13.6M')).toBeVisible();
});

test('a missing conversation link shows a message', async ({ page }) => {
  await page.route('**/api/conversations/conv_gone', (route) =>
    route.fulfill({
      status: 404,
      json: { error: 'Conversation not found. It may have been deleted.' },
    }),
  );
  await page.goto('/?c=conv_gone');
  await expect(page.getByRole('alert')).toContainText('Conversation not found');
  await expect(page).not.toHaveURL(/\?c=/);
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
});

test('API errors are displayed and submission can be retried', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'The backend could not authenticate to Microsoft Foundry.' },
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox').fill('Total revenue?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert')).toContainText('could not authenticate');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('unconfigured backend shows a setup message', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', configured: false, agent: null } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('FOUNDRY_PROJECT_ENDPOINT');
});

test('mobile layout fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('textbox')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('history opens in a drawer', async ({ page }) => {
    await page.route('**/api/conversations', (route) =>
      route.fulfill({ json: [{ id: 'conv_1', title: 'Total revenue?', created_at: 1 }] }),
    );
    await page.route('**/api/conversations/conv_1', (route) =>
      route.fulfill({
        json: {
          id: 'conv_1',
          messages: [
            { id: 'm1', role: 'user', content: 'Total revenue?' },
            { id: 'm2', role: 'assistant', content: 'Total revenue is **R$ 13.6M**.' },
          ],
        },
      }),
    );
    await page.goto('/');
    const history = page.getByRole('navigation', { name: 'Conversation history' });
    await expect(history).toBeHidden();
    await page.getByRole('button', { name: 'Open sidebar' }).tap();
    await expect(page.getByRole('button', { name: 'Close sidebar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeFocused();

    await page.getByRole('button', { name: 'Open sidebar' }).tap();
    // Touch screens have no hover, so the delete button must not depend on it.
    await expect(
      history.getByRole('button', { name: 'Delete conversation: Total revenue?' }),
    ).toHaveCSS('opacity', '1');
    await history.getByRole('link', { name: 'Total revenue?' }).tap();
    await expect(history).toBeHidden();
    await expect(page.getByText('R$ 13.6M')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
  });
});

test('numeric tables render as a chart with a table view', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: {
        request_id: 'fixture',
        conversation_id: 'conv_1',
        answer:
          '| State | Orders | Revenue |\n| --- | --- | --- |\n| SP | 41,746 | R$ 5,998,226.96 |\n| RJ | 12,852 | R$ 2,144,379.69 |\n| MG | 11,635 | R$ 1,872,257.26 |',
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Which states have the most orders/ }).click();
  const chart = page.getByRole('list', { name: 'Orders by State' });
  await expect(chart.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Revenue' }).click();
  await expect(page.getByRole('list', { name: 'Revenue by State' })).toContainText(
    'R$ 5,998,226.96',
  );
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('cell', { name: 'R$ 2,144,379.69' })).toBeVisible();
});

test('a pending question can be stopped and asked again', async ({ page }) => {
  await page.route('**/api/chat', () => new Promise(() => {}));
  await page.goto('/');
  await page.getByRole('textbox').fill('Total revenue?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.thinking')).toBeVisible();
  await page.getByRole('button', { name: 'Stop waiting for the answer' }).click();
  await expect(page.getByText('Stopped before the agent answered.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask again' })).toBeEnabled();
});

test('theme can be pinned and persists across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark theme' })).toBeChecked();
});
