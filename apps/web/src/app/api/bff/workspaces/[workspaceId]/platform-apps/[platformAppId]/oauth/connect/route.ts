import { authenticatedApiFetch, relay } from '../../../../../../../../../server/api-fetch';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; platformAppId: string }> }
) {
  const { workspaceId, platformAppId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/platform-apps/${encodeURIComponent(platformAppId)}/oauth/connect`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await request.text(),
      },
      { csrf: true }
    )
  );
}
