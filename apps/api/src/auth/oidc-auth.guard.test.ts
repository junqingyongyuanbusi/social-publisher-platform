import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AccessTokenVerifier, AuthenticatedPrincipal, Permission } from '@social/auth';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { OidcAuthGuard } from './oidc-auth.guard.js';

const admin: AuthenticatedPrincipal = {
  subject: 'admin-1',
  issuer: 'https://identity.example.com',
  memberships: [{ workspaceId: 'workspace-1', role: 'admin' }],
};

function fixture(options: {
  public?: boolean;
  permission?: Permission;
  authorization?: string;
  workspaceId?: string;
  principal?: AuthenticatedPrincipal;
}) {
  const reflector = {
    getAllAndOverride: vi.fn((key: symbol) => {
      if (key.description === 'PUBLIC_ROUTE') return options.public;
      if (key.description === 'REQUIRED_PERMISSION') return options.permission;
      return undefined;
    }),
  } as unknown as Reflector;
  const verifier: AccessTokenVerifier = {
    verify: vi.fn(async () => options.principal ?? admin),
  };
  const request = {
    header: vi.fn((name: string) => (name === 'authorization' ? options.authorization : undefined)),
    params: options.workspaceId ? { workspaceId: options.workspaceId } : {},
  } as unknown as AuthenticatedRequest;
  const context = {
    getHandler: () => fixture,
    getClass: () => OidcAuthGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard: new OidcAuthGuard(reflector, verifier), context, verifier };
}

describe('OidcAuthGuard', () => {
  it('allows explicitly public routes without token verification', async () => {
    const { guard, context, verifier } = fixture({ public: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects missing and malformed bearer headers', async () => {
    const missing = fixture({});
    await expect(missing.guard.canActivate(missing.context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    const malformed = fixture({ authorization: 'Basic abc' });
    await expect(malformed.guard.canActivate(malformed.context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('does not reveal whether a workspace exists or the role is insufficient', async () => {
    const outsider = fixture({
      authorization: 'Bearer valid.jwt.token',
      workspaceId: 'workspace-2',
      permission: 'credential.manage',
    });
    await expect(outsider.guard.canActivate(outsider.context)).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'auth_workspace_forbidden' }),
    });

    const viewer = fixture({
      authorization: 'Bearer valid.jwt.token',
      workspaceId: 'workspace-1',
      permission: 'credential.manage',
      principal: { ...admin, memberships: [{ workspaceId: 'workspace-1', role: 'viewer' }] },
    });
    await expect(viewer.guard.canActivate(viewer.context)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('allows an admin to manage credentials in its own workspace', async () => {
    const { guard, context } = fixture({
      authorization: 'Bearer valid.jwt.token',
      workspaceId: 'workspace-1',
      permission: 'credential.manage',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
