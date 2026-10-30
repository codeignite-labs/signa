import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNull, Repository } from 'typeorm';
import { throwDatabaseErrors } from '../common/utils/error';
import { User } from '../users/entities/user.entity';
import { TeamMember } from './entities/team-member.entity';
import { toMemberResponse } from './team-response.mapper';
import { TeamRole } from './team-roles';

type MemberScope = { accountId: string; teamId: string; memberId: string };

// Callers hold the team row lock and pass its transaction-bound repository.
export async function addTeamMember(
  members: Repository<TeamMember>,
  options: {
    accountId: string;
    teamId: string;
    role: TeamRole;
    user: User;
  },
) {
  const existing = await members.findOne({
    where: {
      accountId: options.accountId,
      teamId: options.teamId,
      userId: options.user.id,
    },
    withDeleted: true,
    relations: { user: true },
  });
  if (existing) {
    if (
      !existing.archivedAt &&
      existing.role === 'manager' &&
      options.role !== 'manager'
    ) {
      await assertAnotherManager(members, existing);
    }
    existing.archivedAt = null;
    existing.role = options.role;
    return toMemberResponse(await members.save(existing));
  }
  const member = members.create({
    accountId: options.accountId,
    teamId: options.teamId,
    role: options.role,
    userId: options.user.id,
    user: options.user,
  });
  try {
    return toMemberResponse(await members.save(member));
  } catch (error) {
    throwDatabaseErrors(error);
  }
}
export async function updateTeamMemberRole(
  members: Repository<TeamMember>,
  options: MemberScope & { role: TeamRole },
) {
  const member = await findMember(members, options);
  if (member.role === 'manager' && options.role !== 'manager')
    await assertAnotherManager(members, member);
  member.role = options.role;
  return toMemberResponse(await members.save(member));
}
export async function archiveTeamMember(
  members: Repository<TeamMember>,
  options: MemberScope,
) {
  const member = await findMember(members, options);
  if (member.role === 'manager') await assertAnotherManager(members, member);
  member.archivedAt = new Date();
  return toMemberResponse(await members.save(member));
}
async function findMember(
  members: Repository<TeamMember>,
  options: MemberScope,
): Promise<TeamMember> {
  const member = await members.findOne({
    where: {
      accountId: options.accountId,
      teamId: options.teamId,
      id: options.memberId,
      archivedAt: IsNull(),
    },
    relations: { user: true },
  });
  if (!member) throw new NotFoundException({ error: 'Team member not found' });
  return member;
}
async function assertAnotherManager(
  members: Repository<TeamMember>,
  member: TeamMember,
): Promise<void> {
  const count = await members.count({
    where: {
      accountId: member.accountId,
      teamId: member.teamId,
      role: 'manager',
      archivedAt: IsNull(),
    },
  });
  if (count <= 1)
    throw new BadRequestException({
      error: 'A team must have at least one manager',
    });
}
