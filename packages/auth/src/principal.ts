export const workspaceRoles = ['viewer', 'operator', 'admin', 'owner'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export interface WorkspaceMembership {
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
}

export interface AuthenticatedPrincipal {
  readonly subject: string;
  readonly issuer: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly memberships: readonly WorkspaceMembership[];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && workspaceRoles.includes(value as WorkspaceRole);
}

export function parseMemberships(value: unknown): readonly WorkspaceMembership[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new AuthenticationError('auth_memberships_invalid');
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new AuthenticationError('auth_memberships_invalid');
    }
    const workspaceId = Reflect.get(entry, 'workspaceId');
    const role = Reflect.get(entry, 'role');
    if (
      typeof workspaceId !== 'string' ||
      workspaceId.length === 0 ||
      workspaceId.length > 200 ||
      !isWorkspaceRole(role) ||
      seen.has(workspaceId)
    ) {
      throw new AuthenticationError('auth_memberships_invalid');
    }
    seen.add(workspaceId);
    return { workspaceId, role };
  });
}

export class AuthenticationError extends Error {
  constructor(
    public readonly code: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'AuthenticationError';
  }
}
