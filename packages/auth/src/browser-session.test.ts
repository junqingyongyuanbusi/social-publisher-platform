import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  AuthorizationTransaction,
  BrowserAuthorizationClient,
  BrowserTokens,
} from './browser-oidc.js';
import { BrowserSessionService, type BrowserSessionStore } from './browser-session.js';
import { SessionCipher } from './session-cipher.js';

class MemoryStore implements BrowserSessionStore {
  readonly values = new Map<string, string>();
  readonly locks = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async take(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async acquireLock(key: string, owner: string): Promise<boolean> {
    if (this.locks.has(key)) return false;
    this.locks.set(key, owner);
    return true;
  }
  async releaseLock(key: string, owner: string): Promise<void> {
    if (this.locks.get(key) === owner) this.locks.delete(key);
  }
}

function tokens(overrides: Partial<BrowserTokens> = {}): BrowserTokens {
  return {
    accessToken: 'access-token-never-plain',
    refreshToken: 'refresh-token-never-plain',
    idToken: 'id-token-never-plain',
    subject: 'user-1',
    accessTokenExpiresAt: Date.now() + 300_000,
    ...overrides,
  };
}

function fixture(tokenOverrides: Partial<BrowserTokens> = {}) {
  const store = new MemoryStore();
  const oidc: BrowserAuthorizationClient = {
    begin: vi.fn(async (returnTo: string) => ({
      authorizationUrl: 'https://identity.example.com/authorize',
      transaction: {
        codeVerifier: 'verifier',
        state: 'state',
        nonce: 'nonce',
        returnTo,
        createdAt: Date.now(),
      } satisfies AuthorizationTransaction,
    })),
    exchange: vi.fn(async () => tokens(tokenOverrides)),
    refresh: vi.fn(async () =>
      tokens({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' })
    ),
  };
  const cipher = new SessionCipher({
    activeKeyId: 'test-v1',
    keys: { 'test-v1': randomBytes(32).toString('base64') },
  });
  const service = new BrowserSessionService(oidc, store, cipher, {
    transactionTtlSeconds: 600,
    sessionTtlSeconds: 3_600,
    refreshSkewSeconds: 60,
  });
  return { service, store, oidc };
}

describe('BrowserSessionService', () => {
  it('stores one-time PKCE transactions and rejects external return URLs', async () => {
    const { service, store } = fixture();
    const login = await service.beginLogin('/zh-CN');
    expect(login.authorizationUrl).toContain('identity.example.com');
    expect([...store.values.values()].join()).not.toContain('verifier');
    await expect(service.beginLogin('https://attacker.example')).rejects.toMatchObject({
      code: 'browser_return_to_invalid',
    });
  });

  it('creates an opaque session and consumes the transaction exactly once', async () => {
    const { service, store } = fixture();
    const login = await service.beginLogin('/en-US');
    const completed = await service.completeLogin(
      new URL('https://app.example.com/api/auth/callback?code=abc&state=state'),
      login.transactionId
    );
    expect(completed.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(completed.returnTo).toBe('/en-US');
    const stored = [...store.values.values()].join();
    expect(stored).not.toContain('access-token-never-plain');
    expect(stored).not.toContain('refresh-token-never-plain');
    await expect(
      service.completeLogin(
        new URL('https://app.example.com/api/auth/callback?code=abc&state=state'),
        login.transactionId
      )
    ).rejects.toMatchObject({ code: 'browser_auth_transaction_missing' });
  });

  it('verifies double-submit CSRF and invalidates logout', async () => {
    const { service } = fixture();
    const login = await service.beginLogin('/zh-CN');
    const completed = await service.completeLogin(
      new URL('https://app/callback'),
      login.transactionId
    );
    const session = await service.getSession(completed.sessionId);
    expect(() =>
      service.verifyCsrf(session, completed.csrfToken, completed.csrfToken)
    ).not.toThrow();
    expect(() => service.verifyCsrf(session, completed.csrfToken, 'attacker')).toThrowError(
      expect.objectContaining({ code: 'browser_csrf_invalid' })
    );
    await service.logout(completed.sessionId);
    await expect(service.getSession(completed.sessionId)).rejects.toMatchObject({
      code: 'browser_session_missing',
    });
  });

  it('rotates access and refresh tokens under a distributed lock', async () => {
    const { service, oidc } = fixture({ accessTokenExpiresAt: Date.now() + 1_000 });
    const login = await service.beginLogin('/zh-CN');
    const completed = await service.completeLogin(
      new URL('https://app/callback'),
      login.transactionId
    );
    const session = await service.getSession(completed.sessionId);
    expect(session.accessToken).toBe('rotated-access');
    expect(session.refreshToken).toBe('rotated-refresh');
    expect(oidc.refresh).toHaveBeenCalledTimes(1);
  });
});
