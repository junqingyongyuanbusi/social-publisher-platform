import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionCookieName } from '../../../../server/auth-cookies';
import { browserSessionService } from '../../../../server/browser-auth';

export async function GET(): Promise<NextResponse> {
  const sessionId = (await cookies()).get(sessionCookieName)?.value;
  if (!sessionId) return NextResponse.json({ authenticated: false }, { status: 401 });
  try {
    const session = await (await browserSessionService()).getSession(sessionId);
    return NextResponse.json(
      {
        authenticated: true,
        subject: session.subject,
        expiresAt: new Date(session.sessionExpiresAt).toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
