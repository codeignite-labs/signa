import { createHmac } from 'node:crypto';
import {
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook-signatures';
afterEach(() => jest.restoreAllMocks());
it('creates independent high-entropy secrets and signs the raw payload interoperably', () => {
  const first = generateWebhookSecret();
  expect(first).toMatch(/^whsec_/);
  expect(first).not.toBe(generateWebhookSecret());
  expect(Buffer.from(first.slice(6), 'base64')).toHaveLength(24);
  const body = '{"event":"form.completed"}';
  const expected = createHmac('sha256', 'secret')
    .update(`123.${body}`)
    .digest('hex');
  expect(signWebhookPayload({ body, secret: 'secret', timestamp: 123 })).toBe(
    `123.${expected}`,
  );
});
it('rejects tampering, wrong secrets, malformed/length-mismatched headers and out-of-window timestamps', () => {
  const body = '{}',
    secret = 'secret',
    now = 1000;
  const header = signWebhookPayload({ body, secret, timestamp: now });
  expect(verifyWebhookSignature({ body, secret, header, now })).toBe(true);
  for (const timestamp of [now - 300, now + 300])
    expect(
      verifyWebhookSignature({
        body,
        secret,
        header: signWebhookPayload({ body, secret, timestamp }),
        now,
      }),
    ).toBe(true);
  for (const header of [
    '',
    'bad',
    'NaN.signature',
    'Infinity.signature',
    '1000.short',
    signWebhookPayload({ body, secret, timestamp: now - 301 }),
    signWebhookPayload({ body, secret, timestamp: now + 301 }),
  ])
    expect(verifyWebhookSignature({ body, secret, header, now })).toBe(false);
  expect(verifyWebhookSignature({ body: 'changed', secret, header, now })).toBe(
    false,
  );
  expect(verifyWebhookSignature({ body, secret: 'wrong', header, now })).toBe(
    false,
  );
  jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
  expect(
    verifyWebhookSignature({
      body,
      secret,
      header: signWebhookPayload({ body, secret }),
    }),
  ).toBe(true);
});
