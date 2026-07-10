import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authorize, type AccessTokenVerifier, type Permission } from '@social/auth';
import type { AuthenticatedRequest } from './authenticated-request.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AUTH_PRINCIPAL,
  PUBLIC_ROUTE,
  REQUIRED_PERMISSION,
} from './auth.constants.js';

@Injectable()
export class OidcAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.header('authorization'));
    if (!token) throw new UnauthorizedException('auth_token_missing');

    try {
      request[AUTH_PRINCIPAL] = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException('auth_token_invalid');
    }

    const permission = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const workspaceId = request.params['workspaceId'];
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new ForbiddenException('auth_workspace_forbidden');
    }
    const decision = authorize(request[AUTH_PRINCIPAL], workspaceId, permission);
    if (!decision.allowed) {
      // The same response is used for non-members and insufficient roles to avoid workspace enumeration.
      throw new ForbiddenException('auth_workspace_forbidden');
    }
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1] ?? null;
}
