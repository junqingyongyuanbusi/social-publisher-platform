import type { AuthenticatedPrincipal, WorkspaceRole } from './principal.js';

export const permissions = [
  'workspace.read',
  'workspace.manage',
  'publication.validate',
  'publication.create',
  'publication.cancel',
  'account.manage',
  'credential.manage',
  'diagnostics.read',
] as const;
export type Permission = (typeof permissions)[number];

const grants: Readonly<Record<WorkspaceRole, ReadonlySet<Permission>>> = {
  viewer: new Set(['workspace.read', 'diagnostics.read']),
  operator: new Set([
    'workspace.read',
    'diagnostics.read',
    'publication.validate',
    'publication.create',
    'publication.cancel',
  ]),
  admin: new Set([
    'workspace.read',
    'diagnostics.read',
    'publication.validate',
    'publication.create',
    'publication.cancel',
    'account.manage',
    'credential.manage',
  ]),
  owner: new Set(permissions),
};

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: 'allowed' | 'not_a_member' | 'permission_denied';
  readonly role: WorkspaceRole | null;
}

export function authorize(
  principal: AuthenticatedPrincipal,
  workspaceId: string,
  permission: Permission
): AuthorizationDecision {
  const membership = principal.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership) return { allowed: false, reason: 'not_a_member', role: null };
  if (!grants[membership.role].has(permission)) {
    return { allowed: false, reason: 'permission_denied', role: membership.role };
  }
  return { allowed: true, reason: 'allowed', role: membership.role };
}
