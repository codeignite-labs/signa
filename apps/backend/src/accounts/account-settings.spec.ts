import { ConfigService } from '@nestjs/config';
import { DataSource, EntityNotFoundError, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { AccountsService } from './accounts.service';
import { accountPreferenceDefinitions } from './account-preferences';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';
function setup() {
  const account: Account = Object.assign(new Account(), {
    id: 'tenant',
    name: 'Example',
    timezone: 'UTC',
    locale: 'en',
    archivedAt: null,
  });
  const user: User = Object.assign(new User(), {
    id: 'user',
    accountId: 'tenant',
    email: 'owner@example.test',
    lockedAt: null,
  });
  const accounts = {
    findOneByOrFail: jest.fn().mockResolvedValue(account),
    merge: jest.fn((current: Account, patch: Partial<Account>) =>
      Object.assign(current, patch),
    ),
    save: jest.fn((current: Account) => Promise.resolve(current)),
  };
  const configs = {
    find: jest.fn<Promise<AccountConfig[]>, [unknown]>().mockResolvedValue([]),
    findOne: jest
      .fn<Promise<AccountConfig | null>, [unknown]>()
      .mockResolvedValue(null),
    create: jest.fn((input: Partial<AccountConfig>) =>
      Object.assign(new AccountConfig(), input),
    ),
    save: jest.fn((input: AccountConfig | AccountConfig[]) =>
      Promise.resolve(input),
    ),
    remove: jest.fn().mockResolvedValue([]),
  };
  const users = {
    findOneByOrFail: jest.fn().mockResolvedValue(user),
    save: jest.fn().mockResolvedValue(user),
  };
  const mail = {
    sendSmtpSuccessfulSetup: jest.fn().mockResolvedValue({ status: 'sent' }),
  };
  const storage = {
    findRecordAttachments: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    deleteRecordAttachments: jest.fn().mockResolvedValue(undefined),
    createBlobProxyUrl: jest
      .fn()
      .mockReturnValue('https://files.example.test/logo.png'),
  };
  const service = new AccountsService(
    accounts as unknown as Repository<Account>,
    configs as unknown as Repository<AccountConfig>,
    {} as Repository<AccountLinkedAccount>,
    users as unknown as Repository<User>,
    {} as Repository<EncryptedConfig>,
    {} as DataSource,
    storage as unknown as StorageService,
    new ConfigService(),
    mail as unknown as MailService,
    {} as PdfSignatureService,
    {} as PdfTrustRootService,
  );
  return { service, accounts, account, configs, users, user, mail, storage };
}
function config(key: string, value: unknown) {
  return Object.assign(new AccountConfig(), {
    accountId: 'tenant',
    key,
    value,
  });
}
it('reads account settings and persists partial updates while preserving unspecified values', async () => {
  const { service, accounts } = setup();
  expect(await service.getAccount('tenant')).toMatchObject({
    id: 'tenant',
    name: 'Example',
    timezone: 'UTC',
    locale: 'en',
    archived_at: null,
  });
  expect(await service.updateAccount('tenant', {})).toMatchObject({
    name: 'Example',
    timezone: 'UTC',
    locale: 'en',
  });
  expect(
    await service.updateAccount('tenant', {
      name: 'Updated',
      locale: 'fr',
      timezone: 'Europe/Paris',
    }),
  ).toMatchObject({ name: 'Updated', locale: 'fr', timezone: 'Europe/Paris' });
  accounts.save.mockRejectedValue(new Error('database unavailable'));
  await expect(
    service.updateAccount('tenant', { name: 'Not saved' }),
  ).rejects.toThrow('database unavailable');
});
it('returns not found for missing accounts and users and retains unexpected lookup errors', async () => {
  const { service, accounts, users } = setup();
  accounts.findOneByOrFail.mockRejectedValueOnce(
    new EntityNotFoundError(Account, {}),
  );
  await expect(service.getAccount('foreign')).rejects.toMatchObject({
    status: 404,
  });
  accounts.findOneByOrFail.mockRejectedValueOnce(new Error('offline'));
  await expect(service.getAccount('tenant')).rejects.toThrow('offline');
  users.findOneByOrFail.mockRejectedValueOnce(
    new EntityNotFoundError(User, {}),
  );
  await expect(
    service.archiveAccount({ accountId: 'tenant', userId: 'missing' }),
  ).rejects.toMatchObject({ status: 404 });
});
it('archives accounts and locks/remaps the departing user email', async () => {
  const { service, account, user, users } = setup();
  const result = await service.archiveAccount({
    accountId: 'tenant',
    userId: 'user',
  });
  expect(result.archived_at).toBeInstanceOf(Date);
  expect(user.lockedAt).toBe(account.archivedAt);
  expect(user.email).toBe('owner+removed@example.test');
  users.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.archiveAccount({ accountId: 'tenant', userId: 'user' }),
  ).rejects.toThrow('write failed');
});
it('sends an SMTP setup check to the tenant-scoped current user', async () => {
  const { service, users, mail } = setup();
  expect(
    await service.sendMailTransportTest({
      accountId: 'tenant',
      userId: 'user',
    }),
  ).toEqual({ ok: true });
  expect(users.findOneByOrFail).toHaveBeenCalledWith({
    accountId: 'tenant',
    id: 'user',
  });
  expect(mail.sendSmtpSuccessfulSetup).toHaveBeenCalledWith({
    accountId: 'tenant',
    email: 'owner@example.test',
  });
});
it('uses typed preference defaults, merges partial nested preferences and preserves false values', async () => {
  const { service, configs } = setup();
  expect(await service.getAccountPreferences('tenant')).toEqual(
    Object.fromEntries(
      accountPreferenceDefinitions.map((definition) => [
        definition.property,
        definition.defaultValue,
      ]),
    ),
  );
  configs.find.mockResolvedValue([
    config('allow_to_decline', false),
    config('force_mfa', 'invalid'),
    config('bcc_emails', 'a@example.test'),
    config('auto_sign_owner_role', false),
    config('submitter_reminders', { second_duration: 'P2D' }),
    config('submitter_invitation_email', { subject: 'Custom' }),
    config('form_completed_button', {
      text: 'Finish',
      url: 'https://example.test',
    }),
  ]);
  expect(await service.getAccountPreferences('tenant')).toMatchObject({
    allow_to_decline: false,
    force_mfa: false,
    bcc_emails: 'a@example.test',
    auto_sign_owner_role: 'First Party',
    submitter_reminders: {
      first_duration: null,
      second_duration: 'P2D',
      third_duration: null,
    },
    submitter_invitation_email: {
      subject: 'Custom',
      body: expect.any(String) as unknown,
    },
    form_completed_button: { text: 'Finish', url: 'https://example.test' },
  });
  configs.find.mockResolvedValue([
    config('submitter_reminders', []),
    config('submitter_invitation_email', null),
    config('bcc_emails', 42),
  ]);
  expect(await service.getAccountPreferences('tenant')).toMatchObject({
    bcc_emails: '',
    submitter_reminders: {
      first_duration: null,
      second_duration: null,
      third_duration: null,
    },
    submitter_invitation_email: {
      subject: 'You are invited to sign a document',
    },
  });
});
it('normalizes preference updates and removes blank strings/reminders without losing false switches', async () => {
  const { service, configs } = setup();
  const existing = config('bcc_emails', 'old@example.test');
  configs.find.mockResolvedValue([
    existing,
    config('submitter_reminders', { first_duration: 'P1D' }),
    config('form_completed_button', { text: 'Old' }),
  ]);
  await service.updateAccountPreferences('tenant', {
    bcc_emails: ' , ',
    submitter_reminders: { first_duration: '', second_duration: null },
    form_completed_button: {},
    force_mfa: false,
    submitter_invitation_email: {
      subject: ' Subject ',
      body: ' ',
      reply_to: ' support@example.test ',
    },
  });
  expect(configs.remove).toHaveBeenCalledWith([
    existing,
    expect.objectContaining({ key: 'submitter_reminders' }),
    expect.objectContaining({ key: 'form_completed_button' }),
  ]);
  expect(configs.save).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ key: 'force_mfa', value: false }),
      expect.objectContaining({
        key: 'submitter_invitation_email',
        value: { subject: 'Subject', reply_to: 'support@example.test' },
      }),
    ]),
  );
  configs.save.mockClear();
  configs.remove.mockClear();
  configs.find.mockResolvedValue([]);
  await service.updateAccountPreferences('tenant', {});
  expect(configs.save).not.toHaveBeenCalled();
  expect(configs.remove).not.toHaveBeenCalled();
  await service.updateAccountPreferences('tenant', {
    bcc_emails: 'one@example.test,  two@example.test,,',
    submitter_reminders: { third_duration: 'P3D' },
  });
  expect(configs.save).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'bcc_emails',
        value: 'one@example.test, two@example.test',
      }),
      expect.objectContaining({
        key: 'submitter_reminders',
        value: {
          first_duration: null,
          second_duration: null,
          third_duration: 'P3D',
        },
      }),
    ]),
  );
});
it('updates existing preference rows and propagates persistence failures', async () => {
  const { service, configs } = setup();
  const existing = config('force_mfa', false);
  configs.find.mockResolvedValue([existing]);
  await service.updateAccountPreferences('tenant', { force_mfa: true });
  expect(configs.create).not.toHaveBeenCalled();
  expect(configs.save).toHaveBeenCalledWith([existing]);
  configs.save.mockRejectedValue(new Error('unavailable'));
  await expect(
    service.updateAccountPreferences('tenant', { force_mfa: false }),
  ).rejects.toThrow('unavailable');
});
it('normalizes reusable custom fields and strips unrelated or malformed nested properties', async () => {
  const { service, configs } = setup();
  expect(await service.getTemplateCustomFields('tenant')).toEqual([]);
  configs.findOne.mockResolvedValue(
    config('template_custom_fields', [{ name: 'Existing' }]),
  );
  expect(await service.getTemplateCustomFields('tenant')).toEqual([
    { name: 'Existing' },
  ]);
  const input = [
    null,
    false,
    {},
    { unknown: true },
    {
      uuid: 'field',
      name: 'Choice',
      type: 'radio',
      required: false,
      readonly: true,
      default_value: null,
      title: 'Title',
      description: 'Description',
      preferences: { color: 'red' },
      options: [
        null,
        {},
        { uuid: 'choice', value: 'One', ignored: true },
        { value: 1 },
      ],
      validation: {
        min: 0,
        max: '10',
        step: Infinity,
        message: 'Invalid',
        pattern: '^a',
      },
      areas: [
        null,
        {},
        {
          x: 0.1,
          y: 0.2,
          w: 0.3,
          h: 0.1,
          cell_w: 0.2,
          option_uuid: 'choice',
          page: 4,
          attachment_uuid: 'drop',
        },
        { x: Infinity },
      ],
    },
  ];
  const result = await service.updateTemplateCustomFields('tenant', input);
  expect(result).toEqual([
    {
      uuid: 'field',
      name: 'Choice',
      type: 'radio',
      required: false,
      readonly: true,
      default_value: null,
      title: 'Title',
      description: 'Description',
      preferences: { color: 'red' },
      options: [{ uuid: 'choice', value: 'One' }],
      validation: { min: 0, max: '10', message: 'Invalid', pattern: '^a' },
      areas: [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.1, cell_w: 0.2, option_uuid: 'choice' },
      ],
    },
  ]);
  configs.findOne.mockResolvedValue(null);
  expect(
    await service.updateTemplateCustomFields('tenant', [
      {
        name: 42,
        preferences: [],
        validation: {},
        options: false,
        areas: false,
      },
      { validation: { min: NaN } },
    ]),
  ).toEqual([]);
  expect(await service.updateTemplateCustomFields('tenant', 'invalid')).toEqual(
    [],
  );
  configs.save.mockRejectedValue(new Error('save failed'));
  await expect(
    service.updateTemplateCustomFields('tenant', []),
  ).rejects.toThrow('save failed');
});
it('reads the most recent account logo with permanent signed access and returns the removed logo', async () => {
  const { service, storage } = setup();
  expect(await service.getAccountLogo('tenant')).toBeNull();
  const logo = Object.assign(new StorageAttachment(), {
    uuid: 'logo',
    blob: Object.assign(new StorageBlob(), {
      filename: 'logo.png',
      contentType: 'image/png',
    }),
  });
  storage.findRecordAttachments.mockResolvedValue([
    Object.assign(new StorageAttachment(), { uuid: 'old' }),
    logo,
  ]);
  expect(await service.deleteAccountLogo('tenant')).toEqual({
    uuid: 'logo',
    filename: 'logo.png',
    content_type: 'image/png',
    url: 'https://files.example.test/logo.png',
  });
  expect(storage.createBlobProxyUrl).toHaveBeenCalledWith(logo.blob, null);
  expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
    recordType: 'Account',
    recordId: 'tenant',
    name: 'logo',
  });
});
