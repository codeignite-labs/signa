import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  throwDatabaseErrors,
  throwIfUniqueConstraint,
} from '../common/utils/error';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { CreateTeamInvitationDto } from './dto/create-team-invitation.dto';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamInvitationResponseDto } from './dto/team-invitation-response.dto';
import { TeamMemberResponseDto } from './dto/team-member-response.dto';
import { TeamResponseDto } from './dto/team-response.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamInvitation } from './entities/team-invitation.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team } from './entities/team.entity';
import {
  toInvitationResponse,
  toMemberResponse,
  toTeamResponse,
} from './team-response.mapper';
import { createTeamSlug } from './team-slug';
import { isTeamRole, type TeamRole } from './team-roles';
import { AccountMembershipsService } from '../account-memberships/account-memberships.service';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teams: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMembers: Repository<TeamMember>,
    @InjectRepository(TeamInvitation)
    private readonly invitations: Repository<TeamInvitation>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly mail: MailService,
    private readonly memberships: AccountMembershipsService,
  ) {}

  async createDefaultTeam(options: {
    accountId: string;
    userId: string;
    name: string;
  }): Promise<Team> {
    const team = this.teams.create({
      accountId: options.accountId,
      createdByUserId: options.userId,
      name: options.name,
      slug: await this.createUniqueSlug(options.accountId, options.name),
    });
    const savedTeam = await this.teams.save(team);

    await this.teamMembers.save(
      this.teamMembers.create({
        accountId: options.accountId,
        role: 'manager',
        teamId: savedTeam.id,
        userId: options.userId,
      }),
    );

    return savedTeam;
  }

  async listTeams(options: {
    accountId: string;
    status?: string;
  }): Promise<TeamResponseDto[]> {
    const archivedAt = options.status === 'archived' ? Not(IsNull()) : IsNull();
    const teams = await this.teams.find({
      where: { accountId: options.accountId, archivedAt },
      relations: { members: true },
      order: { id: 'DESC' },
    });

    return teams.map((team) => toTeamResponse(team));
  }

  async createTeam(options: {
    accountId: string;
    user: User;
    input: CreateTeamDto;
  }): Promise<TeamResponseDto> {
    this.ensureAccountAdmin(options.user);

    const team = this.teams.create({
      accountId: options.accountId,
      createdByUserId: options.user.id,
      description: options.input.description ?? null,
      name: options.input.name.trim(),
      slug: await this.createUniqueSlug(options.accountId, options.input.name),
    });

    try {
      const savedTeam = await this.teams.save(team);
      await this.addMember({
        accountId: options.accountId,
        actor: options.user,
        input: { role: 'manager', user_id: options.user.id },
        skipPermissionCheck: true,
        teamId: savedTeam.id,
      });

      return this.getTeam({
        accountId: options.accountId,
        teamId: savedTeam.id,
      });
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async getTeam(options: {
    accountId: string;
    teamId: string;
  }): Promise<TeamResponseDto> {
    return toTeamResponse(await this.findAccountTeamOrFail(options));
  }

  async updateTeam(options: {
    accountId: string;
    actor: User;
    input: UpdateTeamDto;
    teamId: string;
  }): Promise<TeamResponseDto> {
    const team = await this.findAccountTeamOrFail(options);
    await this.ensureCanManageTeam(options.actor, team.id);

    team.name = options.input.name?.trim() ?? team.name;
    team.description =
      typeof options.input.description === 'undefined'
        ? team.description
        : options.input.description;

    try {
      return toTeamResponse(await this.teams.save(team));
    } catch (error) {
      throwIfUniqueConstraint(error, 'Team already exists');
    }
  }

  async archiveTeam(options: {
    accountId: string;
    actor: User;
    teamId: string;
  }): Promise<TeamResponseDto> {
    const team = await this.findAccountTeamOrFail(options);
    await this.ensureCanManageTeam(options.actor, team.id);
    team.archivedAt = new Date();

    try {
      return toTeamResponse(await this.teams.save(team));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async listMembers(options: {
    accountId: string;
    teamId: string;
  }): Promise<TeamMemberResponseDto[]> {
    await this.findAccountTeamOrFail({ ...options, includeArchived: true });
    const members = await this.teamMembers.find({
      where: {
        accountId: options.accountId,
        archivedAt: IsNull(),
        teamId: options.teamId,
      },
      relations: { user: true },
      order: { id: 'ASC' },
    });

    return members.map((member) => toMemberResponse(member));
  }

  async addMember(options: {
    accountId: string;
    actor: User;
    input: CreateTeamMemberDto;
    skipPermissionCheck?: boolean;
    teamId: string;
  }): Promise<TeamMemberResponseDto> {
    await this.findAccountTeamOrFail(options);

    if (!options.skipPermissionCheck) {
      await this.ensureCanManageTeam(options.actor, options.teamId);
    }

    const user = await this.findActiveAccountUserOrFail({
      accountId: options.accountId,
      userId: options.input.user_id,
    });
    const existingMember = await this.teamMembers.findOne({
      where: {
        accountId: options.accountId,
        teamId: options.teamId,
        userId: user.id,
      },
      withDeleted: true,
      relations: { user: true },
    });
    const role = this.normalizeRole(options.input.role);

    if (existingMember) {
      existingMember.archivedAt = null;
      existingMember.role = role;
      return toMemberResponse(await this.teamMembers.save(existingMember));
    }

    const member = this.teamMembers.create({
      accountId: options.accountId,
      role,
      teamId: options.teamId,
      userId: user.id,
      user,
    });

    try {
      return toMemberResponse(await this.teamMembers.save(member));
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async updateMember(options: {
    accountId: string;
    actor: User;
    input: UpdateTeamMemberDto;
    memberId: string;
    teamId: string;
  }): Promise<TeamMemberResponseDto> {
    await this.ensureCanManageTeam(options.actor, options.teamId);
    const member = await this.findActiveMemberOrFail(options);
    const role = this.normalizeRole(options.input.role);

    if (member.role === 'manager' && role !== 'manager') {
      await this.ensureAnotherManager(member);
    }

    member.role = role;
    return toMemberResponse(await this.teamMembers.save(member));
  }

  async removeMember(options: {
    accountId: string;
    actor: User;
    memberId: string;
    teamId: string;
  }): Promise<TeamMemberResponseDto> {
    await this.ensureCanManageTeam(options.actor, options.teamId);
    const member = await this.findActiveMemberOrFail(options);

    if (member.role === 'manager') {
      await this.ensureAnotherManager(member);
    }

    member.archivedAt = new Date();
    return toMemberResponse(await this.teamMembers.save(member));
  }

  async listInvitations(options: {
    accountId: string;
    teamId: string;
  }): Promise<TeamInvitationResponseDto[]> {
    await this.findAccountTeamOrFail({ ...options, includeArchived: true });
    const invitations = await this.invitations.find({
      where: { accountId: options.accountId, teamId: options.teamId },
      order: { id: 'DESC' },
    });

    return invitations.map((invitation) => toInvitationResponse(invitation));
  }

  async createInvitation(options: {
    accountId: string;
    actor: User;
    input: CreateTeamInvitationDto;
    teamId: string;
  }): Promise<TeamInvitationResponseDto> {
    await this.ensureCanManageTeam(options.actor, options.teamId);
    const team = await this.findAccountTeamOrFail(options);

    const token = randomBytes(32).toString('base64url');
    const invitation = this.invitations.create({
      accountId: options.accountId,
      createdByUserId: options.actor.id,
      email: options.input.email.toLowerCase(),
      expiresAt: this.createInvitationExpiry(),
      role: this.normalizeRole(options.input.role),
      status: 'pending',
      teamId: options.teamId,
      tokenHash: this.hashInvitationToken(token),
    });

    try {
      const savedInvitation = await this.invitations.save(invitation);

      await this.mail.sendTeamInvitation({
        accountId: options.accountId,
        accountName: options.actor.account?.name ?? team.name,
        email: savedInvitation.email,
        expiresAt: savedInvitation.expiresAt,
        inviterName: this.formatUserName(options.actor),
        role: savedInvitation.role,
        teamName: team.name,
        token,
      });

      return toInvitationResponse(savedInvitation, {
        acceptToken: token,
      });
    } catch (error) {
      throwDatabaseErrors(error);
    }
  }

  async revokeInvitation(options: {
    accountId: string;
    actor: User;
    invitationId: string;
    teamId: string;
  }): Promise<TeamInvitationResponseDto> {
    await this.ensureCanManageTeam(options.actor, options.teamId);
    const invitation = await this.findAccountInvitationOrFail(options);

    if (invitation.status === 'pending') {
      invitation.status = 'revoked';
    }

    return toInvitationResponse(await this.invitations.save(invitation));
  }

  async acceptInvitation(options: {
    token: string;
    user: User;
  }): Promise<TeamMemberResponseDto> {
    return toMemberResponse(
      await this.memberships.acceptTeamInvitation(options.token, options.user),
    );
  }

  async assertCanUseTeamAction(options: {
    accountId: string;
    actor: User;
    teamId: string;
  }): Promise<void> {
    await this.findAccountTeamOrFail(options);
    await this.ensureCanManageTeam(options.actor, options.teamId);
  }

  private async createUniqueSlug(
    accountId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = createTeamSlug(name);
    let slug = baseSlug;
    let suffix = 2;

    while (await this.teams.existsBy({ accountId, slug })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private createInvitationExpiry(): Date {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    return expiresAt;
  }

  private async ensureAnotherManager(member: TeamMember): Promise<void> {
    const managerCount = await this.teamMembers.count({
      where: {
        archivedAt: IsNull(),
        role: 'manager',
        teamId: member.teamId,
      },
    });

    if (managerCount <= 1) {
      throw new BadRequestException({
        error: 'A team must have at least one manager',
      });
    }
  }

  private ensureAccountAdmin(user: User): void {
    if (user.role !== 'admin') {
      throw new ForbiddenException({ error: 'Account admin access required' });
    }
  }

  private async ensureCanManageTeam(user: User, teamId: string): Promise<void> {
    if (user.role === 'admin') {
      return;
    }

    const member = await this.teamMembers.findOneBy({
      archivedAt: IsNull(),
      role: 'manager',
      teamId,
      userId: user.id,
    });

    if (!member) {
      throw new ForbiddenException({ error: 'Team manager access required' });
    }
  }

  private async findAccountTeamOrFail(options: {
    accountId: string;
    includeArchived?: boolean;
    teamId: string;
  }): Promise<Team> {
    const team = await this.teams.findOne({
      where: {
        accountId: options.accountId,
        ...(options.includeArchived ? {} : { archivedAt: IsNull() }),
        id: options.teamId,
      },
      relations: { members: true },
    });

    if (!team) {
      throw new NotFoundException({ error: 'Team not found' });
    }

    return team;
  }

  private async findActiveAccountUserOrFail(options: {
    accountId: string;
    userId: string;
  }): Promise<User> {
    const user = await this.memberships.resolveUser(
      options.userId,
      options.accountId,
    );

    if (!user) {
      throw new NotFoundException({ error: 'User not found' });
    }

    return user;
  }

  private async findActiveMemberOrFail(options: {
    accountId: string;
    memberId: string;
    teamId: string;
  }): Promise<TeamMember> {
    const member = await this.teamMembers.findOne({
      where: {
        accountId: options.accountId,
        archivedAt: IsNull(),
        id: options.memberId,
        teamId: options.teamId,
      },
      relations: { user: true },
    });

    if (!member) {
      throw new NotFoundException({ error: 'Team member not found' });
    }

    return member;
  }

  private async findAccountInvitationOrFail(options: {
    accountId: string;
    invitationId: string;
    teamId: string;
  }): Promise<TeamInvitation> {
    const invitation = await this.invitations.findOneBy({
      accountId: options.accountId,
      id: options.invitationId,
      teamId: options.teamId,
    });

    if (!invitation) {
      throw new NotFoundException({ error: 'Invitation not found' });
    }

    return invitation;
  }

  private async findPendingInvitationByToken(
    token: string,
  ): Promise<TeamInvitation> {
    const invitation = await this.invitations.findOneBy({
      status: 'pending',
      tokenHash: this.hashInvitationToken(token),
    });

    if (!invitation) {
      throw new NotFoundException({ error: 'Invitation not found' });
    }

    return invitation;
  }

  private hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private normalizeRole(role: string | undefined): TeamRole {
    return isTeamRole(role) ? role : 'member';
  }

  private formatUserName(user: User): string {
    const name = [user.firstName, user.lastName]
      .filter((part): part is string => !!part?.trim())
      .join(' ');

    return name || user.email;
  }
}
