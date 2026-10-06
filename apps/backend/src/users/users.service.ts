import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isSignaRole, type SignaRole } from '@repo/shared';
import { randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from '../auth/password-reset-tokens';
import { hashPassword, verifyPassword } from '../auth/passwords';
import {
  throwDatabaseErrors,
  throwIfNotFound,
  throwIfUniqueConstraint,
} from '../common/utils/error';
import { MailService } from '../mail/mail.service';
import { EmailVerificationCodeService } from '../mail/email-verification-code.service';
import { StorageService } from '../storage/storage.service';
import type { UploadedBufferFile } from '../storage/storage.types';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { createTeamSlug } from '../teams/team-slug';
import { CreateUserDto } from './dto/create-user.dto';
import { ImportUserRowDto, ImportUsersDto } from './dto/import-users.dto';
import {
  ImportUserResultDto,
  ImportUsersResponseDto,
} from './dto/import-users-response.dto';
import { MfaSetupResponseDto, MfaStatusResponseDto } from './dto/mfa.dto';
import { ProfileAssetResponseDto } from './dto/profile-asset-response.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserConfig } from './entities/user-config.entity';
import { User } from './entities/user.entity';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';

type ProfileAssetKey = 'signature' | 'initials';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(Team)
    private readonly teams: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMembers: Repository<TeamMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserConfig)
    private readonly userConfigs: Repository<UserConfig>,
    private readonly emailVerificationCodes: EmailVerificationCodeService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
    private readonly memberships: AccountMembershipsService,
  ) {}

  findActiveUser(userId: string, accountId?: string): Promise<User | null> {
    if (accountId) return this.memberships.resolveUser(userId, accountId);
    return this.users.findOne({
      where: {
        id: userId,
        archivedAt: IsNull(),
      },
      relations: {
        account: true,
      },
    });
  }

  findByEmailInAccount(options: {
    accountId: string;
    email: string;
  }): Promise<User | null> {
    return this.users.findOne({
      where: {
        accountId: options.accountId,
        email: options.email.toLowerCase(),
        archivedAt: IsNull(),
      },
    });
  }

  async listUsers(options: {
    accountId: string;
    status?: string;
  }): Promise<UserResponseDto[]> {
    const archivedAt = options.status === 'archived' ? Not(IsNull()) : IsNull();

    const users = await this.users.find({
      where: {
        accountId: options.accountId,
        archivedAt,
      },
      order: {
        id: 'DESC',
      },
    });

    const members = await this.memberships.listMembers(
      options.accountId,
      options.status === 'archived',
    );
    const memberIds = await this.memberships.membershipUserIds(
      options.accountId,
    );
    return [
      ...users
        .filter((user) => !memberIds.has(String(user.id)))
        .map((user) => this.toUserResponse(user)),
      ...members.map(({ user, status }) => ({
        ...this.toUserResponse(user),
        membership_status: status,
        shared_identity: true,
      })),
    ];
  }

  async createUser(
    accountId: string,
    input: CreateUserDto,
  ): Promise<UserResponseDto> {
    const email = input.email.toLowerCase();
    const existingUser = await this.users.findOne({
      where: { email },
      withDeleted: true,
    });

    if (
      existingUser &&
      (String(existingUser.accountId) !== String(accountId) ||
        (await this.memberships.hasMembershipRecord(
          accountId,
          existingUser.id,
        )))
    ) {
      const invited = await this.memberships.invite(
        accountId,
        existingUser,
        this.normalizeRole(input.role),
      );
      return {
        ...this.toUserResponse(invited),
        membership_status: 'invited',
        shared_identity: true,
      };
    }

    if (existingUser && !existingUser.archivedAt) {
      throw new ConflictException({ error: 'Email already exists' });
    }

    const user = existingUser ?? this.users.create({ email });
    const password = input.password ?? randomBytes(16).toString('hex');
    const invitationToken = input.password ? null : createPasswordResetToken();

    this.users.merge(user, {
      accountId,
      email,
      firstName: this.normalizeOptionalName(input.first_name),
      lastName: this.normalizeOptionalName(input.last_name),
      role: this.normalizeRole(input.role),
      encryptedPassword: await hashPassword(password),
      resetPasswordToken: invitationToken
        ? hashPasswordResetToken(invitationToken)
        : null,
      resetPasswordSentAt: invitationToken ? new Date() : null,
      archivedAt: null,
    });

    try {
      const savedUser = await this.users.save(user);

      if (invitationToken) {
        await this.sendUserInvitation(savedUser, invitationToken);
      }

      return this.toUserResponse(savedUser);
    } catch (error) {
      throwIfUniqueConstraint(error, 'Email already exists');
    }
  }

  async updateUser(options: {
    accountId: string;
    userId: string;
    currentUserId: string;
    input: UpdateUserDto;
  }): Promise<UserResponseDto> {
    const identity = await this.users.findOneBy({ id: options.userId });
    if (
      identity &&
      (String(identity.accountId) !== String(options.accountId) ||
        (await this.memberships.hasMembershipRecord(
          options.accountId,
          identity.id,
        )))
    ) {
      if (Object.entries(options.input).some(([key, value]) => key !== 'role' && value !== undefined))
        throw new ForbiddenException(
          'Only the account role can be changed for a shared login identity',
        );
      if (String(options.currentUserId) === String(options.userId))
        throw new ForbiddenException('Unable to change your own role');
      const member = await this.memberships.changeMember(
        options.accountId,
        options.userId,
        { role: options.input.role },
      );
      if (!member) throw new ForbiddenException('Account membership not found');
      return { ...this.toUserResponse(member), shared_identity: true };
    }
    const user = await this.findAccountUserOrFail(
      options.accountId,
      options.userId,
    );
    const input = options.input;

    if (input.email) {
      await this.ensureEmailAvailable(input.email, user.id);
      user.email = input.email.toLowerCase();
    }

    user.firstName =
      input.first_name === undefined
        ? user.firstName
        : this.normalizeOptionalName(input.first_name);
    user.lastName =
      input.last_name === undefined
        ? user.lastName
        : this.normalizeOptionalName(input.last_name);

    if (options.currentUserId !== user.id) {
      if (input.role && input.role !== user.role) {
        await this.ensureCanChangeRole(user);
      }
      user.role = input.role ? this.normalizeRole(input.role) : user.role;
      user.otpRequiredForLogin =
        input.otp_required_for_login ?? user.otpRequiredForLogin;
    }

    if (input.password && options.currentUserId !== user.id) {
      user.encryptedPassword = await hashPassword(input.password);
    }

    try {
      return this.toUserResponse(await this.users.save(user));
    } catch (error) {
      throwIfUniqueConstraint(error, 'Email already exists');
    }
  }

  async updateProfile(options: {
    userId: string;
    input: UpdateProfileDto;
  }): Promise<UserResponseDto> {
    const user = await this.findUserOrFail(options.userId);
    const input = options.input;

    if (input.email) {
      await this.ensureEmailAvailable(input.email, user.id);
      user.email = input.email.toLowerCase();
    }

    user.firstName =
      input.first_name === undefined
        ? user.firstName
        : this.normalizeOptionalName(input.first_name);
    user.lastName =
      input.last_name === undefined
        ? user.lastName
        : this.normalizeOptionalName(input.last_name);

    try {
      return this.toUserResponse(await this.users.save(user));
    } catch (error) {
      throwIfUniqueConstraint(error, 'Email already exists');
    }
  }

  async updatePassword(options: {
    userId: string;
    input: UpdatePasswordDto;
  }): Promise<UserResponseDto> {
    const user = await this.findUserOrFail(options.userId);
    const input = options.input;

    if (input.password !== input.password_confirmation) {
      throw new UnprocessableEntityException({
        error: 'Password confirmation does not match',
      });
    }

    if (
      !(await verifyPassword(input.current_password, user.encryptedPassword))
    ) {
      throw new ForbiddenException({ error: 'Current password is incorrect' });
    }

    user.encryptedPassword = await hashPassword(input.password);

    try {
      return this.toUserResponse(await this.users.save(user));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async getProfileAsset(
    userId: string,
    key: ProfileAssetKey,
  ): Promise<ProfileAssetResponseDto | null> {
    const config = await this.userConfigs.findOneBy({ userId, key });

    if (!config?.value) {
      return null;
    }

    const [attachment] = await this.storageService.findRecordAttachments({
      recordType: 'User',
      recordId: userId,
      name: key,
    });

    if (!attachment || attachment.uuid !== config.value) {
      return null;
    }

    return this.toProfileAssetResponse(attachment);
  }

  async uploadProfileAsset(options: {
    userId: string;
    key: ProfileAssetKey;
    file: UploadedBufferFile;
  }): Promise<ProfileAssetResponseDto> {
    await this.findUserOrFail(options.userId);
    this.assertProfileAssetImage(options.file, options.key);
    await this.storageService.deleteRecordAttachments({
      recordType: 'User',
      recordId: options.userId,
      name: options.key,
    });

    const attachment = await this.storageService.createAttachment({
      buffer: options.file.buffer,
      filename: options.file.originalname || `${options.key}.png`,
      contentType: options.file.mimetype ?? 'image/png',
      name: options.key,
      recordType: 'User',
      recordId: options.userId,
      metadata: {
        analyzed: true,
        identified: true,
        profile_asset: options.key,
      },
    });

    await this.upsertUserConfig({
      userId: options.userId,
      key: options.key,
      value: attachment.uuid,
    });

    return this.toProfileAssetResponse(attachment);
  }

  async deleteProfileAsset(
    userId: string,
    key: ProfileAssetKey,
  ): Promise<null> {
    await this.storageService.deleteRecordAttachments({
      recordType: 'User',
      recordId: userId,
      name: key,
    });
    await this.userConfigs.delete({ userId, key });

    return null;
  }

  async getMfaStatus(userId: string): Promise<MfaStatusResponseDto> {
    const user = await this.findUserOrFail(userId);

    return {
      otp_required_for_login: user.otpRequiredForLogin,
    };
  }

  async startMfaSetup(userId: string): Promise<MfaSetupResponseDto> {
    const user = await this.findUserOrFail(userId);

    if (!user.otpSecret) {
      user.otpSecret =
        this.emailVerificationCodes.generateAuthenticatorSecret();
      await this.users.save(user);
    }

    return this.toMfaSetupResponse(user);
  }

  async enableMfa(options: {
    userId: string;
    otpAttempt: string;
  }): Promise<MfaStatusResponseDto> {
    const user = await this.findUserOrFail(options.userId);

    if (!user.otpSecret) {
      throw new UnprocessableEntityException({
        error: 'Start 2FA setup before verifying a code',
      });
    }

    if (!this.verifyAuthenticatorCode(user, options.otpAttempt)) {
      throw new UnprocessableEntityException({ error: 'Code is invalid' });
    }

    user.otpRequiredForLogin = true;
    await this.users.save(user);

    return { otp_required_for_login: true };
  }

  async disableMfa(options: {
    userId: string;
    otpAttempt: string;
  }): Promise<MfaStatusResponseDto> {
    const user = await this.findUserOrFail(options.userId);

    if (!user.otpSecret || !user.otpRequiredForLogin) {
      return { otp_required_for_login: false };
    }

    if (!this.verifyAuthenticatorCode(user, options.otpAttempt)) {
      throw new UnprocessableEntityException({ error: 'Code is invalid' });
    }

    user.otpRequiredForLogin = false;
    user.otpSecret = null;
    await this.users.save(user);

    return { otp_required_for_login: false };
  }

  async archiveUser(options: {
    accountId: string;
    userId: string;
    currentUserId: string;
  }): Promise<UserResponseDto> {
    if (String(options.userId) === String(options.currentUserId)) {
      throw new ForbiddenException({ error: 'Unable to remove current user' });
    }

    const member = await this.memberships.changeMember(
      options.accountId,
      options.userId,
      { archive: true },
    );
    if (member)
      return { ...this.toUserResponse(member), shared_identity: true };

    const user = await this.findAccountUserOrFail(
      options.accountId,
      options.userId,
    );
    await this.ensureCanArchiveUser(user);
    user.archivedAt = new Date();

    try {
      return this.toUserResponse(await this.users.save(user));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async importUsers(
    accountId: string,
    input: ImportUsersDto,
  ): Promise<ImportUsersResponseDto> {
    const results: ImportUserResultDto[] = [];

    for (const [index, row] of input.users.entries()) {
      results.push(await this.importUserRow(accountId, row, index + 1));
    }

    return this.toImportUsersResponse(results);
  }

  private async ensureEmailAvailable(
    email: string,
    userId: string,
  ): Promise<void> {
    const existingUser = await this.users.findOne({
      where: { email: email.toLowerCase() },
    });

    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException({ error: 'Email already exists' });
    }
  }

  private async findAccountUserOrFail(
    accountId: string,
    userId: string,
  ): Promise<User> {
    try {
      return await this.users.findOneByOrFail({
        id: userId,
        accountId,
      });
    } catch (error) {
      throwIfNotFound(error, 'User not found');
    }
  }

  private async findUserOrFail(userId: string): Promise<User> {
    try {
      return await this.users.findOneByOrFail({ id: userId });
    } catch (error) {
      throwIfNotFound(error, 'User not found');
    }
  }

  private async importUserRow(
    accountId: string,
    input: ImportUserRowDto,
    row: number,
  ): Promise<ImportUserResultDto> {
    try {
      const { status, user } = await this.createOrRestoreImportedUser(
        accountId,
        input,
      );

      if ('team' in input && typeof input.team === 'string') {
        await this.assignImportedUserToTeam(accountId, user, input.team);
      }

      return {
        row,
        email: input.email.toLowerCase(),
        status,
      };
    } catch (error) {
      return {
        row,
        email: input.email.toLowerCase(),
        status: this.getImportFailureStatus(error),
        message: this.getImportFailureMessage(error),
      };
    }
  }

  private async createOrRestoreImportedUser(
    accountId: string,
    input: ImportUserRowDto,
  ): Promise<{ status: 'created' | 'restored'; user: User }> {
    const email = input.email.toLowerCase();
    const existingUser = await this.users.findOne({ where: { email } });

    if (existingUser && !existingUser.archivedAt) {
      throw new ConflictException({ error: 'Email already exists' });
    }

    await this.createUser(accountId, input);
    const savedUser = await this.users.findOneByOrFail({ email });

    return {
      status: existingUser ? 'restored' : 'created',
      user: savedUser,
    };
  }

  private async assignImportedUserToTeam(
    accountId: string,
    user: User,
    teamName: string,
  ): Promise<void> {
    const name = teamName.trim();

    if (!name) {
      return;
    }

    const team = await this.findOrCreateImportedTeam(accountId, name);
    const existingMember = await this.teamMembers.findOne({
      where: {
        teamId: team.id,
        userId: user.id,
      },
      withDeleted: true,
    });

    if (existingMember) {
      existingMember.archivedAt = null;
      existingMember.role = 'member';
      await this.teamMembers.save(existingMember);
      return;
    }

    await this.teamMembers.save(
      this.teamMembers.create({
        accountId,
        role: 'member',
        teamId: team.id,
        userId: user.id,
      }),
    );
  }

  private async findOrCreateImportedTeam(
    accountId: string,
    name: string,
  ): Promise<Team> {
    const slug = createTeamSlug(name);
    const existingTeam = await this.teams.findOneBy({
      accountId,
      archivedAt: IsNull(),
      slug,
    });

    if (existingTeam) {
      return existingTeam;
    }

    return this.teams.save(
      this.teams.create({
        accountId,
        createdByUserId: await this.getTeamCreatorUserId(accountId),
        description: null,
        name,
        slug: await this.createUniqueTeamSlug(accountId, name),
      }),
    );
  }

  private async getTeamCreatorUserId(accountId: string): Promise<string> {
    const user = await this.users.findOne({
      where: [
        { accountId, archivedAt: IsNull(), role: 'admin' },
        { accountId, archivedAt: IsNull() },
      ],
      order: { id: 'ASC' },
    });

    if (!user) {
      throw new UnprocessableEntityException({ error: 'Team owner not found' });
    }

    return user.id;
  }

  private async createUniqueTeamSlug(
    accountId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = createTeamSlug(name);
    let slug = baseSlug;
    let index = 2;

    while (await this.teams.existsBy({ accountId, slug })) {
      slug = `${baseSlug}-${index}`;
      index += 1;
    }

    return slug;
  }

  private getImportFailureStatus(
    error: unknown,
  ): ImportUserResultDto['status'] {
    return error instanceof ConflictException ? 'skipped' : 'failed';
  }

  private getImportFailureMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();

      if (typeof response === 'object' && response && 'error' in response) {
        return String(response.error);
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unable to import user';
  }

  private async ensureCanChangeRole(user: User): Promise<void> {
    if (user.role !== 'admin') {
      return;
    }

    await this.ensureAnotherActiveAdmin(user);
  }

  private async ensureCanArchiveUser(user: User): Promise<void> {
    if (user.role !== 'admin') {
      return;
    }

    await this.ensureAnotherActiveAdmin(user);
  }

  private async ensureAnotherActiveAdmin(user: User): Promise<void> {
    const adminCount = await this.users.count({
      where: {
        accountId: user.accountId,
        archivedAt: IsNull(),
        role: 'admin',
      },
    });

    if (adminCount <= 1) {
      throw new ForbiddenException({
        error: 'At least one active admin is required',
      });
    }
  }

  private normalizeRole(role: string | undefined): SignaRole {
    return isSignaRole(role) ? role : 'member';
  }

  private normalizeOptionalName(name: string | undefined): string | null {
    return name?.trim() || null;
  }

  private async upsertUserConfig(input: {
    userId: string;
    key: ProfileAssetKey;
    value: string;
  }): Promise<UserConfig> {
    const config =
      (await this.userConfigs.findOneBy({
        userId: input.userId,
        key: input.key,
      })) ??
      this.userConfigs.create({
        userId: input.userId,
        key: input.key,
      });

    config.value = input.value;

    try {
      return await this.userConfigs.save(config);
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  private assertProfileAssetImage(
    file: UploadedBufferFile | undefined,
    key: ProfileAssetKey,
  ): asserts file is UploadedBufferFile {
    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException({
        error: `${sentenceCase(key)} file is required`,
      });
    }

    if (
      !['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype ?? '')
    ) {
      throw new UnprocessableEntityException({
        error: `${sentenceCase(key)} must be a PNG or JPEG image`,
      });
    }
  }

  private toProfileAssetResponse(
    attachment: Awaited<
      ReturnType<StorageService['findRecordAttachments']>
    >[number],
  ): ProfileAssetResponseDto {
    return {
      uuid: attachment.uuid,
      filename: attachment.blob.filename,
      content_type: attachment.blob.contentType,
      url: this.storageService.createBlobProxyUrl(attachment.blob, 3600),
    };
  }

  private toMfaSetupResponse(user: User): MfaSetupResponseDto {
    return {
      secret: user.otpSecret ?? '',
      provisioning_uri: this.emailVerificationCodes.generateAuthenticatorUri({
        email: user.email,
        secret: user.otpSecret ?? '',
      }),
      otp_required_for_login: user.otpRequiredForLogin,
    };
  }

  private verifyAuthenticatorCode(user: User, code: string): boolean {
    return this.emailVerificationCodes.verifyAuthenticatorCode({
      code,
      secret: user.otpSecret ?? '',
    });
  }

  private async sendUserInvitation(user: User, token: string): Promise<void> {
    const account = await this.accounts.findOneByOrFail({
      id: user.accountId,
    });

    await this.mailService.sendUserInvitation({
      accountId: user.accountId,
      accountName: account.name,
      email: user.email,
      firstName: user.firstName,
      token,
    });
  }

  private toImportUsersResponse(
    results: ImportUserResultDto[],
  ): ImportUsersResponseDto {
    return {
      results,
      total: results.length,
      created: this.countImportResults(results, 'created'),
      restored: this.countImportResults(results, 'restored'),
      skipped: this.countImportResults(results, 'skipped'),
      failed: this.countImportResults(results, 'failed'),
    };
  }

  private countImportResults(
    results: ImportUserResultDto[],
    status: ImportUserResultDto['status'],
  ): number {
    return results.filter((result) => result.status === status).length;
  }

  toUserResponse(user: User): UserResponseDto {
    return {
      id: String(user.id),
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      role: user.role,
      otp_required_for_login: user.otpRequiredForLogin,
      archived_at: user.archivedAt,
    };
  }
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
