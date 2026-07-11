import { authenticatedApiFetch, relay } from '../../../../../../../server/api-fetch';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; connectionId: string }> }
) {
  const { workspaceId, connectionId } = await params;
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/oauth-connections/${encodeURIComponent(connectionId)}`,
      { method: 'DELETE' },
      { csrf: true }
    )
  );
}
