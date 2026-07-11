import { authenticatedApiFetch, relay } from '../../../../../../server/api-fetch';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
): Promise<Response> {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/platform-apps`
    )
  );
}
