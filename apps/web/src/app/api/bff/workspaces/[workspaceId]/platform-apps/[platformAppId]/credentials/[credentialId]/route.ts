import { authenticatedApiFetch, relay } from '../../../../../../../../../server/api-fetch';

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; platformAppId: string; credentialId: string }>;
  }
): Promise<Response> {
  const { workspaceId, platformAppId, credentialId } = await params;
  const path = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/platform-apps/${encodeURIComponent(platformAppId)}/credentials/${encodeURIComponent(credentialId)}`;
  return relay(await authenticatedApiFetch(request, path, { method: 'DELETE' }, { csrf: true }));
}
