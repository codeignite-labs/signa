/* eslint-disable @typescript-eslint/require-await -- Test adapters deliberately implement asynchronous interfaces. */
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  buildTimestampRequest,
  Rfc3161TimestampClient,
} from './rfc3161-timestamp-client';
import {
  parseTimestampResponse,
  validateTimestampToken,
} from './timestamp-validation';
import { createTestTimestampAuthority } from './test-timestamp-authority';
import { fetchPki } from './pki-http';

jest.mock('./pki-http', () => ({ fetchPki: jest.fn() }));

describe('RFC 3161 validation with OpenSSL tokens', () => {
  let tsa: ReturnType<typeof createTestTimestampAuthority>;
  const digest = createHash('sha256').update('signature bytes').digest();
  beforeAll(() => {
    tsa = createTestTimestampAuthority();
  });
  afterAll(() => tsa.dispose());

  it('accepts a real signed token and rejects mismatched nonce, imprint and untrusted CA', async () => {
    const request = buildTimestampRequest(digest);
    const response = tsa.respond(request);
    const { token } = parseTimestampResponse(response, request);
    await expect(
      validateTimestampToken({
        token,
        digest,
        trustedCertificates: [tsa.rootCertificate],
        earliestTime: new Date(),
      }),
    ).resolves.toBeDefined();
    expect(() =>
      parseTimestampResponse(response, buildTimestampRequest(digest)),
    ).toThrow('nonce');
    await expect(
      validateTimestampToken({
        token,
        digest: Buffer.alloc(32),
        trustedCertificates: [tsa.rootCertificate],
      }),
    ).rejects.toThrow('imprint');
    await expect(
      validateTimestampToken({ token, digest, trustedCertificates: [] }),
    ).rejects.toThrow('trusted TSA');
    const corrupted = Buffer.from(token);
    corrupted[corrupted.length - 1] ^= 1;
    await expect(
      validateTimestampToken({
        token: corrupted,
        digest,
        trustedCertificates: [tsa.rootCertificate],
      }),
    ).rejects.toThrow();
  });

  it('returns success only after validating the TSA response and falls back on failure', async () => {
    jest
      .mocked(fetchPki)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementationOnce(
        async (_url, options) =>
          new Response(new Uint8Array(tsa.respond(Buffer.from(options.body!)))),
      );
    const client = new Rfc3161TimestampClient(
      new ConfigService({ PDF_TSA_TRUST_CERTIFICATES: tsa.rootPem }),
    );
    const result = await client.requestTimestampToken({
      digest,
      serverUrls: [
        'https://first.example.com',
        'https://user:secret@second.example.com/?key=secret',
      ],
    });
    expect(result.token).not.toBeNull();
    expect(JSON.stringify(result.attempts)).not.toContain('secret');
    expect(result.url).toBe('https://second.example.com/');
    expect(result.attempts[1]).not.toHaveProperty('token');
    expect(result.attempts.map((item) => item.status)).toEqual([
      'failed',
      'success',
    ]);
  });
});
