import { Brackets, WhereExpressionBuilder } from 'typeorm';
export function createQueryBuilderFixture<T>() {
  const query = {
    innerJoin: jest.fn<unknown, unknown[]>(),
    update: jest.fn<unknown, unknown[]>(),
    set: jest.fn<unknown, unknown[]>(),
    execute: jest.fn<Promise<unknown>, []>().mockResolvedValue({ affected: 1 }),
    leftJoinAndSelect: jest.fn<unknown, unknown[]>(),
    innerJoinAndSelect: jest.fn<unknown, unknown[]>(),
    leftJoin: jest.fn<unknown, unknown[]>(),
    select: jest.fn<unknown, unknown[]>(),
    addSelect: jest.fn<unknown, unknown[]>(),
    withDeleted: jest.fn<unknown, unknown[]>(),
    where: jest.fn<unknown, unknown[]>(),
    andWhere: jest.fn<unknown, unknown[]>(),
    orWhere: jest.fn<unknown, unknown[]>(),
    orderBy: jest.fn<unknown, unknown[]>(),
    addOrderBy: jest.fn<unknown, unknown[]>(),
    limit: jest.fn<unknown, unknown[]>(),
    take: jest.fn<unknown, unknown[]>(),
    getMany: jest.fn<Promise<T[]>, []>().mockResolvedValue([]),
    getOne: jest.fn<Promise<T | null>, []>().mockResolvedValue(null),
    getRawAndEntities: jest
      .fn<Promise<{ entities: T[]; raw: unknown[] }>, []>()
      .mockResolvedValue({ entities: [], raw: [] }),
  };
  const chained = [
    query.innerJoin,
    query.update,
    query.set,
    query.leftJoinAndSelect,
    query.innerJoinAndSelect,
    query.leftJoin,
    query.select,
    query.addSelect,
    query.withDeleted,
    query.where,
    query.andWhere,
    query.orWhere,
    query.orderBy,
    query.addOrderBy,
    query.limit,
    query.take,
  ];
  for (const method of chained)
    method.mockImplementation((condition: unknown) => {
      if (condition instanceof Brackets)
        condition.whereFactory(query as unknown as WhereExpressionBuilder);
      return query;
    });
  return query;
}
