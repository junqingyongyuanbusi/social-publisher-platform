import { authenticatedApiFetch, relay } from '../../../../../../server/api-fetch';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/media-assets`
    )
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/media-assets`,
      {
        method: 'POST',
        headers: {
          'content-type': request.headers.get('content-type') ?? 'application/octet-stream',
        },
        body: await request.arrayBuffer(),
      },
      { csrf: true }
    )
  );
}
