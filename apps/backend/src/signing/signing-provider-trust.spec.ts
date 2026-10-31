import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createSigningServiceFixture } from '../../test/support/signing-service.fixture';
import {
  CreateIdentityVerificationDto,
  CreatePaymentAttemptDto,
} from './dto/signing-request.dto';
it.each(['succeeded', 'processing', 'failed', 'cancelled', 'invalid'])(
  'rejects client-controlled payment provider status %s before writing an attempt',
  async (status) => {
    const { service, template, paymentAttempts, recordedEvents } =
      createSigningServiceFixture();
    template.fields = [
      { uuid: 'payment', submitter_uuid: 'party', type: 'payment' },
    ];
    await expect(
      service.createPaymentAttempt('slug', {
        field_uuid: 'payment',
        status,
        data: { paid: true },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(paymentAttempts.save).not.toHaveBeenCalled();
    expect(recordedEvents.save).not.toHaveBeenCalled();
  },
);
it.each(['verified', 'failed', 'expired', 'invalid'])(
  'rejects client-controlled identity provider status %s before writing verification evidence',
  async (status) => {
    const { service, template, identityVerifications, recordedEvents } =
      createSigningServiceFixture();
    template.fields = [
      { uuid: 'identity', submitter_uuid: 'party', type: 'verification' },
    ];
    await expect(
      service.createIdentityVerification('slug', {
        field_uuid: 'identity',
        status,
        data: { verified: true },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(identityVerifications.save).not.toHaveBeenCalled();
    expect(recordedEvents.save).not.toHaveBeenCalled();
  },
);
it.each([undefined, 'pending'])(
  'allows payment/identity initialization without creating trusted success evidence (status=%s)',
  async (status) => {
    const { service, template, paymentAttempts, identityVerifications } =
      createSigningServiceFixture();
    template.fields = [
      {
        uuid: 'payment',
        submitter_uuid: 'party',
        type: 'payment',
        preferences: { price: '2500', currency: 'usd' },
      },
      { uuid: 'identity', submitter_uuid: 'party', type: 'verification' },
    ];
    expect(
      await service.createPaymentAttempt('slug', {
        field_uuid: 'payment',
        status,
        provider: 'untrusted-provider',
        provider_reference: 'unverified-reference',
        data: { succeeded: true },
      }),
    ).toMatchObject({ status: status ?? 'requires_provider' });
    expect(paymentAttempts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: 'usd',
        completedAt: null,
        accountId: 'tenant',
        submitterId: '1',
      }),
    );
    expect(
      await service.createIdentityVerification('slug', {
        field_uuid: 'identity',
        status,
        method: 'document',
        provider: 'untrusted-provider',
        provider_reference: 'unverified-reference',
        data: { verified: true },
      }),
    ).toEqual({ id: 'verification', status: 'pending' });
    expect(identityVerifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedAt: null,
        status: 'pending',
        accountId: 'tenant',
        submitterId: '1',
      }),
    );
  },
);
it.each([
  ['payment', 'Payment provider confirmation is not configured'],
  [
    'verification',
    'Identity verification provider confirmation is not configured',
  ],
])(
  'rejects legacy success records for required %s fields until a trusted provider exists',
  async (type, error) => {
    const {
      service,
      template,
      submitter,
      paymentAttempts,
      identityVerifications,
      documents,
    } = createSigningServiceFixture();
    template.fields = [
      { uuid: 'provider-field', submitter_uuid: 'party', type },
    ];
    paymentAttempts.existsBy.mockResolvedValue(true);
    identityVerifications.existsBy.mockResolvedValue(true);
    await expect(
      service.updateValues('slug', {
        completed: true,
        values: { 'provider-field': 'verified' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { field_uuid: 'provider-field', error },
    });
    expect(paymentAttempts.existsBy).not.toHaveBeenCalled();
    expect(identityVerifications.existsBy).not.toHaveBeenCalled();
    expect(submitter.completedAt).toBeNull();
    expect(documents.processSubmitterCompletion).not.toHaveBeenCalled();
  },
);
it('exposes DTO contracts that allow pending initialization but reject client success statuses', () => {
  for (const [dto, trustedStatus] of [
    [CreatePaymentAttemptDto, 'succeeded'],
    [CreateIdentityVerificationDto, 'verified'],
  ] as const) {
    expect(
      validateSync(
        plainToInstance(dto, { field_uuid: 'field', status: 'pending' }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(dto, { field_uuid: 'field', status: trustedStatus }),
      ).map((error) => error.property),
    ).toContain('status');
  }
});
it.each([
  [2500, 2500],
  [0, 0],
  ['2500', 2500],
  [' 2500 ', 2500],
  ['', null],
  ['invalid', null],
  [Infinity, null],
  [NaN, null],
  [false, null],
])(
  'preserves configured numeric/string prices (%s) and ignores untrusted amount metadata',
  async (price, amount) => {
    const { service, template, paymentAttempts } =
      createSigningServiceFixture();
    template.fields = [
      {
        uuid: 'payment',
        submitter_uuid: 'party',
        type: 'payment',
        preferences: { price, currency: 'usd' },
      },
    ];
    await service.createPaymentAttempt('slug', {
      field_uuid: 'payment',
      data: { amount: 1, currency: 'forged' },
    });
    expect(paymentAttempts.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount, currency: 'usd', completedAt: null }),
    );
  },
);
it('rejects payment/identity requests targeting missing fields or another role and defaults absent price/currency safely', async () => {
  const { service, template, paymentAttempts, identityVerifications } =
    createSigningServiceFixture();
  template.fields = [
    { uuid: 'other', submitter_uuid: 'other', type: 'payment' },
    { uuid: 'text', submitter_uuid: 'party', type: 'text' },
    { uuid: 'payment', submitter_uuid: 'party', type: 'payment' },
    { uuid: 'identity', submitter_uuid: 'party', type: 'verification' },
  ];
  await expect(
    service.createPaymentAttempt('slug', { field_uuid: 'other' }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.createIdentityVerification('slug', { field_uuid: 'text' }),
  ).rejects.toMatchObject({ status: 422 });
  await service.createPaymentAttempt('slug', { field_uuid: 'payment' });
  expect(paymentAttempts.create).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: null,
      currency: null,
      provider: null,
      providerReference: null,
      data: {},
    }),
  );
  await service.createIdentityVerification('slug', { field_uuid: 'identity' });
  expect(identityVerifications.create).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'kba',
      provider: null,
      providerReference: null,
    }),
  );
});

it('allows completion when provider-backed fields are explicitly optional or read-only', async () => {
  const { service, template, submitter, documents } =
    createSigningServiceFixture();
  template.fields = [
    {
      uuid: 'optional-payment',
      type: 'payment',
      submitter_uuid: 'party',
      required: false,
    },
    {
      uuid: 'readonly-verification',
      type: 'verification',
      submitter_uuid: 'party',
      readonly: true,
    },
  ];
  await service.updateValues('slug', { completed: true, values: {} });
  expect(submitter.completedAt).toBeInstanceOf(Date);
  expect(documents.processSubmitterCompletion).toHaveBeenCalledTimes(1);
});
