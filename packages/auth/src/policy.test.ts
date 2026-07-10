import { describe, expect, it } from 'vitest';
import { authorize, permissions, type Permission } from './policy.js';
import type { AuthenticatedPrincipal, WorkspaceRole } from './principal.js';

function principal(role: WorkspaceRole): AuthenticatedPrincipal {
  return {
    subject: 'user-1',
    issuer: 'https://identity.example.com',
    memberships: [{ workspaceId: 'workspace-1', role }],
  };
}

describe('workspace authorization policy', () => {
  it('never authorizes a principal outside the workspace', () => {
    expect(authorize(principal('owner'), 'workspace-2', 'workspace.read')).toEqual({
      allowed: false,
      reason: 'not_a_member',
      role: null,
    });
  });

  it('keeps credential management restricted to admin and owner', () => {
    expect(authorize(principal('viewer'), 'workspace-1', 'credential.manage').allowed).toBe(false);
    expect(authorize(principal('operator'), 'workspace-1', 'credential.manage').allowed).toBe(
      false
    );
    expect(authorize(principal('admin'), 'workspace-1', 'credential.manage').allowed).toBe(true);
    expect(authorize(principal('owner'), 'workspace-1', 'credential.manage').allowed).toBe(true);
  });

  it('allows owner all known permissions', () => {
    expect(
      permissions.every(
        (permission: Permission) => authorize(principal('owner'), 'workspace-1', permission).allowed
      )
    ).toBe(true);
  });
});
