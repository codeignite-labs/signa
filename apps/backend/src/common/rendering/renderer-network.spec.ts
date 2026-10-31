import type { BrowserContext, Route } from 'playwright';
import { protectRendererNetwork } from './renderer-network';
import { fetchPki } from '../../pdf-signatures/pki-http';

jest.mock('../../pdf-signatures/pki-http', () => ({ fetchPki: jest.fn() }));
function setup() {
  let intercept: (route: Route) => Promise<void>;
  let failed: () => void;
  const context = {
    on: jest.fn((_event: string, callback: () => void) => {
      failed = callback;
    }),
    route: jest.fn((_pattern: string, callback: typeof intercept) => {
      intercept = callback;
      return Promise.resolve();
    }),
  };
  return {
    context,
    install: () => protectRendererNetwork(context as unknown as BrowserContext),
    intercept: (route: Route) => intercept(route),
    fail: () => failed(),
  };
}
function resource(
  options: { url?: string; type?: string; method?: string } = {},
) {
  const fulfill = jest.fn().mockResolvedValue(undefined);
  const abort = jest.fn().mockResolvedValue(undefined);
  const route = {
    request: () => ({
      url: () => options.url ?? 'https://assets.example.com/image.png',
      resourceType: () => options.type ?? 'image',
      method: () => options.method ?? 'GET',
    }),
    fulfill,
    abort,
  };
  return { route: route as unknown as Route, fulfill, abort };
}
beforeEach(() => {
  jest
    .mocked(fetchPki)
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(
        new Response('image', { headers: { 'content-type': 'image/png' } }),
      ),
    );
});
afterEach(() => jest.restoreAllMocks());
it.each([
  ['image', 'image/png; charset=utf-8'],
  ['stylesheet', 'text/css'],
  ['font', 'font/woff2'],
  ['font', 'application/font-woff'],
  ['font', 'application/octet-stream'],
])(
  'serves a public %s through the pinned transport with passive response headers (%s)',
  async (type, contentType) => {
    const { install, intercept, context } = setup();
    const guard = await install();
    jest.mocked(fetchPki).mockResolvedValue(
      new Response('asset', {
        headers: {
          'content-type': contentType,
          'set-cookie': 'private=value',
        },
      }),
    );
    const { route, fulfill, abort } = resource({ type });
    await intercept(route);
    guard.assertAllowed();
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(fulfill).toHaveBeenCalledWith({
      status: 200,
      body: Buffer.from('asset'),
      headers: {
        'content-type': contentType.split(';')[0],
        'access-control-allow-origin': '*',
        'x-content-type-options': 'nosniff',
      },
    });
    expect(abort).not.toHaveBeenCalled();
  },
);
it.each([
  { url: 'http://assets.example.com/image.png' },
  { url: 'https://assets.example.com:8443/image.png' },
  { url: 'https://user:secret@assets.example.com/image.png' },
  { url: 'https://:secret@assets.example.com/image.png' },
  { url: 'file:///etc/fixture' },
  { url: 'not a URL' },
  { method: 'POST' },
  { type: 'document' },
  { type: 'script' },
  { type: 'fetch' },
])('rejects unsafe resource request %j before downloading', async (options) => {
  const { install, intercept } = setup();
  const guard = await install();
  const { route, abort, fulfill } = resource(options);
  await intercept(route);
  expect(() => guard.assertAllowed()).toThrow('Unprocessable Entity');
  expect(fetchPki).not.toHaveBeenCalled();
  expect(fulfill).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledWith('blockedbyclient');
});
it.each([
  new Response('unavailable', {
    status: 503,
    headers: { 'content-type': 'image/png' },
  }),
  new Response('active document', { headers: { 'content-type': 'text/html' } }),
  new Response(new Uint8Array([1, 2])),
])('rejects unsuccessful or non-image upstream responses', async (response) => {
  const { install, intercept } = setup();
  const guard = await install();
  jest.mocked(fetchPki).mockResolvedValue(response);
  const { route, abort } = resource();
  await intercept(route);
  expect(() => guard.assertAllowed()).toThrow();
  expect(abort).toHaveBeenCalledTimes(1);
});
it.each(['stylesheet', 'font'])(
  'rejects a mismatched MIME type for %s',
  async (type) => {
    const { install, intercept } = setup();
    const guard = await install();
    await intercept(resource({ type }).route);
    expect(() => guard.assertAllowed()).toThrow();
  },
);
it('stops many small requests at the aggregate count limit', async () => {
  const { install, intercept } = setup();
  const guard = await install();
  for (let index = 0; index < 64; index++) await intercept(resource().route);
  guard.assertAllowed();
  const extra = resource();
  await intercept(extra.route);
  expect(fetchPki).toHaveBeenCalledTimes(64);
  expect(extra.abort).toHaveBeenCalledTimes(1);
  expect(() => guard.assertAllowed()).toThrow();
});
it('bounds aggregate downloaded bytes across successful resources', async () => {
  const { install, intercept } = setup();
  const guard = await install();
  jest.mocked(fetchPki).mockImplementation(() =>
    Promise.resolve(
      new Response(new Uint8Array(5 * 1024 * 1024), {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );
  for (let index = 0; index < 5; index++) await intercept(resource().route);
  guard.assertAllowed();
  await intercept(resource().route);
  expect(fetchPki).toHaveBeenCalledTimes(5);
  expect(() => guard.assertAllowed()).toThrow();
});
it('queues ten simultaneous small resources in bounded waves instead of rejecting valid assets', async () => {
  const { install, intercept } = setup();
  const guard = await install();
  const resolveDownloads: Array<(response: Response) => void> = [];
  jest
    .mocked(fetchPki)
    .mockImplementation(
      () => new Promise<Response>((resolve) => resolveDownloads.push(resolve)),
    );
  const resources = Array.from({ length: 10 }, (_, index) =>
    resource({ url: `https://assets.example.com/image-${index}.png` }),
  );
  const pending = resources.map(({ route }) => intercept(route));
  await Promise.resolve();
  expect(fetchPki).toHaveBeenCalledTimes(5);
  for (const resolve of resolveDownloads.splice(0))
    resolve(
      new Response('small image', { headers: { 'content-type': 'image/png' } }),
    );
  await Promise.all(pending.slice(0, 5));
  expect(fetchPki).toHaveBeenCalledTimes(10);
  for (const resolve of resolveDownloads.splice(0))
    resolve(
      new Response('small image', { headers: { 'content-type': 'image/png' } }),
    );
  await Promise.all(pending);
  guard.assertAllowed();
  for (const { fulfill, abort } of resources) {
    expect(fulfill).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  }
});
it('expires queued requests on the original network deadline after active downloads time out', async () => {
  let now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const { install, intercept } = setup();
  const guard = await install();
  const rejectDownloads: Array<(error: Error) => void> = [];
  jest
    .mocked(fetchPki)
    .mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) =>
          rejectDownloads.push(reject),
        ),
    );
  const pending = Array.from({ length: 6 }, () => intercept(resource().route));
  await Promise.resolve();
  expect(fetchPki).toHaveBeenCalledTimes(5);
  now = 16000;
  for (const reject of rejectDownloads)
    reject(new Error('PKI request timed out'));
  await Promise.all(pending);
  expect(fetchPki).toHaveBeenCalledTimes(5);
  expect(() => guard.assertAllowed()).toThrow();
});
it('shares one network deadline across all assets', async () => {
  let now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const { install, intercept } = setup();
  const guard = await install();
  now = 15000;
  await intercept(resource().route);
  expect(fetchPki).toHaveBeenCalledWith(expect.any(URL), {
    timeoutMs: 1000,
    maxBytes: 5 * 1024 * 1024,
  });
  now = 16000;
  await intercept(resource().route);
  expect(fetchPki).toHaveBeenCalledTimes(1);
  expect(() => guard.assertAllowed()).toThrow();
});
it('fails closed on a browser-level resource failure or a disposed context after transport failure', async () => {
  const { install, intercept, fail } = setup();
  const guard = await install();
  fail();
  expect(() => guard.assertAllowed()).toThrow();
  jest
    .mocked(fetchPki)
    .mockRejectedValue(new Error('private address or redirect'));
  const { route, abort } = resource();
  abort.mockRejectedValue(new Error('context disposed'));
  await expect(intercept(route)).resolves.toBeUndefined();
  expect(() => guard.assertAllowed()).toThrow();
});
