import { describe, expect, it, vi } from 'vitest';
import { MetaGraphClient } from './index.js';
describe('MetaGraphClient', () => {
  it('builds versioned authorization and discovers Pages with Instagram accounts', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'p1',
                name: 'Page',
                access_token: 'page-token',
                tasks: ['CREATE_CONTENT'],
                instagram_business_account: { id: 'ig1', username: 'brand' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const client = new MetaGraphClient({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://publisher.test/callback',
      apiVersion: 'v23.0',
      fetch: fetch as typeof globalThis.fetch,
    });
    const url = new URL(
      client.authorizationUrl('state', ['pages_show_list', 'pages_manage_posts'])
    );
    expect(url.pathname).toBe('/v23.0/dialog/oauth');
    await expect(client.pages('user-token')).resolves.toMatchObject([
      { id: 'p1', accessToken: 'page-token', instagramAccount: { id: 'ig1', username: 'brand' } },
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('instagram_business_account');
  });
});
