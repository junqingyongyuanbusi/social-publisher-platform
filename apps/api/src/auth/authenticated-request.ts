import type { AuthenticatedPrincipal } from '@social/auth';
import type { Request } from 'express';
import { AUTH_PRINCIPAL } from './auth.constants.js';

export type AuthenticatedRequest = Request & { [AUTH_PRINCIPAL]?: AuthenticatedPrincipal };

export function getPrincipal(request: AuthenticatedRequest): AuthenticatedPrincipal {
  const principal = request[AUTH_PRINCIPAL];
  if (!principal) throw new Error('Authenticated principal is unavailable');
  return principal;
}
