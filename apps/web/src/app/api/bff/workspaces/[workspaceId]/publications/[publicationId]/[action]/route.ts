import { authenticatedApiFetch, relay } from '../../../../../../../../server/api-fetch';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; publicationId: string; action: string }> }
) {
  const { workspaceId, publicationId, action } = await params;
  if (!['cancel', 'retry'].includes(action))
    return Response.json({ code: 'action_invalid' }, { status: 404 });
  return relay(
    await authenticatedApiFetch(
      request,
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/publications/${encodeURIComponent(publicationId)}/${action}`,
      { method: 'POST' },
      { csrf: true }
    )
  );
}
