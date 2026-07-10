import { NextResponse } from 'next/server';
import { setTransactionCookie } from '../../../../server/auth-cookies';
import { browserSessionService } from '../../../../server/browser-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get('returnTo') ?? '/zh-CN';
  const login = await (await browserSessionService()).beginLogin(returnTo);
  const response = NextResponse.redirect(login.authorizationUrl, 302);
  setTransactionCookie(response, login.transactionId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
