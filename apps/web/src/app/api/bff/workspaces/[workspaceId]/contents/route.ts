import { authenticatedApiFetch, relay } from '../../../../../../server/api-fetch';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/contents`
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
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/contents`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await request.text(),
      },
      { csrf: true }
    )
  );
}
