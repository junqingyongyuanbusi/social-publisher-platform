import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  type BrowserSessionRecord,
  type BrowserSessionService,
} from '@social/auth';
import { cookies } from 'next/headers';
import { csrfCookieName, sessionCookieName } from './auth-cookies';
import { browserSessionService } from './browser-auth';
import { assertSameOrigin } from './request-origin';

export async function authenticatedApiFetch(
  request: Request,
  path: string,
  init: RequestInit = {},
  options: { csrf?: boolean } = {}
): Promise<Response> {
  if (!path.startsWith('/api/v1/') || path.includes('..')) throw new Error('Invalid API path');
  const jar = await cookies();
  const sessionId = jar.get(sessionCookieName)?.value;
  if (!sessionId) return Response.json({ code: 'auth_session_missing' }, { status: 401 });
  let service: BrowserSessionService;
  let session: BrowserSessionRecord;
  try {
    service = await browserSessionService();
    session = await service.getSession(sessionId);
  } catch (error) {
    return Response.json(
      { code: error instanceof AuthenticationError ? 'auth_session_invalid' : 'auth_unavailable' },
      { status: error instanceof AuthenticationError ? 401 : 503 }
    );
  }
  if (options.csrf) {
    try {
      assertSameOrigin(request);
      service.verifyCsrf(
        session,
        jar.get(csrfCookieName)?.value ?? '',
        request.headers.get('x-csrf-token') ?? ''
      );
    } catch {
      return Response.json({ code: 'auth_csrf_invalid' }, { status: 403 });
    }
  }

  const base = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001';
  const url = new URL(path, base);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${session.accessToken}`);
  headers.set('x-request-id', request.headers.get('x-request-id') ?? randomUUID());
  headers.set('accept', 'application/json');
  return fetch(url, { ...init, headers, cache: 'no-store' });
}

export async function relay(upstream: Response): Promise<Response> {
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...(upstream.headers.get('x-request-id')
        ? { 'x-request-id': upstream.headers.get('x-request-id') as string }
        : {}),
    },
  });
}
