import type { Request } from 'express';
import {
  apiTokenPermissions,
  defaultApiTokenPermissions,
  getRequiredApiTokenPermission,
  normalizeApiTokenPermissions,
} from './api-token-permissions';
it('normalizes untrusted permission input without expanding a valid explicit restriction', () => {
  const fallback = normalizeApiTokenPermissions(null);
  expect(fallback).toEqual(defaultApiTokenPermissions);
  expect(fallback).not.toBe(defaultApiTokenPermissions);
  expect(normalizeApiTokenPermissions([])).toEqual([]);
  expect(
    normalizeApiTokenPermissions(['templates:read', 'unknown', null, 3]),
  ).toEqual(['templates:read']);
  expect(normalizeApiTokenPermissions(apiTokenPermissions)).toEqual(
    apiTokenPermissions,
  );
});
const resources = [
  ['/api/templates/1', 'templates'],
  ['/api/submissions/1/events', 'submissions'],
  ['/api/attachments/1', 'submissions'],
  ['/api/events/1', 'submissions'],
  ['/api/submitters/1', 'submitters'],
  ['/api/webhooks/1', 'webhooks'],
  ['/api/webhooks/1/events', 'webhooks'],
  ['/api/webhook-events/1/resend', 'webhooks'],
  ['/api/users/1', 'users'],
  ['/api/user', 'users'],
] as const;
describe.each(resources)('permission for %s', (path, resource) => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s is scoped to its owning resource',
    (method) => {
      expect(getRequiredApiTokenPermission({ path, method } as Request)).toBe(
        `${resource}:${['GET', 'HEAD', 'OPTIONS', 'get'].includes(method) ? 'read' : 'write'}`,
      );
    },
  );
});
it('assigns tool-use and leaves routes without an API permission explicit', () => {
  expect(
    getRequiredApiTokenPermission({
      path: '/api/tools/verify',
      method: 'POST',
    } as Request),
  ).toBe('tools:use');
  expect(
    getRequiredApiTokenPermission({
      path: '/health',
      method: 'GET',
    } as Request),
  ).toBeNull();
  expect(
    getRequiredApiTokenPermission({ method: 'GET' } as Request),
  ).toBeNull();
});
