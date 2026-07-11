import { authenticatedApiFetch } from '../../../../server/api-fetch';

export async function GET(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get('code');
  const state = incoming.searchParams.get('state');
  const error = incoming.searchParams.get('error');
  if (error || !code || !state) return redirect('/zh-CN/accounts?oauth=denied');
  const upstream = await authenticatedApiFetch(request, '/api/v1/platform-oauth/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
  });
  if (!upstream.ok) return redirect('/zh-CN/accounts?oauth=failed');
  const result = (await upstream.json()) as { returnTo?: string };
  return redirect(`${result.returnTo ?? '/zh-CN/accounts'}?oauth=connected`);
}
function redirect(path: string): Response {
  return Response.redirect(
    new URL(path, process.env['WEB_ORIGIN'] ?? 'http://localhost:3000'),
    303
  );
}
