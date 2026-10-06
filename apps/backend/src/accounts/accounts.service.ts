import {
  activateSigningCertificate,
  insertSigningCertificate,
  mutateSigningCertificates,
  removeSigningCertificate,
} from '../pdf-signatures/signing-certificate-registry';
import { decryptSigningKey } from '../pdf-signatures/signing-key-envelope';
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeAccountLogo } from '../branding/normalize-account-logo';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Like, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { throwDatabaseErrors, throwIfNotFound } from '../common/utils/error';
import { MailService } from '../mail/mail.service';
import {
  buildStoredSigningCertificate,
  defaultSigningCertificateKey,
  parseStoredSigningCertificate,
  signaDefaultCertificateName,
  signingCertificatePrefix,
} from '../pdf-signatures/pdf-signature-certificate';
import { PdfSignatureService } from '../pdf-signatures/pdf-signature.service';
import { PdfTrustRootService } from '../pdf-signatures/pdf-trust-root.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageService } from '../storage/storage.service';
import { UploadedBufferFile } from '../storage/storage.types';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { createTeamSlug } from '../teams/team-slug';
import { User } from '../users/entities/user.entity';
import {
  accountPreferenceDefinitions,
  accountPreferenceKeys,
} from './account-preferences';
import {
  AccountLogoResponseDto,
  SigningCertificateListResponseDto,
  SigningCertificateResponseDto,
  SigningTrustRootListResponseDto,
  SigningTrustRootResponseDto,
} from './dto/account-branding.dto';
import { AccountPreferencesResponseDto } from './dto/account-preferences-response.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import {
  AccountEmailIntegrationConnectResponseDto,
  AccountEmailIntegrationListResponseDto,
  AccountEmailIntegrationResponseDto,
} from './dto/account-integration.dto';
import { UpdateAccountPreferencesDto } from './dto/update-account-preferences.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';

const emailIntegrationProviders = ['gmail'] as const;
const templateCustomFieldsKey = 'template_custom_fields';

