import { ConfigService } from '@nestjs/config';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { EmailVerificationCodeService } from './email-verification-code.service';

jest.mock('otplib', () =>
  jest.requireActual<typeof import('otplib')>(
    '../../node_modules/otplib/dist/index.cjs',
  ),
);

afterEach(() => jest.useRealTimers());
it('validates the RFC6238 SHA1 vector through the real authenticator implementation', () => {
  const service = new EmailVerificationCodeService(new ConfigService());
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  expect(
    service.verifyAuthenticatorCode({
      code: '287 082',
      secret,
      at: new Date(59000),
    }),
  ).toBe(true);
  expect(
    service.verifyAuthenticatorCode({
      code: '000001',
      secret,
      at: new Date(59000),
    }),
  ).toBe(false);
});
it('uses the current clock by default for email and authenticator verification', () => {
  jest.useFakeTimers().setSystemTime(new Date(59000));
  const service = new EmailVerificationCodeService(
    new ConfigService({ JWT_SECRET: 'fixture-secret' }),
  );
  const submitter = Object.assign(new Submitter(), {
    email: 'person@example.test',
    slug: 'signer',
  });
  const template = Object.assign(new Template(), { slug: 'template' });
  const code = service.generateSubmitterCode(submitter);
  expect(service.verifySubmitterCode(submitter, code)).toBe(true);
  const templateCode = service.generateTemplateCode(
    template,
    'person@example.test',
  );
  expect(
    service.verifyTemplateCode(template, 'person@example.test', templateCode),
  ).toBe(true);
  expect(
    service.verifyAuthenticatorCode({
      code: '287082',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    }),
  ).toBe(true);
});
it('rejects incomplete email codes and safely normalizes absent recipient identity', () => {
  const service = new EmailVerificationCodeService(
    new ConfigService({ JWT_SECRET: '' }),
  );
  const submitter = Object.assign(new Submitter(), {
    email: null,
    slug: 'signer',
  });
  const at = new Date('2026-01-01T00:00:00Z');
  const code = service.generateSubmitterCode(submitter, at);
  expect(service.verifySubmitterCode(submitter, code, at)).toBe(true);
  expect(service.verifySubmitterCode(submitter, '123', at)).toBe(false);
  expect(service.verifySubmitterCode(submitter, 'letters', at)).toBe(false);
});
it('accepts the previous email OTP period and rejects expired or future codes using real TOTP', () => {
  const service = new EmailVerificationCodeService(
    new ConfigService({ JWT_SECRET: 'fixture-secret' }),
  );
  const recipient = Object.assign(new Submitter(), {
    email: 'person@example.test',
    slug: 'signer',
  });
  const issuedAt = new Date('2026-01-01T00:00:00Z');
  const code = service.generateSubmitterCode(recipient, issuedAt);
  expect(
    service.verifySubmitterCode(
      recipient,
      code,
      new Date(issuedAt.getTime() + 660000),
    ),
  ).toBe(true);
  expect(
    service.verifySubmitterCode(
      recipient,
      code,
      new Date(issuedAt.getTime() + 1260000),
    ),
  ).toBe(false);
  const future = service.generateSubmitterCode(
    recipient,
    new Date(issuedAt.getTime() + 600000),
  );
  expect(service.verifySubmitterCode(recipient, future, issuedAt)).toBe(false);
});
it('creates independent real authenticator secrets and a standards-compatible enrollment URI', () => {
  const service = new EmailVerificationCodeService(new ConfigService());
  const secret = service.generateAuthenticatorSecret();
  expect(secret).not.toBe(service.generateAuthenticatorSecret());
  const uri = new URL(
    service.generateAuthenticatorUri({ email: 'ada@example.test', secret }),
  );
  expect(uri.protocol).toBe('otpauth:');
  expect(uri.host).toBe('totp');
  expect(uri.searchParams.get('secret')).toBe(secret);
  expect(uri.searchParams.get('issuer')).toBe('Signa Docs');
});
