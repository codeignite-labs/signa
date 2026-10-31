import { EntityManager } from 'typeorm';
import { Team } from './entities/team.entity';

// Acquire the team lock before reading membership roles or locking an account.
// Invitation acceptance follows the same order to avoid stale role overwrites.
export function lockTeamMemberships(
  manager: EntityManager,
  options: { accountId: string; teamId: string; includeArchived?: boolean },
): Promise<Team | null> {
  return manager.getRepository(Team).findOne({
    where: { accountId: options.accountId, id: options.teamId },
    withDeleted: options.includeArchived ?? false,
    ...(manager.connection.options.type === 'postgres'
      ? { lock: { mode: 'pessimistic_write' as const } }
      : {}),
  });
}
