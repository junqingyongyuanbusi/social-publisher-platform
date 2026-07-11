import { authenticatedApiFetch, relay } from '../../../../../../server/api-fetch';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/publications`
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
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/publications`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': request.headers.get('idempotency-key') ?? crypto.randomUUID(),
        },
        body: await request.text(),
      },
      { csrf: true }
    )
  );
}