type EmailIntegrationProvider = (typeof emailIntegrationProviders)[number];

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(AccountConfig)
    private readonly accountConfigs: Repository<AccountConfig>,
    @InjectRepository(AccountLinkedAccount)
    private readonly linkedAccounts: Repository<AccountLinkedAccount>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(EncryptedConfig)
    private readonly encryptedConfigs: Repository<EncryptedConfig>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly pdfSignatureService: PdfSignatureService,
    private readonly pdfTrustRootService: PdfTrustRootService,
  ) {}

  findActiveAccount(accountId: string): Promise<Account | null> {
    return this.accounts.findOne({
      where: {
        id: accountId,
        archivedAt: IsNull(),
      },
    });
  }

  async findConfigValue(accountId: string, key: string): Promise<unknown> {
    const config = await this.accountConfigs.findOne({
      where: {
        accountId,
        key,
      },
    });

    return config?.value ?? null;
  }

  findLinkedAccount(options: {
    accountId: string;
    accountType: string;
  }): Promise<AccountLinkedAccount | null> {
    return this.linkedAccounts.findOne({
      where: {
        accountId: options.accountId,
        accountType: options.accountType,
      },
    });
  }

  findTestingLinkByTestingAccountId(
    linkedAccountId: string,
  ): Promise<AccountLinkedAccount | null> {
    return this.linkedAccounts.findOne({
      where: {
        accountType: 'testing',
        linkedAccountId,
      },
    });
  }

  async getTestingAccountContext(accountId: string): Promise<{
    isTestMode: boolean;
    productionAccountId: string | null;
    testingAccountId: string | null;
  }> {
    const productionLink =
      await this.findTestingLinkByTestingAccountId(accountId);

    if (productionLink) {
      return {
        isTestMode: true,
        productionAccountId: productionLink.accountId,
        testingAccountId: accountId,
      };
    }

    const testingLink = await this.findLinkedAccount({
      accountId,
      accountType: 'testing',
    });

    return {
      isTestMode: false,
      productionAccountId: accountId,
      testingAccountId: testingLink?.linkedAccountId ?? null,
    };
  }

  async findOrCreateTestingUser(options: {
    accountId: string;
    userId: string;
  }): Promise<{
    account: Account;
    trueAccount: Account;
    trueUser: User;
    user: User;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const accounts = manager.getRepository(Account);
      const links = manager.getRepository(AccountLinkedAccount);
      const teams = manager.getRepository(Team);
      const teamMembers = manager.getRepository(TeamMember);
      const users = manager.getRepository(User);
      const trueAccount = await accounts.findOne({
        where: { id: options.accountId, archivedAt: IsNull() },
      });
      const trueUser = await users.findOne({
        where: {
          accountId: options.accountId,
          archivedAt: IsNull(),
          id: options.userId,
        },
      });

      if (!trueAccount || !trueUser) {
        throw new NotFoundException({ error: 'Account not found' });
      }

      const existingLink = await links.findOne({
        where: {
          accountId: trueAccount.id,
          accountType: 'testing',
        },
        relations: {
          linkedAccount: true,
        },
      });

      if (existingLink?.linkedAccount) {
        const existingUser = await users.findOne({
          where: {
            accountId: existingLink.linkedAccountId,
            archivedAt: IsNull(),
            role: 'admin',
          },
          order: { id: 'ASC' },
        });

        if (existingUser) {
          if (existingUser.encryptedPassword !== trueUser.encryptedPassword) {
            existingUser.encryptedPassword = trueUser.encryptedPassword;
            await users.save(existingUser);
          }

          return {
            account: existingLink.linkedAccount,
            trueAccount,
            trueUser,
            user: existingUser,
          };
        }
      }

      const testingAccount =
        existingLink?.linkedAccount ??
        (await accounts.save(
          accounts.create({
            locale: trueAccount.locale,
            name: `Testing - ${trueAccount.name}`,
            timezone: trueAccount.timezone,
          }),
        ));

      if (!existingLink) {
        await links.save(
          links.create({
            accountId: trueAccount.id,
            accountType: 'testing',
            linkedAccountId: testingAccount.id,
          }),
        );
      }

      const testingUser = await users.save(
        users.create({
          accountId: testingAccount.id,
          email: this.buildTestingEmail(trueUser.email, testingAccount.id),
          encryptedPassword: trueUser.encryptedPassword,
          firstName: trueUser.firstName ?? 'Testing',
          lastName: trueUser.lastName ?? 'Environment',
          role: 'admin',
        }),
      );
      const team = await teams.save(
        teams.create({
          accountId: testingAccount.id,
          createdByUserId: testingUser.id,
          name: testingAccount.name,
          slug: createTeamSlug(testingAccount.name),
        }),
      );

      await teamMembers.save(
        teamMembers.create({
          accountId: testingAccount.id,
          role: 'manager',
          teamId: team.id,
          userId: testingUser.id,
        }),
      );

      return {
        account: testingAccount,
        trueAccount,
        trueUser,
        user: testingUser,
      };
    });
  }

  async findProductionUserForTestingSession(options: {
    accountId: string;
    trueAccountId?: string;
    trueUserId?: string;
  }): Promise<{ account: Account; user: User }> {
    const link =
      options.trueAccountId && options.trueUserId
        ? null
        : await this.findTestingLinkByTestingAccountId(options.accountId);
    const accountId = options.trueAccountId ?? link?.accountId;
    const userId = options.trueUserId;

    if (!accountId || !userId) {
      throw new NotFoundException({ error: 'Testing account not found' });
    }

    const [account, user] = await Promise.all([
      this.accounts.findOne({ where: { id: accountId, archivedAt: IsNull() } }),
      this.users.findOne({
        where: { accountId, archivedAt: IsNull(), id: userId },
      }),
    ]);

    if (!account || !user) {
      throw new NotFoundException({ error: 'Testing account not found' });
    }

    return { account, user };
  }

  async getAccount(accountId: string): Promise<AccountResponseDto> {
    return this.toAccountResponse(
      await this.findActiveAccountOrFail(accountId),
    );
  }

  async sendMailTransportTest(options: {
    accountId: string;
    userId: string;
  }): Promise<{ ok: true }> {
    const user = await this.users.findOneByOrFail({
      accountId: options.accountId,
      id: options.userId,
    });

    await this.mailService.sendSmtpSuccessfulSetup({
      accountId: options.accountId,
      email: user.email,
    });

    return { ok: true };
  }

  async getAccountPreferences(
    accountId: string,
  ): Promise<AccountPreferencesResponseDto> {
    await this.findActiveAccountOrFail(accountId);

    return this.toAccountPreferencesResponse(
      await this.accountConfigs.find({
        where: {
          accountId,
          key: In(accountPreferenceKeys),
        },
      }),
    );
  }

  async getTemplateCustomFields(
    accountId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.findActiveAccountOrFail(accountId);

    const config = await this.accountConfigs.findOne({
      where: {
        accountId,
        key: templateCustomFieldsKey,
      },
    });

    return normalizeCustomFields(config?.value);
  }

  async updateTemplateCustomFields(
    accountId: string,
    value: unknown,
  ): Promise<Record<string, unknown>[]> {
    await this.findActiveAccountOrFail(accountId);

    const customFields = normalizeCustomFields(value);
    const existingConfig = await this.accountConfigs.findOne({
      where: {
        accountId,
        key: templateCustomFieldsKey,
      },
    });
    const config =
      existingConfig ??
      this.accountConfigs.create({
        accountId,
        key: templateCustomFieldsKey,
      });

    config.value = customFields;

    try {
      return normalizeCustomFields(
        (await this.accountConfigs.save(config)).value,
      );
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async updateAccount(
    accountId: string,
    input: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.findActiveAccountOrFail(accountId);

    this.accounts.merge(account, {
      name: input.name ?? account.name,
      timezone: input.timezone ?? account.timezone,
      locale: input.locale ?? account.locale,
    });

    try {
      return this.toAccountResponse(await this.accounts.save(account));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async updateAccountPreferences(
    accountId: string,
    input: UpdateAccountPreferencesDto,
  ): Promise<AccountPreferencesResponseDto> {
    await this.findActiveAccountOrFail(accountId);

    const existingConfigs = await this.accountConfigs.find({
      where: {
        accountId,
        key: In(accountPreferenceKeys),
      },
    });
    const existingByKey = new Map(
      existingConfigs.map((config) => [config.key, config]),
    );
    const configsToSave: AccountConfig[] = [];
    const configsToRemove: AccountConfig[] = [];

    for (const definition of accountPreferenceDefinitions) {
      const value = this.normalizePreferenceValue(
        definition.property,
        input[definition.property],
      );

      if (typeof value === 'undefined') {
        continue;
      }

      const existingConfig = existingByKey.get(definition.key);

      if (this.isEmptyPreferenceValue(value)) {
        if (existingConfig) {
          configsToRemove.push(existingConfig);
        }

        continue;
      }

      const config =
        existingConfig ??
        this.accountConfigs.create({
          accountId,
          key: definition.key,
        });

      config.value = value;
      configsToSave.push(config);
    }

    try {
      if (configsToSave.length > 0) {
        await this.accountConfigs.save(configsToSave);
      }

      if (configsToRemove.length > 0) {
        await this.accountConfigs.remove(configsToRemove);
      }

      return this.getAccountPreferences(accountId);
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async archiveAccount(options: {
    accountId: string;
    userId: string;
  }): Promise<AccountResponseDto> {
    const account = await this.findActiveAccountOrFail(options.accountId);
    const user = await this.findUserOrFail(options.userId);
    const archivedAt = new Date();

    user.lockedAt = archivedAt;
    user.email = user.email.replace('@', '+removed@');
    account.archivedAt = archivedAt;

    try {
      await this.users.save(user);
      return this.toAccountResponse(await this.accounts.save(account));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async getAccountLogo(
    accountId: string,
  ): Promise<AccountLogoResponseDto | null> {
    await this.findActiveAccountOrFail(accountId);

    const logos = await this.storageService.findRecordAttachments({
      recordType: 'Account',
      recordId: accountId,
      name: 'logo',
    });

    const logo = logos.at(-1);
    return logo ? this.toLogoResponse(logo) : null;
  }

  async uploadAccountLogo(
    accountId: string,
    file: UploadedBufferFile,
  ): Promise<AccountLogoResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    this.assertUploadedFile(file, 'Logo file is required');

    const normalized = await normalizeAccountLogo(file.buffer);
    const logo = await this.storageService.createAttachment({
      buffer: normalized.buffer,
      filename: 'account-logo.png',
      contentType: 'image/png',
      name: 'logo',
      recordType: 'Account',
      recordId: accountId,
      metadata: {
        analyzed: true,
        identified: true,
        logo_background: normalized.background,
      },
    });
    // Publish the replacement before removing older attachments; a failed upload preserves the logo.
    await this.storageService.deleteRecordAttachments({
      recordType: 'Account',
      recordId: accountId,
      name: 'logo',
      beforeId: logo.id,
    });

    return this.toLogoResponse(logo);
  }

  async deleteAccountLogo(
    accountId: string,
  ): Promise<AccountLogoResponseDto | null> {
    const existingLogo = await this.getAccountLogo(accountId);

    await this.storageService.deleteRecordAttachments({
      recordType: 'Account',
      recordId: accountId,
      name: 'logo',
    });

    return existingLogo;
  }

  async listSigningCertificates(
    accountId: string,
  ): Promise<SigningCertificateListResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    await this.pdfSignatureService.ensureDefaultCertificate(accountId);

    const [configs, defaultConfig, timestampServerUrl] = await Promise.all([
      this.encryptedConfigs.find({
        where: { accountId, key: Like(`${signingCertificatePrefix}%`) },
        order: { createdAt: 'ASC' },
      }),
      this.encryptedConfigs.findOne({
        where: { accountId, key: defaultSigningCertificateKey },
      }),
      this.pdfSignatureService.getTimestampServerUrl(accountId),
    ]);
    const defaultName = defaultConfig?.value ?? signaDefaultCertificateName;

    return {
      data: configs
        .filter((config) => config.key.startsWith(signingCertificatePrefix))
        .map((config) =>
          this.toSigningCertificateResponse(config, defaultName),
        ),
      timestamp_server_url: timestampServerUrl,
    };
  }

  async uploadSigningCertificate(
    accountId: string,
    name: string | undefined,
    file: UploadedBufferFile,
    password?: string,
  ): Promise<SigningCertificateResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    this.assertUploadedFile(file, 'Signing certificate file is required');
    const certificateName = this.normalizeCertificateName(
      name || file.originalname,
    );
    const value = JSON.stringify(
      buildStoredSigningCertificate({
        buffer: file.buffer,
        contentType: file.mimetype,
        filename: file.originalname || `${certificateName}.p12`,
        password,
      }),
    );
    const config = await mutateSigningCertificates(
      this.dataSource,
      accountId,
      (repo) =>
        insertSigningCertificate(repo, {
          accountId,
          name: certificateName,
          value,
        }),
    );
    return this.toSigningCertificateResponse(config, null);
  }

  async makeDefaultSigningCertificate(
    accountId: string,
    name: string,
  ): Promise<SigningCertificateResponseDto> {
    const normalized = this.normalizeCertificateName(name);
    const certificate = await mutateSigningCertificates(
      this.dataSource,
      accountId,
      async (repo) => {
        const selected = await repo.findOne({
          where: { accountId, key: `${signingCertificatePrefix}${normalized}` },
        });
        if (!selected)
          throw new NotFoundException('Signing certificate not found');
        const identity = parseStoredSigningCertificate(
          decryptSigningKey(selected.value, accountId),
        );
        if (!identity)
          throw new UnprocessableEntityException('Invalid signing identity');
        await this.pdfSignatureService.assertSigningPolicy(identity, accountId);
        return activateSigningCertificate(repo, accountId, normalized);
      },
    );
    return this.toSigningCertificateResponse(certificate, normalized);
  }

  async updateTimestampServerUrl(
    accountId: string,
    value: string | null,
  ): Promise<SigningCertificateListResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    await this.pdfSignatureService.upsertTimestampServerUrl(accountId, value);

    return this.listSigningCertificates(accountId);
  }

  async deleteSigningCertificate(
    accountId: string,
    name: string,
  ): Promise<SigningCertificateResponseDto> {
    const certificate = await mutateSigningCertificates(
      this.dataSource,
      accountId,
      (repo) =>
        removeSigningCertificate(
          repo,
          accountId,
          this.normalizeCertificateName(name),
        ),
    );
    return this.toSigningCertificateResponse(certificate, null);
  }

  async listSigningTrustRoots(
    accountId: string,
  ): Promise<SigningTrustRootListResponseDto> {
    await this.findActiveAccountOrFail(accountId);

    return {
      data: await this.pdfTrustRootService.list(accountId),
    };
  }

  async uploadSigningTrustRoot(
    accountId: string,
    name: string | undefined,
    file: UploadedBufferFile,
  ): Promise<SigningTrustRootResponseDto> {
    await this.findActiveAccountOrFail(accountId);

    return this.pdfTrustRootService.upload({ accountId, file, name });
  }

  async deleteSigningTrustRoot(
    accountId: string,
    id: string,
  ): Promise<SigningTrustRootResponseDto> {
    await this.findActiveAccountOrFail(accountId);

    return this.pdfTrustRootService.remove({ accountId, id });
  }

  async listEmailIntegrations(
    accountId: string,
  ): Promise<AccountEmailIntegrationListResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    const configs = await this.encryptedConfigs.find({
      where: {
        accountId,
        key: In(
          emailIntegrationProviders.map((provider) =>
            this.getEmailIntegrationKey(provider),
          ),
        ),
      },
    });
    const configByProvider = new Map(
      configs.map((config) => [
        config.key.replace(
          'email_integration:',
          '',
        ) as EmailIntegrationProvider,
        config,
      ]),
    );

    return {
      data: emailIntegrationProviders.map((provider) =>
        this.toEmailIntegrationResponse(
          provider,
          configByProvider.get(provider),
        ),
      ),
    };
  }

  async startEmailIntegrationConnect(
    accountId: string,
    providerInput: string,
  ): Promise<AccountEmailIntegrationConnectResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    const provider = this.normalizeEmailIntegrationProvider(providerInput);
    const settings = this.getEmailIntegrationSettings(provider);

    if (!settings.clientId || !settings.clientSecret || !settings.redirectUri) {
      return {
        provider,
        connected: false,
        configured: false,
        url: null,
      };
    }

    return {
      provider,
      connected: false,
      configured: true,
      url: this.buildEmailIntegrationOauthUrl(provider, settings),
    };
  }

  async completeEmailIntegrationConnect(
    accountId: string,
    providerInput: string,
    code: string,
  ): Promise<AccountEmailIntegrationResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    const provider = this.normalizeEmailIntegrationProvider(providerInput);
    const settings = this.getEmailIntegrationSettings(provider);

    if (!settings.clientId || !settings.clientSecret || !settings.redirectUri) {
      throw new UnprocessableEntityException({
        error: 'Email integration is not configured',
      });
    }

    const tokenResponse = await this.exchangeEmailIntegrationCode(
      provider,
      settings,
      code,
    );
    const email = await this.fetchEmailIntegrationUserEmail(
      provider,
      tokenResponse.access_token,
    );
    const connectedAt = new Date().toISOString();
    const config = await this.upsertEncryptedConfig(
      accountId,
      this.getEmailIntegrationKey(provider),
      JSON.stringify({
        provider,
        email,
        connected_at: connectedAt,
        token_type: tokenResponse.token_type,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token ?? null,
        expires_at: tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
          : null,
        scope: tokenResponse.scope ?? null,
      }),
    );

    return this.toEmailIntegrationResponse(provider, config);
  }

  async disconnectEmailIntegration(
    accountId: string,
    providerInput: string,
  ): Promise<AccountEmailIntegrationResponseDto> {
    await this.findActiveAccountOrFail(accountId);
    const provider = this.normalizeEmailIntegrationProvider(providerInput);
    const config = await this.encryptedConfigs.findOne({
      where: {
        accountId,
        key: this.getEmailIntegrationKey(provider),
      },
    });

    if (config) {
      await this.encryptedConfigs.remove(config);
    }

    return this.toEmailIntegrationResponse(provider);
  }

  private async findActiveAccountOrFail(accountId: string): Promise<Account> {
    try {
      return await this.accounts.findOneByOrFail({
        id: accountId,
        archivedAt: IsNull(),
      });
    } catch (error) {
      throwIfNotFound(error, 'Account not found');
    }
  }

  private async findUserOrFail(userId: string): Promise<User> {
    try {
      return await this.users.findOneByOrFail({ id: userId });
    } catch (error) {
      throwIfNotFound(error, 'User not found');
    }
  }

  private normalizeEmailIntegrationProvider(
    provider: string,
  ): EmailIntegrationProvider {
    if (
      emailIntegrationProviders.includes(provider as EmailIntegrationProvider)
    ) {
      return provider as EmailIntegrationProvider;
    }

    throw new NotFoundException({ error: 'Email integration not found' });
  }

  private getEmailIntegrationKey(provider: EmailIntegrationProvider): string {
    return `email_integration:${provider}`;
  }

  private getEmailIntegrationSettings(provider: EmailIntegrationProvider): {
    authUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    tokenUrl: string;
    userInfoUrl: string;
  } {
    if (provider === 'gmail') {
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: this.configService.get<string>('GMAIL_OAUTH_CLIENT_ID', ''),
        clientSecret: this.configService.get<string>(
          'GMAIL_OAUTH_CLIENT_SECRET',
          '',
        ),
        redirectUri: this.configService.get<string>(
          'GMAIL_OAUTH_REDIRECT_URI',
          '',
        ),
        scopes: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.send',
        ],
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      };
    }

    throw new NotFoundException({ error: 'Email integration not found' });
  }

  private buildEmailIntegrationOauthUrl(
    provider: EmailIntegrationProvider,
    settings: ReturnType<AccountsService['getEmailIntegrationSettings']>,
  ): string {
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      response_type: 'code',
      scope: settings.scopes.join(' '),
      state: Buffer.from(
        JSON.stringify({ provider, timestamp: Date.now() }),
      ).toString('base64url'),
    });

    if (provider === 'gmail') {
      params.set('access_type', 'offline');
      params.set('include_granted_scopes', 'true');
      params.set('prompt', 'consent');
    }

    return `${settings.authUrl}?${params.toString()}`;
  }

  private toEmailIntegrationResponse(
    provider: EmailIntegrationProvider,
    config?: EncryptedConfig,
  ): AccountEmailIntegrationResponseDto {
    const value = config ? parseEmailIntegrationConfig(config.value) : {};
    const settings = this.getEmailIntegrationSettings(provider);

    return {
      provider,
      name: 'Gmail',
      connected: Boolean(config),
      configured: Boolean(
        settings.clientId && settings.clientSecret && settings.redirectUri,
      ),
      email: value.email ?? null,
      connected_at: value.connected_at ?? null,
    };
  }

  private async exchangeEmailIntegrationCode(
    provider: EmailIntegrationProvider,
    settings: ReturnType<AccountsService['getEmailIntegrationSettings']>,
    code: string,
  ): Promise<{
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  }> {
    const body = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: settings.redirectUri,
    });
    const response = await fetch(settings.tokenUrl, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok || !isPlainRecord(payload)) {
      throw new UnprocessableEntityException({
        error: `Failed to connect ${provider}`,
      });
    }

    if (typeof payload.access_token !== 'string') {
      throw new UnprocessableEntityException({
        error: `Missing ${provider} access token`,
      });
    }

    return {
      access_token: payload.access_token,
      expires_in:
        typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
      refresh_token:
        typeof payload.refresh_token === 'string'
          ? payload.refresh_token
          : undefined,
      scope: typeof payload.scope === 'string' ? payload.scope : undefined,
      token_type:
        typeof payload.token_type === 'string' ? payload.token_type : undefined,
    };
  }

  private async fetchEmailIntegrationUserEmail(
    provider: EmailIntegrationProvider,
    accessToken: string,
  ): Promise<string | null> {
    const settings = this.getEmailIntegrationSettings(provider);
    const response = await fetch(settings.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok || !isPlainRecord(payload)) {
      return null;
    }

    if (typeof payload.email === 'string') {
      return payload.email;
    }

    if (typeof payload.preferred_username === 'string') {
      return payload.preferred_username;
    }

    return null;
  }

  private async upsertEncryptedConfig(
    accountId: string,
    key: string,
    value: string,
  ): Promise<EncryptedConfig> {
    const config =
      (await this.encryptedConfigs.findOne({ where: { accountId, key } })) ??
      this.encryptedConfigs.create({ accountId, key });

    config.value = value;
    return this.encryptedConfigs.save(config);
  }

  private async findSigningCertificateOrFail(
    accountId: string,
    name: string,
  ): Promise<EncryptedConfig> {
    const certificateName = this.normalizeCertificateName(name);
    const certificate = await this.encryptedConfigs.findOne({
      where: {
        accountId,
        key: `${signingCertificatePrefix}${certificateName}`,
      },
    });

    if (!certificate) {
      throw new NotFoundException({ error: 'Signing certificate not found' });
    }

    return certificate;
  }

  private buildTestingEmail(email: string, testingAccountId: string): string {
    const [localPart, domain = 'signa.local'] = email.toLowerCase().split('@');
    const suffix = randomBytes(6).toString('hex');

    return `${localPart}+testing-${testingAccountId}-${suffix}@${domain}`;
  }

  toAccountResponse(account: Account): AccountResponseDto {
    return {
      id: account.id,
      name: account.name,
      timezone: account.timezone,
      locale: account.locale,
      archived_at: account.archivedAt,
    };
  }

  private toAccountPreferencesResponse(
    configs: AccountConfig[],
  ): AccountPreferencesResponseDto {
    const configByKey = new Map(configs.map((config) => [config.key, config]));

    return accountPreferenceDefinitions.reduce(
      (response, definition) => ({
        ...response,
        [definition.property]: this.toPreferenceValue(
          configByKey.get(definition.key)?.value,
          definition.defaultValue,
        ),
      }),
      {} as AccountPreferencesResponseDto,
    );
  }

  private toPreferenceValue(value: unknown, defaultValue: unknown): unknown {
    if (typeof defaultValue === 'boolean') {
      return typeof value === 'boolean' ? value : defaultValue;
    }

    if (typeof defaultValue === 'string') {
      return typeof value === 'string' ? value : defaultValue;
    }

    if (this.isSubmitterReminderValue(defaultValue)) {
      return this.isSubmitterReminderValue(value)
        ? {
            first_duration: value.first_duration ?? null,
            second_duration: value.second_duration ?? null,
            third_duration: value.third_duration ?? null,
          }
        : defaultValue;
    }

    if (isPlainRecord(defaultValue)) {
      return isPlainRecord(value)
        ? { ...defaultValue, ...value }
        : defaultValue;
    }

    return value ?? defaultValue;
  }

  private normalizePreferenceValue(property: string, value: unknown): unknown {
    if (property === 'bcc_emails' && typeof value === 'string') {
      return value
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean)
        .join(', ');
    }

    if (
      property === 'submitter_reminders' &&
      this.isSubmitterReminderValue(value)
    ) {
      return {
        first_duration: value.first_duration || null,
        second_duration: value.second_duration || null,
        third_duration: value.third_duration || null,
      };
    }

    if (isPlainRecord(value)) {
      return Object.fromEntries(
        Object.entries(value)
          .map(([key, nestedValue]) => [
            key,
            typeof nestedValue === 'string' ? nestedValue.trim() : nestedValue,
          ])
          .filter(
            ([, nestedValue]) => !this.isEmptyPreferenceValue(nestedValue),
          ),
      );
    }

    return value;
  }

  private isEmptyPreferenceValue(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (this.isSubmitterReminderValue(value)) {
      return (
        !value.first_duration && !value.second_duration && !value.third_duration
      );
    }

    if (isPlainRecord(value)) {
      return Object.keys(value).length === 0;
    }

    return false;
  }

  private isSubmitterReminderValue(value: unknown): value is {
    first_duration?: string | null;
    second_duration?: string | null;
    third_duration?: string | null;
  } {
    return (
      isPlainRecord(value) &&
      ('first_duration' in value ||
        'second_duration' in value ||
        'third_duration' in value)
    );
  }

  private assertUploadedFile(
    file: UploadedBufferFile | undefined,
    error: string,
  ): asserts file is UploadedBufferFile {
    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException({ error });
    }
  }

  private toLogoResponse(logo: StorageAttachment): AccountLogoResponseDto {
    return {
      uuid: logo.uuid,
      filename: logo.blob.filename,
      content_type: logo.blob.contentType,
      url: this.storageService.createBlobProxyUrl(logo.blob, null),
    };
  }

  private toSigningCertificateResponse(
    config: EncryptedConfig,
    defaultName: string | null,
  ): SigningCertificateResponseDto {
    const name = config.key.replace(signingCertificatePrefix, '');
    const metadata = parseStoredSigningCertificate(
      decryptSigningKey(config.value, config.accountId),
    );

    return {
      name,
      is_active: defaultName === name,
      fingerprint_sha256: metadata?.fingerprint_sha256 ?? null,
      filename: metadata?.filename,
      issuer: metadata?.issuer ?? null,
      serial_number: metadata?.serial_number ?? null,
      subject: metadata?.subject ?? null,
      valid_from: metadata?.valid_from ?? null,
      valid_to: metadata?.valid_to ?? null,
      status: defaultName === name ? 'default' : 'active',
    };
  }

  private normalizeCertificateName(name: string | undefined): string {
    const normalized = (typeof name === 'string' ? name : '')
      .trim()
      .replace(/\.(p12|pfx)$/i, '');

    if (
      !normalized ||
      normalized.length > 200 ||
      [...normalized].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new UnprocessableEntityException({
        error:
          'Signing certificate name must contain 1–200 printable characters',
      });
    }

    return normalized;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeCustomFields(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((field) => normalizeCustomField(field))
    .filter((field): field is Record<string, unknown> => field !== null);
}

function normalizeCustomField(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const field: Record<string, unknown> = {};

  copyString(value, field, 'uuid');
  copyString(value, field, 'name');
  copyString(value, field, 'type');
  copyBoolean(value, field, 'required');
  copyBoolean(value, field, 'readonly');
  copyUnknown(value, field, 'default_value');
  copyString(value, field, 'title');
  copyString(value, field, 'description');

  if (isPlainRecord(value.preferences)) {
    field.preferences = value.preferences;
  }

  const options = normalizeCustomFieldOptions(value.options);
  if (options.length > 0) {
    field.options = options;
  }

  const validation = normalizeCustomFieldValidation(value.validation);
  if (validation) {
    field.validation = validation;
  }

  const areas = normalizeCustomFieldAreas(value.areas);
  if (areas.length > 0) {
    field.areas = areas;
  }

  return Object.keys(field).length > 0 ? field : null;
}

function normalizeCustomFieldOptions(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (!isPlainRecord(option)) {
      return [];
    }

    const normalized: Record<string, string> = {};
    copyString(option, normalized, 'value');
    copyString(option, normalized, 'uuid');

    return Object.keys(normalized).length ? [normalized] : [];
  });
}

