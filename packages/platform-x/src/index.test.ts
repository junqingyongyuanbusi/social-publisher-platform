import { describe, expect, it, vi } from 'vitest';
import { XAdapter, XOAuthClient } from './index.js';

describe('XAdapter', () => {
  const adapter = new XAdapter();

  it('rejects an empty post', () => {
    expect(
      adapter.validate({
        publicationId: 'p',
        accountId: 'a',
        text: '',
        media: [],
        settings: {},
      })
    ).toHaveLength(1);
  });

  it('exposes X media capacity', () => {
    expect(adapter.getCapabilities().image.maxCount).toBe(4);
  });
});

describe('XOAuthClient', () => {
  it('builds an S256 authorization URL with the exact callback and scopes', () => {
    const client = new XOAuthClient({
      clientId: 'client',
      redirectUri: 'https://publisher.test/api/platform-oauth/callback',
    });
    const url = new URL(
      client.authorizationUrl({
        state: 'state',
        codeChallenge: 'challenge',
        scopes: ['tweet.read', 'offline.access'],
      })
    );
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'client',
      state: 'state',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      scope: 'tweet.read offline.access',
    });
  });

  it('uses confidential-client authentication and does not leak the secret into the form', async () => {
    const request = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            access_token: 'access',
            refresh_token: 'refresh',
            token_type: 'bearer',
            expires_in: 7200,
            scope: 'tweet.read offline.access',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const client = new XOAuthClient({
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'https://publisher.test/api/platform-oauth/callback',
      fetch: request as typeof fetch,
    });
    const token = await client.exchangeCode('code', 'verifier');
    expect(token.refreshToken).toBe('refresh');
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('client:secret').toString('base64')}`
    );
    expect(String(init.body)).not.toContain('secret');
  });

  it('creates and verifies a post with bearer authentication', async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/2/tweets'))
        return new Response(JSON.stringify({ data: { id: '123', text: 'hello' } }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'x-request-id': 'x-request' },
        });
      return new Response(JSON.stringify({ data: { id: '123', text: 'hello' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new XOAuthClient({
      clientId: 'client',
      redirectUri: 'https://publisher.test/callback',
      fetch: request as typeof fetch,
    });
    expect(await client.createPost('access', { text: 'hello' })).toMatchObject({
      id: '123',
      platformRequestId: 'x-request',
    });
    expect(await client.getPost('access', '123')).toMatchObject({ id: '123', text: 'hello' });
    expect((request.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe(
      'Bearer access'
    );
  });

  it('classifies a transport failure after POST as an unknown result', async () => {
    const client = new XOAuthClient({
      clientId: 'client',
      redirectUri: 'https://publisher.test/callback',
      fetch: vi.fn(async () => {
        throw new Error('timeout');
      }) as typeof fetch,
    });
    await expect(client.createPost('access', { text: 'hello' })).rejects.toMatchObject({
      code: 'x_create_post_result_unknown',
      resultUnknown: true,
      retryable: false,
    });
  });

  it('classifies rate limits as retryable and respects Retry-After', async () => {
    const client = new XOAuthClient({
      clientId: 'client',
      redirectUri: 'https://publisher.test/callback',
      fetch: vi.fn(
        async () => new Response('{}', { status: 429, headers: { 'retry-after': '17' } })
      ) as typeof fetch,
    });
    await expect(client.createPost('access', { text: 'hello' })).rejects.toMatchObject({
      code: 'x_create_post_failed',
      retryable: true,
      retryAfterMs: 17_000,
    });
  });

  it('classifies an invalid refresh grant as reauthorization required', async () => {
    const client = new XOAuthClient({
      clientId: 'client',
      redirectUri: 'https://publisher.test/callback',
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
      ) as typeof fetch,
    });
    await expect(client.refresh('rotated-away')).rejects.toMatchObject({
      code: 'x_authorization_required',
      retryable: false,
    });
  });
});
