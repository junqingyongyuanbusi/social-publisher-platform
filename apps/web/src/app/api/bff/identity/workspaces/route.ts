import { authenticatedApiFetch, relay } from '../../../../../server/api-fetch';

export async function GET(request: Request): Promise<Response> {
  return relay(await authenticatedApiFetch(request, '/api/v1/identity/workspaces'));
}
