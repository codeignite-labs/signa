import { EntityNotFoundError } from 'typeorm';
import { createUsersServiceFixture } from '../../test/support/user-service.fixture';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { UserConfig } from './entities/user-config.entity';
import { User } from './entities/user.entity';
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('current password');
});
it('updates profile identity fields with normalized email and optional-name clearing', async () => {
  const { service, user, users } = createUsersServiceFixture();
  expect(
    await service.updateProfile({ userId: 'user', input: {} }),
  ).toMatchObject({ first_name: 'First', last_name: 'Last' });
  users.findOne.mockResolvedValue(user);
  expect(
    await service.updateProfile({
      userId: 'user',
      input: {
        email: 'USER@EXAMPLE.TEST',
        first_name: ' New ',
        last_name: ' ',
      },
    }),
  ).toMatchObject({
    email: 'user@example.test',
    first_name: 'New',
    last_name: null,
  });
  users.findOne.mockResolvedValue({ ...user, id: 'other' });
  await expect(
    service.updateProfile({
      userId: 'user',
      input: { email: 'taken@example.test' },
    }),
  ).rejects.toMatchObject({ status: 409 });
  users.findOne.mockResolvedValue(null);
  users.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.updateProfile({ userId: 'user', input: {} }),
  ).rejects.toThrow('write failed');
});
it('validates current password and confirmation before storing a new password hash', async () => {
  const { service, user, users } = createUsersServiceFixture();
  user.encryptedPassword = passwordHash;
  await expect(
    service.updatePassword({
      userId: 'user',
      input: {
        current_password: 'current password',
        password: 'new password',
        password_confirmation: 'mismatch',
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updatePassword({
      userId: 'user',
      input: {
        current_password: 'wrong password',
        password: 'new password',
        password_confirmation: 'new password',
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(users.save).not.toHaveBeenCalled();
  await service.updatePassword({
    userId: 'user',
    input: {
      current_password: 'current password',
      password: 'new password',
      password_confirmation: 'new password',
    },
  });
  expect(await verifyPassword('new password', user.encryptedPassword)).toBe(
    true,
  );
  expect(await verifyPassword('current password', user.encryptedPassword)).toBe(
    false,
  );
  users.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.updatePassword({
      userId: 'user',
      input: {
        current_password: 'new password',
        password: 'third password',
        password_confirmation: 'third password',
      },
    }),
  ).rejects.toThrow('write failed');
});
it('requires the current user to exist for profile and MFA operations', async () => {
  const { service, users } = createUsersServiceFixture();
  users.findOneByOrFail.mockRejectedValueOnce(
    new EntityNotFoundError(User, {}),
  );
  await expect(service.getMfaStatus('missing')).rejects.toMatchObject({
    status: 404,
  });
  users.findOneByOrFail.mockRejectedValueOnce(
    new Error('database unavailable'),
  );
  await expect(service.getMfaStatus('user')).rejects.toThrow(
    'database unavailable',
  );
});
it('starts MFA once, verifies codes before enabling/disabling and clears the disabled secret', async () => {
  const { service, user, users, codes } = createUsersServiceFixture();
  expect(await service.getMfaStatus('user')).toEqual({
    otp_required_for_login: false,
  });
  await expect(
    service.enableMfa({ userId: 'user', otpAttempt: '123456' }),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    await service.disableMfa({ userId: 'user', otpAttempt: '123456' }),
  ).toEqual({ otp_required_for_login: false });
  expect(await service.startMfaSetup('user')).toEqual({
    secret: 'test-secret',
    provisioning_uri: 'otpauth://totp/example',
    otp_required_for_login: false,
  });
  await service.startMfaSetup('user');
  expect(codes.generateAuthenticatorSecret).toHaveBeenCalledTimes(1);
  expect(users.save).toHaveBeenCalledTimes(1);
  codes.verifyAuthenticatorCode.mockReturnValue(false);
  await expect(
    service.enableMfa({ userId: 'user', otpAttempt: 'bad' }),
  ).rejects.toMatchObject({ status: 422 });
  expect(user.otpRequiredForLogin).toBe(false);
  codes.verifyAuthenticatorCode.mockReturnValue(true);
  expect(
    await service.enableMfa({ userId: 'user', otpAttempt: '123456' }),
  ).toEqual({ otp_required_for_login: true });
  codes.verifyAuthenticatorCode.mockReturnValue(false);
  await expect(
    service.disableMfa({ userId: 'user', otpAttempt: 'bad' }),
  ).rejects.toMatchObject({ status: 422 });
  expect(user.otpRequiredForLogin).toBe(true);
  codes.verifyAuthenticatorCode.mockReturnValue(true);
  expect(
    await service.disableMfa({ userId: 'user', otpAttempt: '123456' }),
  ).toEqual({ otp_required_for_login: false });
  expect(user.otpSecret).toBeNull();
});
it('does not disable an already disabled secret and passes account identity to authenticator helpers', async () => {
  const { service, user, codes } = createUsersServiceFixture();
  user.otpSecret = 'existing-secret';
  expect(
    await service.disableMfa({ userId: 'user', otpAttempt: 'ignored' }),
  ).toEqual({ otp_required_for_login: false });
  await service.startMfaSetup('user');
  expect(codes.generateAuthenticatorUri).toHaveBeenCalledWith({
    email: user.email,
    secret: 'existing-secret',
  });
});
it('returns only the configured signature asset when its attachment matches the configured UUID', async () => {
  const { service, userConfigs, storage, attachment } =
    createUsersServiceFixture();
  expect(await service.getProfileAsset('user', 'signature')).toBeNull();
  userConfigs.findOneBy.mockResolvedValue(
    Object.assign(new UserConfig(), { value: 'asset' }),
  );
  expect(await service.getProfileAsset('user', 'signature')).toBeNull();
  storage.findRecordAttachments.mockResolvedValue([
    { ...attachment, uuid: 'other' },
  ]);
  expect(await service.getProfileAsset('user', 'signature')).toBeNull();
  storage.findRecordAttachments.mockResolvedValue([attachment]);
  expect(await service.getProfileAsset('user', 'signature')).toEqual({
    uuid: 'asset',
    filename: 'signature.png',
    content_type: 'image/png',
    url: 'https://files.example.test/signature.png',
  });
  expect(storage.createBlobProxyUrl).toHaveBeenCalledWith(
    attachment.blob,
    3600,
  );
});
it.each(['image/png', 'image/jpeg', 'image/jpg'])(
  'uploads and records %s profile images with user-scoped metadata',
  async (mimetype) => {
    const { service, storage, userConfigs } = createUsersServiceFixture();
    const buffer = Buffer.from('image fixture');
    expect(
      await service.uploadProfileAsset({
        userId: 'user',
        key: 'signature',
        file: { buffer, size: buffer.length, originalname: '', mimetype },
      }),
    ).toMatchObject({ uuid: 'asset' });
    expect(storage.createAttachment).toHaveBeenCalledWith({
      buffer,
      contentType: mimetype,
      filename: 'signature.png',
      name: 'signature',
      recordType: 'User',
      recordId: 'user',
      metadata: {
        analyzed: true,
        identified: true,
        profile_asset: 'signature',
      },
    });
    expect(userConfigs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        key: 'signature',
        value: 'asset',
      }),
    );
  },
);
it('replaces an existing profile asset preference and removes assets/configuration together', async () => {
  const { service, storage, userConfigs } = createUsersServiceFixture();
  const preference = Object.assign(new UserConfig(), { value: 'old' });
  userConfigs.findOneBy.mockResolvedValue(preference);
  const file = {
    buffer: Buffer.from('image'),
    size: 5,
    originalname: 'initials.jpg',
    mimetype: 'image/jpeg',
  };
  await service.uploadProfileAsset({ userId: 'user', key: 'initials', file });
  expect(preference.value).toBe('asset');
  expect(userConfigs.create).not.toHaveBeenCalled();
  expect(await service.deleteProfileAsset('user', 'initials')).toBeNull();
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'User',
    recordId: 'user',
    name: 'initials',
  });
  expect(userConfigs.delete).toHaveBeenCalledWith({
    userId: 'user',
    key: 'initials',
  });
  userConfigs.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.uploadProfileAsset({ userId: 'user', key: 'initials', file }),
  ).rejects.toThrow('write failed');
});
it.each([undefined, '', 'text/plain'])(
  'rejects missing or unsupported image types (%s) before deleting previous assets',
  async (mimetype) => {
    const { service, storage } = createUsersServiceFixture();
    await expect(
      service.uploadProfileAsset({
        userId: 'user',
        key: 'signature',
        file: {
          buffer: Buffer.from('image'),
          size: 5,
          originalname: 'image',
          mimetype,
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.uploadProfileAsset({
        userId: 'user',
        key: 'signature',
        file: {
          buffer: Buffer.alloc(0),
          size: 0,
          originalname: 'image',
          mimetype,
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(storage.deleteRecordAttachments).not.toHaveBeenCalled();
  },
);
