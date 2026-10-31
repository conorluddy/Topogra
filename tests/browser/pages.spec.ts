import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appUrl, download, enter3D, section, serveHostedSite, serveStudio } from './studio-fixture';

// Software-rendered 3D makes CI boot the studio slowly, and a reload boots it again.
const appBootTimeoutMs = 60_000;

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('GitHub Pages repository subpath loads the studio, lazy 3D, style links and exports', async ({
  page,
}) => {
  await serveStudio(page, 'landcube/');
  const errors: string[] = [];
  const assets: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/assets/')) {
      assets.push(response.url());
      expect(response.ok()).toBe(true);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (url: string) => {
          document.documentElement.dataset.copiedLink = url;

          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(`${appUrl}landcube/?v=1&seed=123&width=320&height=240`);
  await expect(page.getByRole('heading', { name: 'LANDCU.BE Studio' })).toBeVisible();
  await enter3D(page);
  await section(page, 'Model');
  await expect(page.getByLabel('Width (X, mm)', { exact: true })).toHaveValue('150');
  await page.getByRole('button', { name: 'Copy style link', exact: true }).click();
  const copied = await page.locator('html').getAttribute('data-copied-link');

  expect(copied).not.toBeNull();

  if (copied === null) {
    throw new Error('Style link unavailable');
  }

  expect(new URL(copied).pathname).toBe('/landcube/');
  await page.getByRole('button', { name: 'Export ↗' }).click();
  await expect(page.getByAltText('Settled landscape export preview')).toBeVisible();
  const svg = await download(page, 'Download SVG');

  expect(svg.bytes.toString()).toContain('viewBox="0 0 320 240"');
  expect((await download(page, 'Download STL')).bytes.readUInt32LE(80)).toBeGreaterThan(0);
  expect(assets.length).toBeGreaterThanOrEqual(3);
  expect(assets.every((url) => new URL(url).pathname.startsWith('/landcube/assets/'))).toBe(true);
  expect(assets.some((url) => url.includes('/terrain-3d-'))).toBe(true);
  expect(errors).toEqual([]);
});

test('version-one design link exports byte-identical SVG through the shell redesign (REQ-1)', async ({
  page,
}) => {
  // The fixture was exported before the LANDCU.BE port; a mismatch means the renderer changed.
  const fixture = await readFile(resolve('tests/browser/fixtures/seed-123-320x240.svg'));

  await serveStudio(page);
  await page.goto(`${appUrl}?v=1&seed=123&width=320&height=240`);
  await page.getByRole('button', { name: 'Export ↗' }).click();
  const svg = await download(page, 'Download SVG');

  expect(svg.bytes.equals(fixture)).toBe(true);
});

test('analytics loads only on the hosted site and never sees the design-link query', async ({
  page,
}) => {
  const tagRequests: string[] = [];

  await serveStudio(page);
  page.on('request', (request) => {
    if (request.url().includes('googletagmanager.com')) {
      tagRequests.push(request.url());
    }
  });
  await page.goto(`${appUrl}?v=1&seed=123`);
  await page.waitForLoadState('load');
  expect(tagRequests).toEqual([]);

  await page.route('https://www.googletagmanager.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await serveHostedSite(page);
  await page.addInitScript(() => {
    localStorage.setItem('landcube-analytics-consent', 'granted');
  });
  await page.goto('https://landcu.be/?v=1&seed=123');
  await page.getByRole('button', { name: 'New landscape' }).click();
  await expect(page).not.toHaveURL(/seed=123/);
  await page.getByRole('button', { name: 'Copy style link' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from((window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer).some(
          (entry) => Array.from(entry)[1] === 'share_link',
        ),
      ),
    )
    .toBe(true);
  const dataLayer = JSON.stringify(
    await page.evaluate(() =>
      Array.from((window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer, (entry) =>
        Array.from(entry),
      ),
    ),
  );

  expect(dataLayer).toContain('G-09DGBRV9NB');
  expect(dataLayer).toContain('"page_location":"https://landcu.be/"');
  expect(dataLayer).not.toContain('seed=123');
});

test('analytics asks on the hosted site, loads nothing until allowed, and remembers the choice', async ({
  page,
}) => {
  const tagRequests: string[] = [];

  await page.route('https://www.googletagmanager.com/**', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await serveHostedSite(page);
  page.on('request', (request) => {
    if (request.url().includes('googletagmanager.com')) {
      tagRequests.push(request.url());
    }
  });

  await page.goto('https://landcu.be/');
  const dialog = page.getByRole('alertdialog', { name: 'Usage analytics' });

  await expect(dialog).toBeVisible();
  expect(tagRequests).toEqual([]);

  await expect(dialog.getByRole('button', { name: 'No thanks' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Allow analytics' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'No thanks' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Allow analytics' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => tagRequests.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy style link' })).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(dialog).toBeHidden();
});

test('declining analytics loads no tag and is remembered', async ({ page }) => {
  const tagRequests: string[] = [];

  await serveHostedSite(page);
  page.on('request', (request) => {
    if (request.url().includes('googletagmanager.com')) {
      tagRequests.push(request.url());
    }
  });

  await page.goto('https://landcu.be/');
  await page
    .getByRole('alertdialog', { name: 'Usage analytics' })
    .getByRole('button', { name: 'No thanks' })
    .click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Copy style link' })).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByRole('alertdialog', { name: 'Usage analytics' })).toBeHidden();
  expect(tagRequests).toEqual([]);
});
