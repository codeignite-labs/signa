import sharp from 'sharp';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { AccountsService } from './accounts.service';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';

type MockRepository<T extends object> = {
  create: jest.Mock<T, [Partial<T>]>;
  findOne: jest.Mock<Promise<T | null>>;
  find: jest.Mock<Promise<T[]>>;
  findOneByOrFail: jest.Mock<Promise<T>>;
  save: jest.Mock<Promise<T>, [T]>;
};

function createRepository<T extends object>(): jest.Mocked<MockRepository<T>> {
  return {
    create: jest.fn((input: Partial<T>) => input as T),
    findOne: jest.fn(),
    find: jest.fn(),
    findOneByOrFail: jest.fn(),
    save: jest.fn((input: T) => Promise.resolve(input)),
  };
}

describe('AccountsService', () => {
  let service: AccountsService;
  const storage = {
    createAttachment: jest.fn(),
    deleteRecordAttachments: jest.fn(),
    createBlobProxyUrl: jest.fn(),
  };
  let accounts: jest.Mocked<MockRepository<Account>>;
  let accountConfigs: jest.Mocked<MockRepository<AccountConfig>>;
  let encryptedConfigs: jest.Mocked<MockRepository<EncryptedConfig>>;
  let linkedAccounts: jest.Mocked<MockRepository<AccountLinkedAccount>>;
  let users: jest.Mocked<MockRepository<User>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    accounts = createRepository<Account>();
    accountConfigs = createRepository<AccountConfig>();
    encryptedConfigs = createRepository<EncryptedConfig>();
    linkedAccounts = createRepository<AccountLinkedAccount>();
    users = createRepository<User>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: getRepositoryToken(Account),
          useValue: accounts,
        },
        {
          provide: getRepositoryToken(AccountConfig),
          useValue: accountConfigs,
        },
        {
          provide: getRepositoryToken(AccountLinkedAccount),
          useValue: linkedAccounts,
        },
        {
          provide: getRepositoryToken(User),
          useValue: users,
        },
        {
          provide: getRepositoryToken(EncryptedConfig),
          useValue: encryptedConfigs,
        },
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: StorageService,
          useValue: storage,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: MailService,
          useValue: {
            sendSmtpSuccessfulSetup: jest
              .fn()
              .mockResolvedValue({ status: 'sent' }),
          },
        },
        {
          provide: PdfSignatureService,
          useValue: {
            ensureDefaultCertificate: jest.fn(),
            getTimestampServerUrl: jest.fn().mockResolvedValue(null),
            upsertTimestampServerUrl: jest.fn(),
          },
        },
        {
          provide: PdfTrustRootService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            remove: jest.fn(),
            upload: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  it('lists Gmail as the only supported email connection', async () => {
    accounts.findOne.mockResolvedValue({ id: '17' } as Account);
    encryptedConfigs.find.mockResolvedValue([]);
    const result = await service.listEmailIntegrations('17');
    expect(result.data.map((integration) => integration.provider)).toEqual([
      'gmail',
    ]);
  });

  it('rejects a new Microsoft email connection', async () => {
    accounts.findOne.mockResolvedValue({ id: '17' } as Account);
    await expect(
      service.startEmailIntegrationConnect('17', 'microsoft'),
    ).rejects.toThrow(NotFoundException);
  });

  it('keeps the old logo when a new file is invalid', async () => {
    accounts.findOne.mockResolvedValue({ id: '17' } as Account);
    await expect(
      service.uploadAccountLogo('17', {
        buffer: Buffer.from('invalid'),
        size: 7,
        originalname: 'logo.png',
        mimetype: 'image/png',
      }),
    ).rejects.toThrow('Upload a static');
    expect(storage.deleteRecordAttachments).not.toHaveBeenCalled();
    expect(storage.createAttachment).not.toHaveBeenCalled();
  });

  it('keeps the old logo when storage fails', async () => {
    accounts.findOne.mockResolvedValue({ id: '17' } as Account);
    const buffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'black' },
    })
      .png()
      .toBuffer();
    storage.createAttachment.mockRejectedValueOnce(
      new Error('Storage unavailable'),
    );
    await expect(
      service.uploadAccountLogo('17', {
        buffer,
        size: buffer.length,
        originalname: 'logo.png',
        mimetype: 'image/png',
      }),
    ).rejects.toThrow('Storage unavailable');
    expect(storage.deleteRecordAttachments).not.toHaveBeenCalled();
  });

  it('publishes a sanitized logo before removing only older account logos', async () => {
    accounts.findOne.mockResolvedValue({ id: '17' } as Account);
    const buffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'black' },
    })
      .jpeg()
      .toBuffer();
    storage.createAttachment.mockResolvedValueOnce({
      id: '25',
      uuid: 'logo',
      blob: { filename: 'account-logo.png', contentType: 'image/png' },
    });
    await service.uploadAccountLogo('17', {
      buffer,
      size: buffer.length,
      originalname: 'unsafe.svg',
      mimetype: 'image/svg+xml',
    });
    expect(storage.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'Account',
        recordId: '17',
        name: 'logo',
        filename: 'account-logo.png',
        contentType: 'image/png',
      }),
    );
    expect(storage.deleteRecordAttachments).toHaveBeenCalledWith({
      recordType: 'Account',
      recordId: '17',
      name: 'logo',
      beforeId: '25',
    });
    expect(storage.createAttachment.mock.invocationCallOrder[0]).toBeLessThan(
      storage.deleteRecordAttachments.mock.invocationCallOrder[0],
    );
  });

  it('looks up active accounts by account id', async () => {
    accounts.findOne.mockResolvedValue(null);

    await service.findActiveAccount('account-1');

    expect(accounts.findOne).toHaveBeenCalledWith({
      where: {
        id: 'account-1',
        archivedAt: IsNull(),
      },
    });
  });

  it('returns account-scoped config values', async () => {
    accountConfigs.findOne.mockResolvedValue({
      value: { locale: 'en' },
    } as AccountConfig);

    await expect(
      service.findConfigValue('account-1', 'settings'),
    ).resolves.toEqual({ locale: 'en' });
    expect(accountConfigs.findOne).toHaveBeenCalledWith({
      where: {
        accountId: 'account-1',
        key: 'settings',
      },
    });
  });

  it('looks up linked accounts within the current account', async () => {
    linkedAccounts.findOne.mockResolvedValue(null);

    await service.findLinkedAccount({
      accountId: 'account-1',
      accountType: 'testing',
    });

    expect(linkedAccounts.findOne).toHaveBeenCalledWith({
      where: {
        accountId: 'account-1',
        accountType: 'testing',
      },
    });
  });

  it('stores normalized template custom fields on account config', async () => {
    accounts.findOne.mockResolvedValue({ id: 'account-1' } as Account);
    accountConfigs.findOne.mockResolvedValue(null);

    await expect(
      service.updateTemplateCustomFields('account-1', [
        {
          areas: [
            {
              attachment_uuid: 'document-1',
              h: 3,
              page: 1,
              w: 20,
              x: 10,
              y: 12,
            },
          ],
          conditions: [{ field: 'ignored' }],
          name: 'Approval',
          options: [{ label: 'ignored', uuid: 'option-1', value: 'Yes' }],
          preferences: { font_size: 12 },
          required: true,
          submitter_uuid: 'ignored',
          type: 'text',
          uuid: 'field-1',
        },
      ]),
    ).resolves.toEqual([
      {
        areas: [{ h: 3, w: 20, x: 10, y: 12 }],
        name: 'Approval',
        options: [{ uuid: 'option-1', value: 'Yes' }],
        preferences: { font_size: 12 },
        required: true,
        type: 'text',
        uuid: 'field-1',
      },
    ]);
    expect(accountConfigs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        key: 'template_custom_fields',
      }),
    );
    expect(accountConfigs.save).toHaveBeenCalledWith({
      accountId: 'account-1',
      key: 'template_custom_fields',
      value: [
        {
          areas: [{ h: 3, w: 20, x: 10, y: 12 }],
          name: 'Approval',
          options: [{ uuid: 'option-1', value: 'Yes' }],
          preferences: { font_size: 12 },
          required: true,
          type: 'text',
          uuid: 'field-1',
        },
      ],
    });
  });
});