function normalizeCustomFieldValidation(
  value: unknown,
): Record<string, string | number> | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const validation: Record<string, string | number> = {};

  copyString(value, validation, 'message');
  copyString(value, validation, 'pattern');
  copyStringOrNumber(value, validation, 'min');
  copyStringOrNumber(value, validation, 'max');
  copyStringOrNumber(value, validation, 'step');

  return Object.keys(validation).length > 0 ? validation : null;
}

function normalizeCustomFieldAreas(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((area) => {
    if (!isPlainRecord(area)) {
      return [];
    }

    const normalized: Record<string, unknown> = {};
    copyNumber(area, normalized, 'x');
    copyNumber(area, normalized, 'y');
    copyNumber(area, normalized, 'w');
    copyNumber(area, normalized, 'h');
    copyNumber(area, normalized, 'cell_w');
    copyString(area, normalized, 'option_uuid');

    return Object.keys(normalized).length ? [normalized] : [];
  });
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (typeof source[key] === 'string') {
    target[key] = source[key];
  }
}

function copyBoolean(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (typeof source[key] === 'boolean') {
    target[key] = source[key];
  }
}

function copyNumber(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (typeof source[key] === 'number' && Number.isFinite(source[key])) {
    target[key] = source[key];
  }
}

function copyStringOrNumber(
  source: Record<string, unknown>,
  target: Record<string, string | number>,
  key: string,
): void {
  if (
    typeof source[key] === 'string' ||
    (typeof source[key] === 'number' && Number.isFinite(source[key]))
  ) {
    target[key] = source[key];
  }
}

function copyUnknown(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (Object.hasOwn(source, key)) {
    target[key] = source[key];
  }
}

function parseEmailIntegrationConfig(value: string): {
  email?: string;
  connected_at?: string | null;
} {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isPlainRecord(parsed)
      ? {
          email: typeof parsed.email === 'string' ? parsed.email : undefined,
          connected_at:
            typeof parsed.connected_at === 'string'
              ? parsed.connected_at
              : null,
        }
      : {};
  } catch {
    return {};
  }
}
