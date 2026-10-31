import { ConfigService } from '@nestjs/config';
import { UnprocessableEntityException } from '@nestjs/common';
import { fetchPki } from './pki-http';
import {
  parseTimestampServerUrls,
  Rfc3161TimestampClient,
} from './rfc3161-timestamp-client';
import { createTestTimestampAuthority } from './test-timestamp-authority';

jest.mock('./pki-http', () => ({ fetchPki: jest.fn() }));
beforeEach(() => jest.resetAllMocks());

it.each([
  [
    'too many endpoints',
    Array.from({ length: 4 }, (_, i) => `https://tsa${i}.example.com`).join(
      ',',
    ),
    'at most three',
  ],
  [
    'oversized endpoint',
    `https://tsa.example.com/${'a'.repeat(2048)}`,
    'maximum length',
  ],
  ['HTTP credentials', 'http://user:password@tsa.example.com', 'require HTTPS'],
])('rejects %s before making a request', (_name, input, message) => {
  expect(() => parseTimestampServerUrls(input)).toThrow(message);
  expect(fetchPki).not.toHaveBeenCalled();
});

it('rejects unsupported protocols before making a request', () => {
  expect(() => parseTimestampServerUrls('ftp://tsa.example.com')).toThrow(
    UnprocessableEntityException,
  );
  expect(fetchPki).not.toHaveBeenCalled();
});

it('allows explicitly clearing all endpoints but fails server validation with a usable message', async () => {
  expect(parseTimestampServerUrls(null)).toEqual([]);
  expect(parseTimestampServerUrls(' , ')).toEqual([]);
  const client = new Rfc3161TimestampClient(new ConfigService());
  await expect(client.assertTimestampServerWorks(' , ')).rejects.toMatchObject({
    response: { error: 'Invalid timestamp server' },
  });
  expect(fetchPki).not.toHaveBeenCalled();
});

it.each([
  [
    'HTTP failure',
    new Response('temporarily unavailable', { status: 503 }),
    '503',
  ],
  ['empty successful response', new Response(null, { status: 200 }), '200'],
])(
  'rejects %s and exposes its response status in validation',
  async (_name, response, status) => {
    jest.mocked(fetchPki).mockResolvedValue(response);
    const client = new Rfc3161TimestampClient(new ConfigService());
    await expect(
      client.assertTimestampServerWorks('https://tsa.example.com'),
    ).rejects.toMatchObject({
      response: {
        error: `Invalid timestamp server: Unexpected TSA response ${status}`,
      },
    });
  },
);

it('reports transport errors and encodes HTTPS endpoint credentials', async () => {
  jest.mocked(fetchPki).mockRejectedValue(new Error('provider disconnected'));
  const client = new Rfc3161TimestampClient(new ConfigService());
  await expect(
    client.assertTimestampServerWorks(
      'https://user:password@tsa.example.com?key=private',
    ),
  ).rejects.toBeInstanceOf(UnprocessableEntityException);
  expect(fetchPki).toHaveBeenCalledWith(
    new URL('https://tsa.example.com/?key=private'),
    expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/timestamp-query',
        authorization: `Basic ${Buffer.from('user:password').toString('base64')}`,
      },
      timeoutMs: 10000,
      maxBytes: 1024 * 1024,
    }),
  );
});

it('accepts endpoint validation only after a real RFC 3161 response passes trust and imprint validation', async () => {
  const tsa = createTestTimestampAuthority();
  try {
    jest
      .mocked(fetchPki)
      .mockImplementation((_url, options) =>
        Promise.resolve(
          new Response(new Uint8Array(tsa.respond(Buffer.from(options.body!)))),
        ),
      );
    const client = new Rfc3161TimestampClient(
      new ConfigService({
        PDF_TSA_TRUST_CERTIFICATES: tsa.rootPem,
      }),
    );
    await expect(
      client.assertTimestampServerWorks('https://tsa.example.com'),
    ).resolves.toBeUndefined();
  } finally {
    tsa.dispose();
  }
});
