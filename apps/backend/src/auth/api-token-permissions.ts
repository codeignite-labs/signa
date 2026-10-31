import type { Request } from 'express';

export const apiTokenPermissions = [
  'templates:read',
  'templates:write',
  'submissions:read',
  'submissions:write',
  'submitters:read',
  'submitters:write',
  'webhooks:read',
  'webhooks:write',
  'tools:use',
  'users:read',
  'users:write',
] as const;

export type ApiTokenPermission = (typeof apiTokenPermissions)[number];

export const defaultApiTokenPermissions: ApiTokenPermission[] = [
  ...apiTokenPermissions,
];

export function normalizeApiTokenPermissions(
  value: unknown,
): ApiTokenPermission[] {
  if (!Array.isArray(value)) {
    return [...defaultApiTokenPermissions];
  }

  return value.filter((item): item is ApiTokenPermission =>
    apiTokenPermissions.includes(item as ApiTokenPermission),
  );
}

export function getRequiredApiTokenPermission(
  request: Request,
): ApiTokenPermission | null {
  const resource = getApiResource(request.path ?? '');

  if (!resource) {
    return null;
  }

  if (resource === 'tools') {
    return 'tools:use';
  }

  return `${resource}:${isReadMethod(request.method) ? 'read' : 'write'}`;
}

function getApiResource(
  path: string,
):
  | 'templates'
  | 'submissions'
  | 'submitters'
  | 'webhooks'
  | 'tools'
  | 'users'
  | null {
  if (path.includes('/templates')) {
    return 'templates';
  }

  if (path.includes('/submissions')) {
    return 'submissions';
  }

  if (path.includes('/webhooks') || path.includes('/webhook-events')) {
    return 'webhooks';
  }

  if (path.includes('/attachments') || path.includes('/events')) {
    return 'submissions';
  }

  if (path.includes('/submitters')) {
    return 'submitters';
  }

  if (path.includes('/tools')) {
    return 'tools';
  }

  if (path.includes('/users') || path.includes('/user')) {
    return 'users';
  }

  return null;
}

function isReadMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
