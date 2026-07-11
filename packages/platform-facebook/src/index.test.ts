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
  it('publishes Page feed and photo posts and retains the provider request id', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'page_123' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-fb-trace-id': 'trace' },
        })
    );
    const client = new MetaGraphClient({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://publisher.test/callback',
      apiVersion: 'v23.0',
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(
      client.publishPagePost('page', 'token', { message: 'hello' })
    ).resolves.toMatchObject({ id: 'page_123', platformRequestId: 'trace' });
    await expect(
      client.publishPagePhoto('page', 'token', new Uint8Array([1, 2]), 'image/png', 'caption')
    ).resolves.toMatchObject({ id: 'page_123' });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/page/feed');
    expect(fetch.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);
  });
  it('quarantines a transport failure after a publish request', async () => {
    const client = new MetaGraphClient({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://publisher.test/callback',
      apiVersion: 'v23.0',
      fetch: vi.fn(async () => {
        throw new Error('timeout');
      }) as typeof globalThis.fetch,
    });
    await expect(
      client.publishPagePost('page', 'token', { message: 'hello' })
    ).rejects.toMatchObject({ code: 'meta_publish_result_unknown', resultUnknown: true });
  });
});
