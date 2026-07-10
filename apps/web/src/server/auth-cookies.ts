import type { NextResponse } from 'next/server';

export const sessionCookieName =
  process.env['NODE_ENV'] === 'production' ? '__Host-sp_session' : 'sp_session';
export const transactionCookieName =
  process.env['NODE_ENV'] === 'production' ? '__Host-sp_auth_tx' : 'sp_auth_tx';
export const csrfCookieName = 'sp_csrf';

const secure = process.env['NODE_ENV'] === 'production';

export function setTransactionCookie(response: NextResponse, value: string): void {
  response.cookies.set(transactionCookieName, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
}

export function setSessionCookies(
  response: NextResponse,
  sessionId: string,
  csrfToken: string
): void {
  const maxAge = Number(process.env['BROWSER_SESSION_TTL_SECONDS'] ?? 28_800);
  response.cookies.set(sessionCookieName, sessionId, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  response.cookies.set(csrfCookieName, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  for (const name of [sessionCookieName, transactionCookieName, csrfCookieName]) {
    response.cookies.set(name, '', {
      httpOnly: name !== csrfCookieName,
      secure,
      path: '/',
      maxAge: 0,
    });
  }
}
