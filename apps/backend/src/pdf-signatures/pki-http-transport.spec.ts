import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fetchPki, isPublicPkiAddress } from './pki-http';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:http', () => ({ request: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
type RequestPort = (
  url: URL,
  options: RequestOptions,
  listener: (response: IncomingMessage) => void,
) => ClientRequest;
const secureRequest =
  httpsRequest as unknown as jest.MockedFunction<RequestPort>;
const plainRequest = httpRequest as unknown as jest.MockedFunction<RequestPort>;
const resolveAddresses = lookup as unknown as jest.MockedFunction<
  (
    host: string,
    options: { all: true },
  ) => Promise<{ address: string; family: number }[]>
>;

function respond(
  options: {
    status?: number;
    chunks?: Buffer[];
    headers?: IncomingMessage['headers'];
    error?: Error;
    hang?: boolean;
  } = {},
) {
  const request = Object.assign(new EventEmitter(), {
    end: jest.fn(),
    destroy: jest.fn((error: Error) => {
      request.emit('error', error);
      request.emit('close');
    }),
  });
  const response = Object.assign(new EventEmitter(), {
    statusCode: options.status ?? 200,
    headers: options.headers ?? {},
  });
  secureRequest.mockImplementation((_url, _options, listener) => {
    request.end.mockImplementation(() => {
      listener(response as unknown as IncomingMessage);
      if (options.hang) return;
      queueMicrotask(() => {
        if (options.error) response.emit('error', options.error);
        else {
          for (const chunk of options.chunks ?? [])
            response.emit('data', chunk);
          response.emit('end');
        }
        request.emit('close');
      });
    });
    return request as unknown as ClientRequest;
  });
  plainRequest.mockImplementation(secureRequest);
  return Object.assign(request, { response });
}

beforeEach(() => {
  jest.resetAllMocks();
  resolveAddresses.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});
afterEach(() => jest.useRealTimers());
it('pins validated DNS into the socket and retains safe download metadata without cookies', async () => {
  const request = respond({
    chunks: [Buffer.from('first'), Buffer.from('second')],
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="agreement.pdf"',
      'set-cookie': ['session=private'],
    },
  });
  const response = await fetchPki('https://public.example/file.pdf', {
    timeoutMs: 1000,
  });
  expect(await response.text()).toBe('firstsecond');
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('content-disposition')).toContain(
    'agreement.pdf',
  );
  expect(response.headers.get('set-cookie')).toBeNull();
  const pin = secureRequest.mock.calls[0][1].lookup as (
    host: string,
    options: unknown,
    callback: (error: null, address: string, family: number) => void,
  ) => void;
  const connected = jest.fn();
  pin('public.example', {}, connected);
  expect(connected).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  expect(resolveAddresses).toHaveBeenCalledTimes(1);
  expect(request.end).toHaveBeenCalledWith(undefined);
});
it.each([
  { addresses: [] },
  {
    addresses: [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
  },
  { addresses: [{ address: '::ffff:169.254.169.254', family: 6 }] },
])(
  'rejects empty, mixed or mapped-private DNS answers before opening a socket (%j)',
  async ({ addresses }) => {
    resolveAddresses.mockResolvedValue(addresses);
    await expect(
      fetchPki('https://public.example', { timeoutMs: 100 }),
    ).rejects.toThrow('public addresses');
    expect(secureRequest).not.toHaveBeenCalled();
  },
);
it.each([301, 302, 307, 308])(
  'rejects redirect %s without requesting its destination',
  async (status) => {
    respond({ status, headers: { location: 'http://127.0.0.1/metadata' } });
    await expect(
      fetchPki('https://public.example', { timeoutMs: 100 }),
    ).rejects.toThrow('redirects');
    expect(secureRequest).toHaveBeenCalledTimes(1);
  },
);
it('destroys the connection while streaming when the byte limit is exceeded', async () => {
  const request = respond({ chunks: [Buffer.from('123'), Buffer.from('456')] });
  await expect(
    fetchPki('https://public.example', { timeoutMs: 100, maxBytes: 5 }),
  ).rejects.toThrow('size limit');
  expect(request.destroy).toHaveBeenCalledTimes(1);
});
it('preserves HTTP PKI POST and its request body contract', async () => {
  respond({ status: 204 });
  const body = new Uint8Array([1, 2]);
  const response = await fetchPki('http://public.example/ocsp', {
    timeoutMs: 100,
    method: 'POST',
    headers: { 'content-type': 'application/ocsp-request' },
    body,
  });
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(plainRequest.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    headers: { 'content-type': 'application/ocsp-request' },
  });
});
it('propagates response and DNS errors without a second request', async () => {
  respond({ error: new Error('broken response') });
  await expect(
    fetchPki('https://public.example', { timeoutMs: 100 }),
  ).rejects.toThrow('broken response');
  resolveAddresses.mockRejectedValue(new Error('no DNS'));
  await expect(
    fetchPki('https://missing.example', { timeoutMs: 100 }),
  ).rejects.toThrow('no DNS');
  expect(secureRequest).toHaveBeenCalledTimes(1);
});
it.each([
  '0.1.2.3',
  '100.64.0.1',
  '192.0.0.8',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::ffff:8.8.8.8',
  'ff02::1',
  '2001:db8::1',
  '192.0.2.1',
  '198.51.100.1',
  '203.0.113.1',
])('blocks reserved/special address %s', (address) => {
  expect(isPublicPkiAddress(address)).toBe(false);
});

it('enforces DNS and socket deadlines and releases their timers', async () => {
  jest.useFakeTimers();
  resolveAddresses.mockReturnValue(new Promise(() => undefined));
  const dnsFailure = expect(
    fetchPki('https://public.example', { timeoutMs: 20 }),
  ).rejects.toThrow('DNS lookup timed out');
  await jest.advanceTimersByTimeAsync(20);
  await dnsFailure;
  expect(secureRequest).not.toHaveBeenCalled();
  resolveAddresses.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  const request = respond({ hang: true });
  const socketFailure = expect(
    fetchPki('https://public.example', { timeoutMs: 20 }),
  ).rejects.toThrow('request timed out');
  await jest.advanceTimersByTimeAsync(20);
  await socketFailure;
  expect(request.destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('rejects oversized data even when the native destroy error arrives after response end', async () => {
  const request = respond({ chunks: [Buffer.from('123'), Buffer.from('456')] });
  request.destroy.mockImplementation((error: Error) => {
    queueMicrotask(() => {
      request.emit('error', error);
      request.emit('close');
    });
  });
  await expect(
    fetchPki('https://public.example', { timeoutMs: 100, maxBytes: 5 }),
  ).rejects.toThrow('size limit');
});

it('fails the deadline before a late response can win the socket abort race', async () => {
  jest.useFakeTimers();
  const request = respond({ hang: true });
  request.destroy.mockImplementation((error: Error) => {
    request.response.emit('end');
    queueMicrotask(() => {
      request.emit('error', error);
      request.emit('close');
    });
  });
  const failure = expect(
    fetchPki('https://public.example', { timeoutMs: 20 }),
  ).rejects.toThrow('request timed out');
  await jest.advanceTimersByTimeAsync(20);
  await failure;
});
