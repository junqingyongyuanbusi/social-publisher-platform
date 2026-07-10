import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { setSessionCookies, transactionCookieName } from '../../../../server/auth-cookies';
import { browserSessionService } from '../../../../server/browser-auth';
import { applicationOrigin } from '../../../../server/request-origin';

export async function GET(request: Request): Promise<NextResponse> {
  const transactionId = (await cookies()).get(transactionCookieName)?.value;
  if (!transactionId)
    return NextResponse.json({ code: 'auth_transaction_missing' }, { status: 400 });
  const completed = await (
    await browserSessionService()
  ).completeLogin(new URL(request.url), transactionId);
  const response = NextResponse.redirect(
    new URL(completed.returnTo, applicationOrigin(request)),
    303
  );
  setSessionCookies(response, completed.sessionId, completed.csrfToken);
  response.cookies.set(transactionCookieName, '', { path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
