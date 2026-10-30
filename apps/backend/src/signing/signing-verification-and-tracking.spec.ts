import { createSigningServiceFixture } from '../../test/support/signing-service.fixture';
import { buildSubmitterEventTrackingParam } from '../submissions/submission-event-tracking';
it('sends and validates a phone number using field country rules and records delivery evidence', async () => {
  const { service, template, submitter, phone, recordedEvents } =
    createSigningServiceFixture();
  template.fields = [
    {
      uuid: 'phone',
      type: 'phone',
      submitter_uuid: 'party',
      validation: { phone_country: ' ke ' },
    },
  ];
  submitter.values = { phone: '254700000001' };
  expect(
    await service.sendPhoneVerification('slug', { field_uuid: 'phone' }),
  ).toEqual({ phone: '+15551234567', status: 'pending' });
  expect(phone.sendCode).toHaveBeenCalledWith('254700000001', 'KE');
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'send_2fa_sms',
      data: { field_uuid: 'phone', phone: '+15551234567' },
    }),
  );
  expect(
    await service.validatePhoneNumber('slug', { field_uuid: 'phone' }),
  ).toEqual({ phone: '+254700000001', valid: true });
  expect(
    await service.validatePhoneNumber('slug', { phone: '+15550001111' }),
  ).toEqual({ phone: '+15550001111', valid: true });
});
it('validates phone code before saving a verified phone/field value and supports phone-only verification', async () => {
  const { service, submitter, phone, recordedEvents } =
    createSigningServiceFixture();
  phone.checkCode.mockResolvedValueOnce({ valid: false, status: 'pending' });
  await expect(
    service.verifyPhoneCode('slug', { code: 'bad', phone: '15550001111' }),
  ).rejects.toMatchObject({ status: 422 });
  expect(recordedEvents.save).not.toHaveBeenCalled();
  expect(
    (
      await service.verifyPhoneCode('slug', {
        code: '123456',
        phone: '15550001111',
        field_uuid: 'phone',
      })
    ).values,
  ).toEqual({ phone: '+15550001111' });
  expect(submitter.phone).toBe('+15550001111');
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'phone_verified',
      data: { field_uuid: 'phone', phone: '+15550001111', status: 'approved' },
    }),
  );
  await service.verifyPhoneCode('slug', { code: '123456' });
  expect(recordedEvents.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: { field_uuid: null, phone: '+15550001111', status: 'approved' },
    }),
  );
});
it.each([
  undefined,
  null,
  false,
  {},
  { phone_country: 42 },
  { phone_country: ' ' },
])(
  'tolerates absent or invalid field country configuration (%s)',
  async (validation) => {
    const { service, template, phone } = createSigningServiceFixture();
    template.fields = [{ uuid: 'phone', submitter_uuid: 'party', validation }];
    await service.validatePhoneNumber('slug', { field_uuid: 'phone' });
    expect(phone.normalizePhone).toHaveBeenCalledWith('+15551234567', null);
  },
);
it('requires a phone when neither explicit input, a field value nor signer contact provides one', async () => {
  const { service, submitter } = createSigningServiceFixture();
  submitter.phone = null;
  submitter.values = { phone: 12345 };
  await expect(
    service.sendPhoneVerification('slug', { field_uuid: 'phone' }),
  ).rejects.toMatchObject({ status: 422 });
});
it('requests email verification delivery and records field-specific start evidence', async () => {
  const { service, events, recordedEvents, submitter } =
    createSigningServiceFixture();
  expect(await service.sendEmailVerification('slug', {})).toEqual({
    email: 'signer@example.test',
    status: 'sent',
  });
  expect(events.emit).toHaveBeenCalledWith('submitter.verification.requested', {
    submitterId: '1',
    accountId: 'tenant',
    locale: null,
  });
  expect(recordedEvents.save).not.toHaveBeenCalled();
  await service.sendEmailVerification('slug', { field_uuid: 'email' });
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'start_verification',
      data: {
        email: 'signer@example.test',
        field_uuid: 'email',
        method: 'email',
      },
    }),
  );
  submitter.email = null;
  await expect(service.sendEmailVerification('slug', {})).rejects.toMatchObject(
    { status: 422 },
  );
});
it('rejects incorrect email codes and writes verified values/audit events only after verification', async () => {
  const { service, submitter, emailCodes, recordedEvents } =
    createSigningServiceFixture();
  emailCodes.verifySubmitterCode.mockReturnValueOnce(false);
  await expect(
    service.verifyEmailCode('slug', { code: 'bad', field_uuid: 'email' }),
  ).rejects.toMatchObject({ status: 422 });
  expect(recordedEvents.save).not.toHaveBeenCalled();
  expect(
    (
      await service.verifyEmailCode('slug', {
        code: '123456',
        field_uuid: 'email',
      })
    ).values,
  ).toEqual({ email: 'signer@example.test' });
  expect(emailCodes.verifySubmitterCode).toHaveBeenLastCalledWith(
    submitter,
    '123456',
  );
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'email_verified',
      data: { email: 'signer@example.test', field_uuid: 'email' },
    }),
  );
  await service.verifyEmailCode('slug', { code: '123456' });
  expect(recordedEvents.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: { email: 'signer@example.test', field_uuid: null },
    }),
  );
  submitter.email = null;
  await expect(
    service.verifyEmailCode('slug', { code: '123456' }),
  ).rejects.toMatchObject({ status: 422 });
});
it('accepts only matching signer/channel tracking tokens and records email/SMS clicks without trusting arbitrary query strings', async () => {
  const { service, submitter, recordedEvents } = createSigningServiceFixture();
  const emailToken = buildSubmitterEventTrackingParam({
    submitterSlug: submitter.slug,
    secret: 'test-secret',
  });
  const smsToken = buildSubmitterEventTrackingParam({
    submitterSlug: submitter.slug,
    eventType: 'click_sms',
    secret: 'test-secret',
  });
  await service.trackEmailClick('slug', undefined);
  await service.trackSmsClick('slug', emailToken);
  await service.trackEmailClick('slug', 'invalid');
  expect(recordedEvents.save).not.toHaveBeenCalled();
  await service.trackEmailClick('slug', emailToken);
  await service.trackSmsClick('slug', smsToken);
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'click_email' }),
  );
  expect(recordedEvents.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'click_sms',
      data: { phone: '+15551234567' },
    }),
  );
});
it('records authenticated tracking clicks on form view, avoids redundant signer writes and preserves optional metadata', async () => {
  const { service, submitter, submitters, recordedEvents } =
    createSigningServiceFixture();
  const trackingParam = buildSubmitterEventTrackingParam({
    submitterSlug: submitter.slug,
    secret: 'test-secret',
  });
  const smsTrackingParam = buildSubmitterEventTrackingParam({
    submitterSlug: submitter.slug,
    eventType: 'click_sms',
    secret: 'test-secret',
  });
  await service.trackFormView('slug', { trackingParam, smsTrackingParam });
  expect(recordedEvents.save).toHaveBeenCalledTimes(3);
  expect(submitters.save).toHaveBeenCalledTimes(1);
  await service.trackFormView('slug');
  expect(submitters.save).toHaveBeenCalledTimes(1);
  await service.trackFormView('slug', { locale: 'fr' });
  expect(submitters.save).toHaveBeenCalledTimes(2);
  expect(submitter.metadata).toMatchObject({
    latest_signing_context: { locale: 'fr' },
  });
});
