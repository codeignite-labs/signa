import { EntityManager } from 'typeorm';

// Unit-test repository boundary only. PostgreSQL integration tests prove locking
// and rollback; this adapter lets controller/service cases share their row spies.
export function attachRepositoryTransaction(
  repositories: Map<unknown, object>,
): EntityManager {
  const manager = {
    connection: { options: { type: 'postgres' } },
    getRepository(target: unknown) {
      const repository = repositories.get(target);
      if (!repository) throw new Error('Unconfigured transaction repository');
      return repository;
    },
    transaction<T>(
      work: (transaction: EntityManager) => Promise<T>,
    ): Promise<T> {
      return work(manager as unknown as EntityManager);
    },
  };
  for (const repository of repositories.values())
    Object.assign(repository, { manager });
  return manager as unknown as EntityManager;
}
