import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  clearAuthCookies,
  csrfCookieName,
  sessionCookieName,
} from '../../../../server/auth-cookies';
import { browserSessionService } from '../../../../server/browser-auth';
import { assertSameOrigin } from '../../../../server/request-origin';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ code: 'auth_csrf_invalid' }, { status: 403 });
  }
  const jar = await cookies();
  const sessionId = jar.get(sessionCookieName)?.value;
  const csrfCookie = jar.get(csrfCookieName)?.value ?? '';
  const form = await request.formData();
  const csrfSubmitted = form.get('csrf');
  if (!sessionId || typeof csrfSubmitted !== 'string') {
    return NextResponse.json({ code: 'auth_session_missing' }, { status: 401 });
  }
  const service = await browserSessionService();
  const session = await service.getSession(sessionId);
  try {
    service.verifyCsrf(session, csrfCookie, csrfSubmitted);
  } catch {
    return NextResponse.json({ code: 'auth_csrf_invalid' }, { status: 403 });
  }
  await service.logout(sessionId);
  const response = NextResponse.json({ success: true });
  clearAuthCookies(response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
