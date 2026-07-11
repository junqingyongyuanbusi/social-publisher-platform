import { authenticatedApiFetch, relay } from '../../../../../../../server/api-fetch';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/diagnostics/summary`
    )
  );
}
