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
});
