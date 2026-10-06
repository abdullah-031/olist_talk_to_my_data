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
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('history opens from the mobile menu', async ({ page }) => {
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
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: /Delete conversation/ })).toHaveCSS(
      'opacity',
      '1',
    );
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await menu.getByRole('link', { name: 'Total revenue?' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByText('R$ 13.6M')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
  });
});

test('a pending question can be stopped and asked again', async ({ page }) => {
  await page.route('**/api/chat', () => new Promise(() => {}));
  await page.goto('/');
  await page.getByRole('textbox').fill('Total revenue?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.thinking')).toBeVisible();
  await page.getByRole('button', { name: 'Stop waiting for the answer' }).click();
  await expect(page.getByText('Stopped waiting for the answer.')).toBeVisible();
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

test('mobile and desktop theme controls share the current choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Dark theme' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('radio', { name: 'Dark theme' })).toBeChecked();
  await page.getByRole('radio', { name: 'System theme' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'System theme' })).toBeChecked();
});

test('numeric answers stay tables and outside images are not loaded', async ({ page }) => {
  const answer =
    'Revenue by month:\n\n| Month | Revenue |\n| --- | --- |\n| 2018-01 | R$ 100.25 |\n| 2018-02 | R$ 200.50 |\n\n![Old image](https://example.com/tracker.png)';
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'image') imageRequests.push(request.url());
  });
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { request_id: 'fixture', conversation_id: 'conv_1', answer } }),
  );
  await page.route('**/api/conversations/conv_1', (route) =>
    route.fulfill({
      json: {
        id: 'conv_1',
        messages: [
          { id: 'm1', role: 'user', content: 'Monthly revenue?' },
          { id: 'm2', role: 'assistant', content: answer },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox').fill('Monthly revenue?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'R$ 200.50' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'View', exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Old image' })).toHaveCount(0);
  await expect(page.getByText('Old image')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'R$ 100.25' })).toBeVisible();
  expect(imageRequests).toEqual([]);
});

test('generated charts and downloads survive reopening a conversation', async ({ page }) => {
  const file = '/api/conversations/conv_chart/files/cntr_1/cfile_1';
  const csv = '/api/conversations/conv_chart/files/cntr_1/cfile_2';
  const answer = `Monthly revenue, delivered orders, excluding freight.\n\n![Monthly revenue](${file})\n\n[Download PNG](${file}?download=true)\n\n[Download CSV](${csv}?download=true)`;
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { request_id: 'fixture', conversation_id: 'conv_chart', answer } }),
  );
  await page.route('**/api/conversations/conv_chart', (route) =>
    route.fulfill({
      json: {
        id: 'conv_chart',
        messages: [
          { id: 'm1', role: 'user', content: 'Chart monthly revenue' },
          { id: 'm2', role: 'assistant', content: answer },
        ],
      },
    }),
  );
  await page.route('**/api/conversations/conv_chart/files/**', (route) => {
    const url = new URL(route.request().url());
    const isCsv = url.pathname === csv;
    return route.fulfill({
      contentType: isCsv ? 'text/csv' : 'image/png',
      headers: url.searchParams.has('download')
        ? {
            'Content-Disposition': `attachment; filename="${isCsv ? 'revenue.csv' : 'revenue.png'}"`,
          }
        : {},
      body: isCsv
        ? 'month,revenue\n2018-01,100.25\n'
        : Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=',
            'base64',
          ),
    });
  });
  await page.goto('/');
  await page.getByRole('textbox').fill('Chart monthly revenue');
  await page.getByRole('button', { name: 'Send question' }).click();
  const image = page.getByRole('img', { name: 'Monthly revenue' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveAttribute(
    'href',
    `${file}?download=true`,
  );
  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
    'href',
    `${csv}?download=true`,
  );
  for (const format of ['PNG', 'CSV']) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: `Download ${format}` }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`revenue.${format.toLowerCase()}`);
    expect(await download.failure()).toBeNull();
  }
  await page.reload();
  await expect(image).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download CSV' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('expired charts show an actionable message', async ({ page }) => {
  const file = '/api/conversations/conv_chart/files/cntr_1/cfile_1';
  await page.route(`**${file}`, (route) => route.fulfill({ status: 404, body: 'Expired' }));
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: {
        request_id: 'fixture',
        conversation_id: 'conv_chart',
        answer: `![Revenue](${file})`,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox').fill('Chart revenue');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('status')).toContainText('Ask for a fresh chart');
  await expect(page.getByRole('img', { name: 'Revenue' })).toHaveCount(0);
});

test('resetting while history loads leaves a usable new conversation', async ({ page }) => {
  await page.route('**/api/conversations/conv_slow', () => new Promise(() => {}));
  await page.goto('/?c=conv_slow');
  await expect(page.getByText('Loading conversation…')).toBeVisible();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: { request_id: 'fixture', conversation_id: 'conv_new', answer: '42 orders.' },
    }),
  );
  await page.getByRole('textbox').fill('Order count?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('42 orders.')).toBeVisible();
  await expect(page).toHaveURL(/\?c=conv_new$/);
});

test('browser navigation while waiting permits a new question', async ({ page }) => {
  await page.route('**/api/conversations/conv_1', (route) =>
    route.fulfill({
      json: { id: 'conv_1', messages: [{ id: 'm1', role: 'user', content: 'Earlier question' }] },
    }),
  );
  await page.route('**/api/chat', () => new Promise(() => {}));
  await page.goto('/?c=conv_1');
  await expect(page.getByText('Earlier question')).toBeVisible();
  await page.getByRole('textbox').fill('Pending question');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('.thinking')).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
  await page.unroute('**/api/chat');
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: { request_id: 'fixture', conversation_id: 'conv_new', answer: 'New answer.' },
    }),
  );
  await page.getByRole('textbox').fill('New question');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('New answer.')).toBeVisible();
  await expect(page).toHaveURL(/\?c=conv_new$/);
});

test('history deletion removes the open conversation', async ({ page }) => {
  await page.route('**/api/conversations', (route) =>
    route.fulfill({ json: [{ id: 'conv_1', title: 'Delete this', created_at: 1 }] }),
  );
  await page.route('**/api/conversations/conv_1', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          json: {
            id: 'conv_1',
            messages: [{ id: 'm1', role: 'user', content: 'Earlier question' }],
          },
        }),
  );
  await page.goto('/?c=conv_1');
  await expect(page.getByText('Earlier question')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete conversation: Delete this' }).click();
  await expect(page.getByRole('link', { name: 'Delete this' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Talk to your data.' })).toBeVisible();
  await expect(page).not.toHaveURL(/\?c=/);
});
