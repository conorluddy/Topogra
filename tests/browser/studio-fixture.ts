import { expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

export const appUrl = 'https://landcube.test/';
export const terrainTileUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**';

const analyticsUrl = 'https://www.googletagmanager.com/**';

export async function serveStudio(page: Page, basePath = ''): Promise<void> {
  await routeTerrainTiles(page);
  await page.route(analyticsUrl, (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route(`${appUrl}**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const prefix = `/${basePath}`;

    if (!pathname.startsWith(prefix)) {
      await route.fulfill({ status: 404, body: 'Outside the published site' });

      return;
    }

    const filename = pathname.slice(prefix.length) || 'index.html';

    await route.fulfill({
      body: await readFile(resolve('dist', filename)),
      contentType: getContentType(filename),
    });
  });
}

/** Serves the built site as the hosted origin, so hostname-gated behaviour such as analytics runs. */
export async function serveHostedSite(page: Page): Promise<void> {
  await page.route('https://landcu.be/**', async (route) => {
    const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';

    await route.fulfill({
      body: await readFile(resolve('dist', filename)),
      contentType: getContentType(filename),
    });
  });
}

/** Stylesheets served as HTML are ignored, which leaves the page unstyled and its layout shifting. */
function getContentType(filename: string): string {
  return filename.endsWith('.js')
    ? 'text/javascript'
    : filename.endsWith('.css')
      ? 'text/css'
      : filename.endsWith('.png')
        ? 'image/png'
        : 'text/html';
}

export async function section(page: Page, name: string): Promise<void> {
  const expand = page.getByRole('button', { name: 'Expand controls' });

  if (await expand.isVisible()) {
    await expand.click();
  }

  await page
    .getByRole('navigation', { name: 'Editing section' })
    .getByRole('button', { name, exact: true })
    .click();
}

export async function readDownload(download: Download): Promise<Buffer> {
  const file = await download.path();

  if (!file) {
    throw new Error('Download unavailable.');
  }

  return readFile(file);
}

export async function download(
  page: Page,
  label: string,
): Promise<{ bytes: Buffer; filename: string }> {
  const waiting = page.waitForEvent('download');

  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await waiting;

  return { bytes: await readDownload(result), filename: result.suggestedFilename() };
}

export async function modelDownload(page: Page): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export ↗' }).click();
  const result = await download(page, 'Download STL');

  await page.getByRole('button', { name: 'Close Export', exact: true }).click();

  return result.bytes;
}

/** Startup lazy-loads 3D, then decodes the default location; software WebGL on CI is slow. */
const defaultStudioStartupMs = 20_000;

/** Opens the bare studio URL and waits for its 3D default location. */
export async function openDefaultStudio(page: Page): Promise<void> {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: defaultStudioStartupMs },
  );
  await expect(page.getByRole('status').filter({ hasText: 'Real terrain loaded' })).toBeVisible({
    timeout: defaultStudioStartupMs,
  });
}

/** Switches to 3D and waits until the lazy renderer owns the viewport before anything else runs. */
export async function enter3D(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '3D', exact: true });

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: defaultStudioStartupMs });
  await expect(page.locator('canvas.terrain-3d')).toBeVisible({
    timeout: defaultStudioStartupMs,
  });
}

export async function loadLocation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Coordinates', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Real terrain (loaded|restored)/ }),
  ).toBeVisible();
}

export function stlBounds(bytes: Buffer): number[][] {
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
  const bounds = [
    [Infinity, -Infinity],
    [Infinity, -Infinity],
    [Infinity, -Infinity],
  ];

  for (let triangle = 0; triangle < bytes.readUInt32LE(80); triangle++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = bytes.readFloatLE(84 + triangle * 50 + 12 + vertex * 12 + axis * 4);

        bounds[axis][0] = Math.min(bounds[axis][0], value);
        bounds[axis][1] = Math.max(bounds[axis][1], value);
      }
    }
  }

  return bounds;
}

/** Locations beyond the bundled default download tiles; serve them offline and deterministically. */
async function routeTerrainTiles(page: Page): Promise<void> {
  const tile = new PNG({ width: 256, height: 256 });

  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const encoded = Math.round(
        (Math.sin(x / 35) * 400 + Math.cos(y / 45) * 300 + 500 + 32768) * 256,
      );
      const offset = (y * 256 + x) * 4;

      tile.data[offset] = encoded >> 16;
      tile.data[offset + 1] = (encoded >> 8) & 255;
      tile.data[offset + 2] = encoded & 255;
      tile.data[offset + 3] = 255;
    }
  }

  const body = PNG.sync.write(tile);

  await page.route(terrainTileUrl, (route) =>
    route.fulfill({
      body,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
}
