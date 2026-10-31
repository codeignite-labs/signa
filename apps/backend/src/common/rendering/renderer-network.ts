import { UnprocessableEntityException } from '@nestjs/common';
import type { BrowserContext, Route } from 'playwright';
import { fetchPki } from '../../pdf-signatures/pki-http';

export const rendererContextOptions = {
  javaScriptEnabled: false,
  serviceWorkers: 'block',
} as const;

export const rendererCsp = [
  "default-src 'none'",
  'img-src https: data: blob:',
  "style-src https: 'unsafe-inline'",
  'font-src https: data:',
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const printTemplateCsp =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

const maximumAssetBytes = 5 * 1024 * 1024;
const maximumTotalBytes = 25 * 1024 * 1024;
const maximumAssetRequests = 64;
const networkTimeoutMs = 15000;

type ResourceBudget = {
  deadline: number;
  remainingBytes: number;
  requests: number;
  failed: boolean;
  activeDownloads: number;
  waiting: Array<() => void>;
};

/** Chromium must never connect directly to document-controlled destinations. */
export async function protectRendererNetwork(context: BrowserContext) {
  const budget: ResourceBudget = {
    deadline: Date.now() + networkTimeoutMs,
    remainingBytes: maximumTotalBytes,
    requests: 0,
    failed: false,
    activeDownloads: 0,
    waiting: [],
  };
  context.on('requestfailed', () => {
    budget.failed = true;
  });
  await context.route('**/*', async (route) => {
    try {
      await fulfillPublicAsset(route, budget);
    } catch {
      budget.failed = true;
      // A timeout may dispose the context while a pinned download is finishing.
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
  return {
    assertAllowed(this: void) {
      if (budget.failed)
        throw new UnprocessableEntityException({
          error:
            'Document resources must be available public HTTPS images, styles or fonts within the rendering limits. Use embedded data URI assets for private resources and print headers or footers.',
        });
    },
  };
}

function validateAssetRequest(route: Route, budget: ResourceBudget) {
  const request = route.request();
  const type = request.resourceType();
  const url = new URL(request.url());
  budget.requests += 1;
  if (
    request.method() !== 'GET' ||
    !['image', 'font', 'stylesheet'].includes(type) ||
    url.protocol !== 'https:' ||
    !['', '443'].includes(url.port) ||
    url.username ||
    url.password ||
    budget.requests > maximumAssetRequests
  ) {
    throw new Error('Blocked renderer resource');
  }
  return { url, type };
}

async function fulfillPublicAsset(route: Route, budget: ResourceBudget) {
  const { url, type } = validateAssetRequest(route, budget);
  await acquireDownloadSlot(budget);
  try {
    const timeoutMs = budget.deadline - Date.now();
    if (budget.remainingBytes <= 0 || timeoutMs <= 0)
      throw new Error('Renderer resource budget exhausted');
    const maxBytes = Math.min(maximumAssetBytes, budget.remainingBytes);
    budget.remainingBytes -= maxBytes;
    const response = await fetchPki(url, { timeoutMs, maxBytes });
    const contentType =
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() ?? '';
    if (!response.ok || !isPassiveContentType(type, contentType))
      throw new Error('Invalid renderer asset');
    const body = Buffer.from(await response.arrayBuffer());
    budget.remainingBytes += maxBytes - body.byteLength;
    await route.fulfill({
      status: 200,
      body,
      headers: {
        'content-type': contentType,
        'access-control-allow-origin': '*',
        'x-content-type-options': 'nosniff',
      },
    });
  } finally {
    releaseDownloadSlot(budget);
  }
}

async function acquireDownloadSlot(budget: ResourceBudget) {
  if (budget.activeDownloads < maximumTotalBytes / maximumAssetBytes) {
    budget.activeDownloads += 1;
    return;
  }
  await new Promise<void>((resolve) => budget.waiting.push(resolve));
}

function releaseDownloadSlot(budget: ResourceBudget) {
  const next = budget.waiting.shift();
  if (next) next();
  else budget.activeDownloads -= 1;
}

function isPassiveContentType(type: string, contentType: string) {
  if (type === 'image') return contentType.startsWith('image/');
  if (type === 'stylesheet') return contentType === 'text/css';
  return (
    contentType.startsWith('font/') ||
    [
      'application/font-woff',
      'application/font-sfnt',
      'application/vnd.ms-fontobject',
      'application/octet-stream',
    ].includes(contentType)
  );
}
