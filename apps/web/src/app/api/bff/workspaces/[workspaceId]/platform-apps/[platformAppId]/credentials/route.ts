import { authenticatedApiFetch, relay } from '../../../../../../../../server/api-fetch';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; platformAppId: string }> }
): Promise<Response> {
  const { workspaceId, platformAppId } = await params;
  return relay(await authenticatedApiFetch(request, credentialPath(workspaceId, platformAppId)));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; platformAppId: string }> }
): Promise<Response> {
  const { workspaceId, platformAppId } = await params;
  const body = await limitedBody(request);
  return relay(
    await authenticatedApiFetch(
      request,
      credentialPath(workspaceId, platformAppId),
      { method: 'POST', body, headers: { 'content-type': 'application/json' } },
      { csrf: true }
    )
  );
}

function credentialPath(workspaceId: string, platformAppId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/platform-apps/${encodeURIComponent(platformAppId)}/credentials`;
}

async function limitedBody(request: Request): Promise<string> {
  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > 70 * 1024) throw new Error('Request body too large');
  return body;
}
