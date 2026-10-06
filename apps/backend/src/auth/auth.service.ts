import { AccountMembershipsService } from '../account-memberships/account-memberships.service';
import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AccountLinkedAccount } from '../accounts/entities/account-linked-account.entity';
import { Account } from '../accounts/entities/account.entity';
import { throwIfUniqueConstraint } from '../common/utils/error';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { createTeamSlug } from '../teams/team-slug';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import {
  defaultApiTokenPermissions,
  normalizeApiTokenPermissions,
} from './api-token-permissions';
import {
  ApiTokenResponseDto,
  ApiTokenRevealResponseDto,
  RotateApiTokenDto,
  UpdateApiTokenPermissionsDto,
} from './dto/api-token-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RegisterDto } from './dto/register.dto';
import { RegistrationStatusDto } from './dto/registration-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AccessToken } from './entities/access-token.entity';
import { hashPassword, verifyPassword } from './passwords';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from './password-reset-tokens';
import {
  assertRegistrationAllowed,
  getRegistrationStatus,
} from './registration-policy';
import { TenantContext } from './tenant-context';
import { WebSessionJwtPayload } from './web-session';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly memberships: AccountMembershipsService,
    @InjectRepository(AccessToken)
    private readonly accessTokens: Repository<AccessToken>,
    @InjectRepository(AccountLinkedAccount)
    private readonly linkedAccounts: Repository<AccountLinkedAccount>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly emailVerificationCodes: EmailVerificationCodeService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  hashApiToken(apiToken: string): string {
    return createHash('sha256').update(apiToken).digest('hex');
  }

  async resolveApiToken(apiToken: string): Promise<TenantContext | null> {
    const accessToken = await this.accessTokens.findOne({
      where: {
        sha256: this.hashApiToken(apiToken),
      },
      relations: {
        user: {
          account: true,
        },
      },
    });

    if (
      !accessToken?.user ||
      accessToken.revokedAt ||
      accessToken.user.archivedAt
    ) {
      return null;
    }

    const user = await this.memberships.resolveUser(
      accessToken.userId,
      accessToken.accountId ?? accessToken.user.accountId,
    );
    if (!user) return null;
    if (
      accessToken.teamId &&
      !(await this.dataSource.getRepository(Team).existsBy({
        id: accessToken.teamId,
        accountId: user.accountId,
        archivedAt: IsNull(),
      }))
    )
      return null;
    if (
      accessToken.teamId &&
      user.role !== 'admin' &&
      !(await this.dataSource.getRepository(TeamMember).existsBy({
        teamId: accessToken.teamId,
        accountId: user.accountId,
        userId: user.id,
        archivedAt: IsNull(),
      }))
    )
      return null;
    await this.accessTokens.update(accessToken.id, { lastUsedAt: new Date() });

    const testingLink = await this.resolveTestingLink(user.accountId);

    return {
      accountId: user.accountId,
      userId: accessToken.userId,
      accessTokenId: accessToken.id,
      isTestMode: testingLink.isTestMode,
      productionAccountId: testingLink.productionAccountId,
      role: user.role,
      apiTokenPermissions: normalizeApiTokenPermissions(
        accessToken.permissions,
      ),
      testingAccountId: testingLink.testingAccountId,
      teamId: accessToken.teamId ?? undefined,
    };
  }

  async getUserApiToken(
    userId: string,
    accountId?: string,
  ): Promise<ApiTokenResponseDto> {
    return this.toApiTokenResponse(
      await this.findOrCreateUserApiToken(userId, accountId),
      await this.getUserRole(userId, accountId),
    );
  }

  async revealUserApiToken(
    userId: string,
    password: string,
    accountId?: string,
  ): Promise<ApiTokenRevealResponseDto> {
    await this.assertUserPassword(userId, password);
    const accessToken = await this.findOrCreateUserApiToken(userId, accountId);

    return {
      ...this.toApiTokenResponse(
        accessToken,
        await this.getUserRole(userId, accountId),
      ),
      revealed_token: this.decryptApiToken(accessToken.token),
    };
  }

  async rotateUserApiToken(
    userId: string,
    input: RotateApiTokenDto,
    accountId?: string,
  ): Promise<ApiTokenRevealResponseDto> {
    await this.assertUserPassword(userId, input.password);
    const accessToken = await this.findOrCreateUserApiToken(userId, accountId);
    const token = this.generateApiToken();

    accessToken.token = this.encryptApiToken(token);
    accessToken.sha256 = this.hashApiToken(token);
    accessToken.permissions = normalizeApiTokenPermissions(
      input.permissions ?? accessToken.permissions,
    );
    accessToken.revokedAt = null;
    accessToken.lastUsedAt = null;

    const saved = await this.accessTokens.save(accessToken);

    return {
      ...this.toApiTokenResponse(
        saved,
        await this.getUserRole(userId, accountId),
      ),
      revealed_token: token,
    };
  }

  async updateUserApiTokenPermissions(
    userId: string,
    input: UpdateApiTokenPermissionsDto,
    accountId?: string,
  ): Promise<ApiTokenResponseDto> {
    const accessToken = await this.findOrCreateUserApiToken(userId, accountId);

    accessToken.permissions = normalizeApiTokenPermissions(input.permissions);

    return this.toApiTokenResponse(
      await this.accessTokens.save(accessToken),
      await this.getUserRole(userId, accountId),
    );
  }

  async issueTeamApiToken(options: {
    teamId: string;
    user: User;
  }): Promise<ApiTokenRevealResponseDto> {
    const token = this.generateApiToken();
    const accessToken = await this.accessTokens.save(
      this.accessTokens.create({
        permissions: [...defaultApiTokenPermissions],
        sha256: this.hashApiToken(token),
        teamId: options.teamId,
        accountId: options.user.accountId,
        token: this.encryptApiToken(token),
        userId: options.user.id,
      }),
    );

    return {
      ...this.toApiTokenResponse(accessToken, options.user.role),
      permissions_note:
        'API token belongs to this user and is scoped to the selected team.',
      revealed_token: token,
    };
  }

  createTeamImpersonationResponse(options: {
    account: Account;
    teamId: string;
    user: User;
  }): AuthResponseDto {
    const response = this.createAuthResponse(options.user, options.account);

    response.access_token = this.jwtService.sign({
      accountId: options.user.accountId,
      role: options.user.role,
      sub: options.user.id,
      teamId: options.teamId,
      userId: options.user.id,
    } satisfies WebSessionJwtPayload);

    return response;
  }

  async register(input: RegisterDto): Promise<AuthResponseDto> {
    const email = input.email.toLowerCase();
    await assertRegistrationAllowed({
      configService: this.configService,
      dataSource: this.dataSource,
    });

    const existingUser = await this.dataSource.getRepository(User).findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException({ error: 'Email already exists' });
    }

    try {
      const { account, user } = await this.dataSource.transaction(
        async (manager) => {
          await assertRegistrationAllowed({
            configService: this.configService,
            dataSource: this.dataSource,
            manager,
          });

          const accountRepository = manager.getRepository(Account);
          const teamMemberRepository = manager.getRepository(TeamMember);
          const teamRepository = manager.getRepository(Team);
          const userRepository = manager.getRepository(User);

          const account = accountRepository.create({
            name: input.account_name,
            timezone: input.timezone ?? 'UTC',
            locale: input.locale ?? 'en-US',
          });
          const savedAccount = await accountRepository.save(account);

          const user = userRepository.create({
            accountId: savedAccount.id,
            email,
            firstName: input.first_name,
            lastName: input.last_name,
            role: 'admin',
            encryptedPassword: await hashPassword(input.password),
          });
          const savedUser = await userRepository.save(user);

          const team = teamRepository.create({
            accountId: savedAccount.id,
            createdByUserId: savedUser.id,
            name: savedAccount.name,
            slug: createTeamSlug(savedAccount.name),
          });
          const savedTeam = await teamRepository.save(team);

          await teamMemberRepository.save(
            teamMemberRepository.create({
              accountId: savedAccount.id,
              role: 'manager',
              teamId: savedTeam.id,
              userId: savedUser.id,
            }),
          );

          return { account: savedAccount, user: savedUser };
        },
      );

      return this.createAuthResponse(user, account);
    } catch (error) {
      throwIfUniqueConstraint(error, 'Email already exists');
    }
  }

  async getRegistrationStatus(): Promise<RegistrationStatusDto> {
    const status = await getRegistrationStatus({
      configService: this.configService,
      dataSource: this.dataSource,
    });

    return {
      can_register: status.canRegister,
      mode: status.mode,
      reason: status.reason,
    };
  }

  async login(input: LoginDto): Promise<AuthResponseDto> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email: input.email.toLowerCase() },
      relations: { account: true },
    });

    if (
      !user ||
      user.archivedAt ||
      !(await verifyPassword(input.password, user.encryptedPassword))
    ) {
      throw new UnauthorizedException({ error: 'Invalid email or password' });
    }

    if (user.otpRequiredForLogin) {
      if (!input.otp_attempt) {
        throw new UnauthorizedException({
          error: 'Two-factor authentication code is required',
          code: 'otp_required',
        });
      }

      if (
        !user.otpSecret ||
        !this.emailVerificationCodes.verifyAuthenticatorCode({
          code: input.otp_attempt,
          secret: user.otpSecret,
        })
      ) {
        throw new UnauthorizedException({
          error: 'Two-factor authentication code is invalid',
          code: 'otp_invalid',
        });
      }
    }

    return this.createLoginResponse(user);
  }

  async createLoginResponse(identity: User): Promise<AuthResponseDto> {
    let user = await this.memberships.resolveUser(
      identity.id,
      identity.accountId,
    );
    if (!user) {
      const account = (await this.memberships.listAccounts(identity.id)).find(
        (item) => item.status === 'active',
      );
      if (account)
        user = await this.memberships.resolveUser(identity.id, account.id);
    }
    if (!user) throw new UnauthorizedException('No active account membership');
    return this.createAuthResponse(user, user.account);
  }

  resolveSessionUser(payload: WebSessionJwtPayload): Promise<User | null> {
    return this.memberships.resolveUser(payload.userId, payload.accountId);
  }

  async requestPasswordReset(input: ForgotPasswordDto): Promise<{ ok: true }> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email: input.email.toLowerCase() },
      relations: { account: true },
    });

    if (!user || user.archivedAt || user.account.archivedAt) {
      return { ok: true };
    }

    const token = createPasswordResetToken();

    user.resetPasswordToken = hashPasswordResetToken(token);
    user.resetPasswordSentAt = new Date();
    await this.dataSource.getRepository(User).save(user);

    try {
      await this.mailService.sendPasswordReset({
        accountId: user.accountId,
        email: user.email,
        firstName: user.firstName,
        token,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send password reset email for user ${user.id}: ${(error as Error).message}`,
      );
    }

    return { ok: true };
  }

  async resetPassword(input: ResetPasswordDto): Promise<{ ok: true }> {
    if (input.password !== input.password_confirmation) {
      throw new UnprocessableEntityException({
        error: 'Password confirmation does not match',
      });
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { resetPasswordToken: hashPasswordResetToken(input.token) },
      relations: { account: true },
    });

    if (
      !user ||
      user.archivedAt ||
      user.account.archivedAt ||
      !this.isPasswordResetTokenFresh(user.resetPasswordSentAt)
    ) {
      throw new UnprocessableEntityException({
        error: 'Password reset token is invalid or expired',
      });
    }

    user.encryptedPassword = await hashPassword(input.password);
    user.resetPasswordToken = null;
    user.resetPasswordSentAt = null;
    await this.dataSource.getRepository(User).save(user);

    return { ok: true };
  }

  private isPasswordResetTokenFresh(sentAt: Date | null): boolean {
    if (!sentAt) {
      return false;
    }

    const ttlMinutes = this.configService.get<number>(
      'PASSWORD_RESET_TOKEN_TTL_MINUTES',
      360,
    );

    return Date.now() - sentAt.getTime() <= ttlMinutes * 60 * 1000;
  }

  createAuthResponse(
    user: User,
    account: Account,
    options: {
      isTestMode?: boolean;
      productionAccountId?: string | null;
      testingAccountId?: string | null;
      trueAccountId?: string;
      trueUserId?: string;
    } = {},
  ): AuthResponseDto {
    const payload: WebSessionJwtPayload = {
      sub: user.id,
      userId: user.id,
      accountId: user.accountId,
      isTestMode: options.isTestMode,
      role: user.role,
      trueAccountId: options.trueAccountId,
      trueUserId: options.trueUserId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        email: user.email,
        role: user.role,
        otp_required_for_login: user.otpRequiredForLogin,
      },
      account: {
        id: account.id,
        name: account.name,
        timezone: account.timezone,
        locale: account.locale,
        is_test_mode: options.isTestMode ?? false,
        production_account_id: options.productionAccountId ?? null,
        testing_account_id: options.testingAccountId ?? null,
      },
    };
  }

  private async findOrCreateUserApiToken(
    userId: string,
    accountId?: string,
  ): Promise<AccessToken> {
    const identity = accountId
      ? await this.dataSource.getRepository(User).findOneBy({ id: userId })
      : null;
    if (accountId && !(await this.memberships.resolveUser(userId, accountId)))
      throw new UnauthorizedException();
    const scope = accountId
      ? [
          { accountId, teamId: IsNull(), userId },
          ...(String(identity?.accountId) === String(accountId)
            ? [{ accountId: IsNull(), teamId: IsNull(), userId }]
            : []),
        ]
      : { teamId: IsNull(), userId };
    const existing = await this.accessTokens.findOne({
      where: scope,
      order: { id: 'ASC' },
    });

    if (existing) {
      if (!Array.isArray(existing.permissions)) {
        existing.permissions = [...defaultApiTokenPermissions];
        return this.accessTokens.save(existing);
      }

      return existing;
    }

    const token = this.generateApiToken();

    return this.accessTokens.save(
      this.accessTokens.create({
        userId,
        accountId: accountId ?? null,
        sha256: this.hashApiToken(token),
        token: this.encryptApiToken(token),
        permissions: [...defaultApiTokenPermissions],
      }),
    );
  }

  private async assertUserPassword(
    userId: string,
    password: string,
  ): Promise<void> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
    });

    if (!user || !(await verifyPassword(password, user.encryptedPassword))) {
      throw new UnauthorizedException({ error: 'Invalid password' });
    }
  }

  private async getUserRole(
    userId: string,
    accountId?: string,
  ): Promise<string> {
    if (accountId)
      return (
        (await this.memberships.resolveUser(userId, accountId))?.role ??
        'unknown'
      );
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
    });

    return user?.role ?? 'unknown';
  }

  private toApiTokenResponse(
    accessToken: AccessToken,
    role: string,
  ): ApiTokenResponseDto {
    return {
      id: accessToken.id,
      token: maskApiToken(this.decryptApiToken(accessToken.token)),
      role,
      permissions: normalizeApiTokenPermissions(accessToken.permissions),
      permissions_note:
        'API token belongs to this user and can be constrained below the user role.',
      created_at: accessToken.createdAt,
      updated_at: accessToken.updatedAt,
      last_used_at: accessToken.lastUsedAt,
    };
  }

  private generateApiToken(): string {
    return `sgna_${randomBytes(24).toString('base64url')}`;
  }

  private encryptApiToken(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getTokenCipherKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  private decryptApiToken(value: string): string {
    if (!value.startsWith('v1:')) {
      return value;
    }

    const [, ivValue, tagValue, encryptedValue] = value.split(':');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getTokenCipherKey(),
      Buffer.from(ivValue, 'base64url'),
    );

    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getTokenCipherKey(): Buffer {
    return createHash('sha256')
      .update(this.configService.get<string>('JWT_SECRET', 'signa-secret'))
      .digest();
  }

  private async resolveTestingLink(accountId: string): Promise<{
    isTestMode: boolean;
    productionAccountId: string | null;
    testingAccountId: string | null;
  }> {
    const productionLink = await this.linkedAccounts.findOne({
      where: {
        accountType: 'testing',
        linkedAccountId: accountId,
      },
    });

    if (productionLink) {
      return {
        isTestMode: true,
        productionAccountId: productionLink.accountId,
        testingAccountId: accountId,
      };
    }

    const testingLink = await this.linkedAccounts.findOne({
      where: {
        accountId,
        accountType: 'testing',
      },
    });

    return {
      isTestMode: false,
      productionAccountId: accountId,
      testingAccountId: testingLink?.linkedAccountId ?? null,
    };
  }
}

function maskApiToken(token: string): string {
  if (token.length <= 10) {
    return '*'.repeat(token.length);
  }

  return `${token.slice(0, 8)}${'*'.repeat(Math.max(token.length - 12, 8))}${token.slice(-4)}`;
}
