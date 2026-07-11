import { authenticatedApiFetch, relay } from '../../../../../../../../server/api-fetch';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; publicationId: string }> }
) {
  const { workspaceId, publicationId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/diagnostics/publications/${encodeURIComponent(publicationId)}`
    )
  );
}
