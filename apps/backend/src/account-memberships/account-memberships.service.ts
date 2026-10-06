import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { MailService } from '../mail/mail.service';
import { AccountMembership } from './entities/account-membership.entity';
import { TeamInvitation } from '../teams/entities/team-invitation.entity';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { createHash } from 'node:crypto';

@Injectable()
export class AccountMembershipsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
  ) {}

  async resolveUser(
    userId: string,
    accountId: string,
    manager = this.dataSource.manager,
  ): Promise<User | null> {
    const user = await manager.findOne(User, {
      where: { id: userId, archivedAt: IsNull() },
      relations: { account: true },
    });
    if (!user) return null;
    const membership = await manager.findOne(AccountMembership, {
      where: { userId, accountId },
      relations: { account: true },
    });
    if (!membership && String(user.accountId) === String(accountId))
      return !user.account || user.account.archivedAt ? null : user;
    if (
      !membership ||
      membership.archivedAt ||
      !membership.acceptedAt ||
      !membership.account ||
      membership.account.archivedAt
    )
      return null;
    return Object.assign(new User(), user, {
      accountId: membership.accountId,
      account: membership.account,
      role: membership.role,
    });
  }

  async listAccounts(userId: string) {
    const user = await this.dataSource.manager.findOneOrFail(User, {
      where: { id: userId },
      relations: { account: true },
    });
    const memberships = await this.dataSource.manager.find(AccountMembership, {
      where: { userId, archivedAt: IsNull() },
      relations: { account: true },
      order: { createdAt: 'ASC' },
    });
    return [
      ...(user.account &&
      !user.account.archivedAt &&
      !(await this.hasMembershipRecord(user.accountId, userId))
        ? [
            {
              id: user.accountId,
              name: user.account.name,
              role: user.role,
              status: 'active',
            },
          ]
        : []),
      ...memberships
        .filter((item) => item.account && !item.account.archivedAt)
        .map((item) => ({
          id: item.accountId,
          name: item.account.name,
          role: item.role,
          status: item.acceptedAt
            ? 'active'
            : item.expiresAt && item.expiresAt < new Date()
              ? 'expired'
              : 'invited',
        })),
    ];
  }

  async invite(accountId: string, user: User, role: string) {
    if (user.archivedAt)
      throw new ForbiddenException('This login identity is inactive');
    const repository = this.dataSource.getRepository(AccountMembership);
    const existing = await repository.findOneBy({ accountId, userId: user.id });
    if (existing?.acceptedAt && !existing.archivedAt)
      throw new ConflictException({
        error: 'User already belongs to this account',
      });
    const account = await this.dataSource.manager.findOneByOrFail(Account, {
      id: accountId,
      archivedAt: IsNull(),
    });
    const membership = await repository.save(
      repository.create({
        ...existing,
        accountId,
        userId: user.id,
        role,
        acceptedAt: null,
        archivedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    await this.mail.sendAccountInvitation({
      accountId,
      accountName: account.name,
      email: user.email,
      firstName: user.firstName,
    });
    return Object.assign(new User(), user, {
      accountId,
      role: membership.role,
    });
  }

  async accept(accountId: string, userId: string): Promise<User> {
    await this.dataSource.transaction(async (manager) => {
      const membership = await manager.findOne(AccountMembership, {
        where: { accountId, userId, archivedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new NotFoundException('Invitation not found');
      if (!membership.acceptedAt) {
        if (!membership.expiresAt || membership.expiresAt < new Date())
          throw new ForbiddenException('Invitation has expired');
        membership.acceptedAt = new Date();
        await manager.save(membership);
      }
    });
    const user = await this.resolveUser(userId, accountId);
    if (!user) throw new ForbiddenException('Account is unavailable');
    return user;
  }

  async acceptTeamInvitation(token: string, user: User): Promise<TeamMember> {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await manager.findOne(TeamInvitation, {
        where: {
          tokenHash: createHash('sha256').update(token).digest('hex'),
          status: 'pending',
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation || invitation.expiresAt < new Date())
        throw new ForbiddenException('Invitation is invalid or expired');
      if (invitation.email.toLowerCase() !== user.email.toLowerCase())
        throw new ForbiddenException(
          'Invitation belongs to a different email address',
        );
      const team = await manager.findOneBy(Team, {
        id: invitation.teamId,
        accountId: invitation.accountId,
        archivedAt: IsNull(),
      });
      const account = await manager.findOne(Account, {
        where: { id: invitation.accountId, archivedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!team || !account)
        throw new ForbiddenException('Account or team is unavailable');
      await this.joinInvitedAccount(manager, invitation.accountId, user);
      const existing = await manager.findOne(TeamMember, {
        where: {
          accountId: invitation.accountId,
          teamId: team.id,
          userId: user.id,
        },
        withDeleted: true,
      });
      const member = await manager.save(
        TeamMember,
        manager.create(TeamMember, {
          ...existing,
          accountId: invitation.accountId,
          teamId: team.id,
          userId: user.id,
          role:
            existing && !existing.archivedAt ? existing.role : invitation.role,
          archivedAt: null,
        }),
      );
      invitation.status = 'accepted';
      invitation.acceptedAt = new Date();
      await manager.save(invitation);
      member.user = (await this.resolveUser(
        user.id,
        invitation.accountId,
        manager,
      ))!;
      return member;
    });
  }

  private async joinInvitedAccount(
    manager: EntityManager,
    accountId: string,
    user: User,
  ) {
    if (await this.resolveUser(user.id, accountId, manager)) return;
    const existing = await manager.findOneBy(AccountMembership, {
      accountId,
      userId: user.id,
    });
    await manager.save(
      AccountMembership,
      manager.create(AccountMembership, {
        ...existing,
        accountId,
        userId: user.id,
        role: existing && !existing.archivedAt ? existing.role : 'member',
        acceptedAt: new Date(),
        archivedAt: null,
      }),
    );
  }

  async listMembers(accountId: string, archived: boolean) {
    const memberships = await this.dataSource.manager.find(AccountMembership, {
      where: { accountId, archivedAt: archived ? Not(IsNull()) : IsNull() },
      relations: { user: true },
    });
    return memberships
      .filter((item) => item.user && !item.user.archivedAt)
      .map((item) => ({
        user: Object.assign(new User(), item.user, {
          accountId,
          role: item.role,
          archivedAt: item.archivedAt,
        }),
        status: item.acceptedAt
          ? 'active'
          : item.expiresAt && item.expiresAt < new Date()
            ? 'expired'
            : 'invited',
      }));
  }

  hasMembershipRecord(accountId: string, userId: string): Promise<boolean> {
    return this.dataSource.manager.existsBy(AccountMembership, {
      accountId,
      userId,
    });
  }

  async membershipUserIds(accountId: string): Promise<Set<string>> {
    const rows = await this.dataSource.manager.find(AccountMembership, {
      where: { accountId },
      select: { userId: true },
    });
    return new Set(rows.map((row) => String(row.userId)));
  }

  async changeMember(
    accountId: string,
    userId: string,
    input: { role?: string; archive?: boolean },
  ) {
    return this.dataSource.transaction(async (manager) => {
      // Account-level lock serializes concurrent admin removals/demotions.
      await manager.findOne(Account, {
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      let membership = await manager.findOne(AccountMembership, {
        where: { accountId, userId },
        relations: { user: true },
      });
      if (!membership) {
        const user = await manager.findOneBy(User, { id: userId, accountId });
        if (!user || !input.archive) return null;
        membership = manager.create(AccountMembership, {
          accountId,
          userId,
          role: user.role,
          acceptedAt: new Date(),
          user,
        });
      }
      if (
        membership.role === 'admin' &&
        (input.archive || (input.role && input.role !== 'admin'))
      )
        await this.assertAnotherAdmin(manager, accountId, userId);
      if (input.role) membership.role = input.role;
      if (input.archive) membership.archivedAt = new Date();
      await manager.save(membership);
      return Object.assign(new User(), membership.user, {
        accountId,
        role: membership.role,
        archivedAt: membership.archivedAt,
      });
    });
  }

  private async assertAnotherAdmin(
    manager: EntityManager,
    accountId: string,
    userId: string,
  ) {
    const candidates = await manager.find(User, {
      where: {
        accountId,
        role: 'admin',
        archivedAt: IsNull(),
        id: Not(userId),
      },
    });
    const members = await manager.find(AccountMembership, {
      where: {
        accountId,
        role: 'admin',
        archivedAt: IsNull(),
        acceptedAt: Not(IsNull()),
        userId: Not(userId),
      },
    });
    for (const id of new Set([
      ...candidates.map((user) => user.id),
      ...members.map((member) => member.userId),
    ])) {
      if ((await this.resolveUser(id, accountId, manager))?.role === 'admin')
        return;
    }
    throw new ForbiddenException('At least one active admin is required');
  }
}
