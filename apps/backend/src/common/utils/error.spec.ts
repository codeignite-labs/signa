import { HttpException } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import {
  localizedError,
  throwDatabaseErrors,
  throwIfNotFound,
  throwIfUniqueConstraint,
} from './error';
function queryError(driver: object) {
  return new QueryFailedError(
    'redacted query',
    [],
    Object.assign(new Error('driver failure'), driver),
  );
}
function capture(run: () => never): HttpException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected HTTP failure');
}
it('keeps localized message keys/arguments and translates missing entities', () => {
  expect(localizedError('errors.example', 'Example')).toEqual({
    i18n_key: 'errors.example',
    error: 'Example',
  });
  expect(localizedError('errors.example', 'Example', { name: 'A' })).toEqual({
    i18n_key: 'errors.example',
    error: 'Example',
    i18n_args: { name: 'A' },
  });
  const missing = new EntityNotFoundError('Template', { id: '1' });
  expect(capture(() => throwIfNotFound(missing)).getResponse()).toEqual({
    error: 'Record not found',
  });
  expect(
    capture(() => throwIfNotFound(missing, 'Template missing')).getResponse(),
  ).toEqual({ error: 'Template missing' });
  expect(capture(() => throwDatabaseErrors(missing)).getStatus()).toBe(404);
});
it('extracts unique field details safely and preserves custom duplicate messages', () => {
  const duplicate = queryError({
    code: '23505',
    detail: 'Key ("external_id")=(duplicate) already exists.',
    table: 'templates',
    constraint: 'unique_external_id',
  });
  const result = capture(() => throwDatabaseErrors(duplicate));
  expect(result.getStatus()).toBe(409);
  expect(result.getResponse()).toMatchObject({
    error: 'External id already exists',
    column: 'external_id',
    value: 'duplicate',
    table: 'templates',
  });
  expect(
    capture(() => throwIfUniqueConstraint(duplicate)).getResponse(),
  ).toMatchObject({ error: 'Record already exists' });
  expect(
    capture(() =>
      throwIfUniqueConstraint(duplicate, 'Already registered'),
    ).getResponse(),
  ).toMatchObject({ error: 'Already registered' });
  expect(
    capture(() =>
      throwDatabaseErrors(queryError({ code: '23505', detail: 'unparseable' })),
    ).getResponse(),
  ).toMatchObject({ error: 'Record already exists' });
});
it.each([
  ['23502', 'name', 400, 'Missing required field: name'],
  ['23502', undefined, 400, 'Missing required field'],
  ['23503', undefined, 400, 'Related record does not exist'],
  ['23514', undefined, 400, 'Value violates a database constraint'],
  ['22P02', undefined, 400, 'Invalid input syntax'],
  ['99999', undefined, 500, 'Database error'],
])(
  'translates PostgreSQL %s into a stable HTTP error',
  (code, column, status, message) => {
    const result = capture(() =>
      throwDatabaseErrors(queryError({ code, column })),
    );
    expect(result.getStatus()).toBe(status);
    expect(result.getResponse()).toMatchObject({ error: message });
  },
);
it('rethrows unknown failures and nonmatching constraints without converting them', () => {
  const original = new Error('unrelated');
  const noCode = queryError({});
  const other = queryError({ code: '23503' });
  for (const run of [
    () => throwIfNotFound(original),
    () => throwIfUniqueConstraint(original),
    () => throwIfUniqueConstraint(other),
    () => throwDatabaseErrors(original),
    () => throwDatabaseErrors(noCode),
  ])
    expect(run).toThrow();
});
