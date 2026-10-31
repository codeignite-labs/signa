import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { SigningController } from './signing.controller';
import { SubmitterTrackingController } from './submitter-tracking.controller';
import { SigningService } from './signing.service';
import {
  createControllerFixture,
  serviceSpies,
} from '../test/controller-fixture';
const service = serviceSpies([
  'getSigningForm',
  'getFieldValue',
  'uploadAttachment',
  'updateValues',
  'decline',
  'delegate',
  'resubmit',
  'sendPhoneVerification',
  'validatePhoneNumber',
  'verifyPhoneCode',
  'sendEmailVerification',
  'verifyEmailCode',
  'createPaymentAttempt',
  'createIdentityVerification',
  'getDownload',
  'trackEmailClick',
  'trackSmsClick',
  'trackFormView',
]);
let app: INestApplication<Server>;
beforeAll(async () => {
  app = await createControllerFixture(
    [SigningController, SubmitterTrackingController],
    [{ provide: SigningService, useValue: service }],
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => jest.clearAllMocks());
it.each([true, false])(
  'records signing locale with explicit override=%s and both tracking tokens',
  async (override) => {
    const call = request(app.getHttpServer())
      .get('/api/signing/public-signer')
      .query({ t: 'email-token', c: 'sms-token' })
      .set('Accept-Language', 'fr-FR')
      .set('X-Signa-Timezone', 'Africa/Nairobi')
      .set('User-Agent', 'Android-WebView');
    if (override) call.set('X-Signa-Locale', 'en-KE');
    await call.expect(200);
    expect(service.getSigningForm).toHaveBeenCalledWith(
      'public-signer',
      expect.objectContaining({
        locale: override ? 'en-KE' : 'fr-FR',
        timezone: 'Africa/Nairobi',
        trackingParam: 'email-token',
        smsTrackingParam: 'sms-token',
        ua: 'Android-WebView',
        ip: expect.any(String) as unknown,
      }),
    );
  },
);
it('preserves autocomplete field and pagination identifiers', async () => {
  await request(app.getHttpServer())
    .get('/api/signing/public-signer/values')
    .query({ field_uuid: 'field-2', after: 'cursor-3' })
    .expect(200);
  expect(service.getFieldValue).toHaveBeenCalledWith(
    'public-signer',
    'field-2',
    'cursor-3',
  );
});
it('binds uploaded attachment bytes and the asset type to the public signer', async () => {
  const buffer = Buffer.from('synthetic-signature');
  await request(app.getHttpServer())
    .post('/api/signing/public-signer/attachments')
    .field('type', 'signature')
    .attach('file', buffer, 'signature.png')
    .expect(201);
  expect(service.uploadAttachment).toHaveBeenCalledWith(
    'public-signer',
    expect.objectContaining({ buffer, originalname: 'signature.png' }),
    'signature',
  );
});
it('keeps ordinary value updates distinct from forced completion', async () => {
  const body = { values: { 'field-2': 'Signed' }, completed: false };
  await request(app.getHttpServer())
    .put('/api/signing/public-signer/values')
    .set('User-Agent', 'Signa-Test')
    .send(body)
    .expect(200);
  expect(service.updateValues).toHaveBeenLastCalledWith(
    'public-signer',
    body,
    expect.objectContaining({
      ua: 'Signa-Test',
      ip: expect.any(String) as unknown,
    }),
  );
  await request(app.getHttpServer())
    .post('/api/signing/public-signer/complete')
    .send(body)
    .expect(201);
  expect(service.updateValues).toHaveBeenLastCalledWith(
    'public-signer',
    { ...body, completed: true },
    expect.any(Object),
  );
});
it.each([
  ['decline', 'decline', { reason: 'Incorrect document' }],
  ['delegate', 'delegate', { email: 'delegate@example.test' }],
  [
    'phone-verification/send',
    'sendPhoneVerification',
    { phone: '+254700000000' },
  ],
  ['phone-verification/check', 'verifyPhoneCode', { code: '123456' }],
  [
    'email-verification/send',
    'sendEmailVerification',
    { email: 'signer@example.test' },
  ],
  ['email-verification/check', 'verifyEmailCode', { code: '123456' }],
  [
    'payment-attempts',
    'createPaymentAttempt',
    { field_uuid: 'payment', status: 'pending' },
  ],
  [
    'identity-verifications',
    'createIdentityVerification',
    { field_uuid: 'identity', status: 'pending' },
  ],
] as const)(
  'binds public signing action %s and derives provenance from HTTP headers',
  async (path, method, body) => {
    await request(app.getHttpServer())
      .post(`/api/signing/public-signer/${path}`)
      .set('User-Agent', 'Signa-Test')
      .send(body)
      .expect(201);
    expect(service[method]).toHaveBeenCalledWith(
      'public-signer',
      body,
      expect.objectContaining({
        ua: 'Signa-Test',
        ip: expect.any(String) as unknown,
      }),
    );
  },
);
it('binds resubmission, phone validation and download to the requested public signer', async () => {
  await request(app.getHttpServer())
    .post('/api/signing/public-signer/resubmit')
    .expect(201);
  expect(service.resubmit).toHaveBeenCalledWith(
    'public-signer',
    expect.objectContaining({ ip: expect.any(String) as unknown }),
  );
  await request(app.getHttpServer())
    .post('/api/signing/public-signer/phone-verification/validate')
    .send({ phone: '+254700000000' })
    .expect(201);
  expect(service.validatePhoneNumber).toHaveBeenCalledWith('public-signer', {
    phone: '+254700000000',
  });
  await request(app.getHttpServer())
    .get('/api/signing/public-signer/download')
    .expect(200);
  expect(service.getDownload).toHaveBeenCalledWith('public-signer');
});
it.each([
  ['email', 't', 'trackEmailClick'],
  ['sms', 'c', 'trackSmsClick'],
] as const)(
  'preserves the %s tracking token while returning the empty tracking response',
  async (kind, key, method) => {
    await request(app.getHttpServer())
      .post(`/api/submitter_${kind}_clicks`)
      .set('User-Agent', 'Signa-Test')
      .send({ submitter_slug: 'public-signer', [key]: 'tracking-token' })
      .expect(201, {});
    expect(service[method]).toHaveBeenCalledWith(
      'public-signer',
      'tracking-token',
      expect.objectContaining({
        ua: 'Signa-Test',
        ip: expect.any(String) as unknown,
      }),
    );
  },
);
it('records public form-view provenance without depending on a workspace session', async () => {
  await request(app.getHttpServer())
    .post('/api/submitter_form_views')
    .set('User-Agent', 'Signa-Test')
    .send({ submitter_slug: 'public-signer' })
    .expect(201, {});
  expect(service.trackFormView).toHaveBeenCalledWith(
    'public-signer',
    expect.objectContaining({
      ua: 'Signa-Test',
      ip: expect.any(String) as unknown,
    }),
  );
});
