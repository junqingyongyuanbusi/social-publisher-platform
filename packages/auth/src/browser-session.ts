import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  AuthorizationTransaction,
  BrowserAuthorizationClient,
  BrowserTokens,
} from './browser-oidc.js';
import { AuthenticationError } from './principal.js';
import type { SessionCipher } from './session-cipher.js';

export interface BrowserSessionRecord extends BrowserTokens {
  readonly sessionExpiresAt: number;
  readonly csrfHash: string;
}

export interface BrowserSessionStore {
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  take(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  acquireLock(key: string, owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string, owner: string): Promise<void>;
}

export interface BrowserSessionConfig {
  readonly transactionTtlSeconds: number;
  readonly sessionTtlSeconds: number;
  readonly refreshSkewSeconds: number;
}

export class BrowserSessionService {
  constructor(
    private readonly oidc: BrowserAuthorizationClient,
    private readonly store: BrowserSessionStore,
    private readonly cipher: SessionCipher,
    private readonly config: BrowserSessionConfig
  ) {
    if (
      config.transactionTtlSeconds < 60 ||
      config.transactionTtlSeconds > 900 ||
      config.sessionTtlSeconds < 300 ||
      config.sessionTtlSeconds > 86_400 ||
      config.refreshSkewSeconds < 10 ||
      config.refreshSkewSeconds > 600
    ) {
      throw new AuthenticationError('browser_session_config_invalid');
    }
  }

  async beginLogin(returnTo: string): Promise<{ authorizationUrl: string; transactionId: string }> {
    const safeReturnTo = validateReturnTo(returnTo);
    const transactionId = randomId();
    const result = await this.oidc.begin(safeReturnTo);
    await this.store.put(
      transactionKey(transactionId),
      this.cipher.seal('transaction', transactionId, result.transaction),
      this.config.transactionTtlSeconds
    );
    return { authorizationUrl: result.authorizationUrl, transactionId };
  }

  async completeLogin(
    callbackUrl: URL,
    transactionId: string
  ): Promise<{ sessionId: string; csrfToken: string; returnTo: string }> {
    assertOpaqueId(transactionId);
    const encoded = await this.store.take(transactionKey(transactionId));
    if (!encoded) throw new AuthenticationError('browser_auth_transaction_missing');
    const transaction = this.cipher.open<AuthorizationTransaction>(
      'transaction',
      transactionId,
      encoded
    );
    if (Date.now() - transaction.createdAt > this.config.transactionTtlSeconds * 1_000) {
      throw new AuthenticationError('browser_auth_transaction_expired');
    }
    const tokens = await this.oidc.exchange(callbackUrl, transaction);
    const sessionId = randomId();
    const csrfToken = randomId();
    const session: BrowserSessionRecord = {
      ...tokens,
      sessionExpiresAt: Date.now() + this.config.sessionTtlSeconds * 1_000,
      csrfHash: hash(csrfToken),
    };
    await this.saveSession(sessionId, session);
    return { sessionId, csrfToken, returnTo: transaction.returnTo };
  }

  async getSession(sessionId: string): Promise<BrowserSessionRecord> {
    assertOpaqueId(sessionId);
    const key = sessionKey(sessionId);
    const encoded = await this.store.get(key);
    if (!encoded) throw new AuthenticationError('browser_session_missing');
    let session = this.cipher.open<BrowserSessionRecord>('session', sessionId, encoded);
    if (session.sessionExpiresAt <= Date.now()) {
      await this.store.delete(key);
      throw new AuthenticationError('browser_session_expired');
    }
    if (session.accessTokenExpiresAt - Date.now() <= this.config.refreshSkewSeconds * 1_000) {
      session = await this.refreshSession(sessionId, session);
    }
    return session;
  }

  async logout(sessionId: string): Promise<void> {
    assertOpaqueId(sessionId);
    await this.store.delete(sessionKey(sessionId));
  }

  verifyCsrf(session: BrowserSessionRecord, cookieToken: string, submittedToken: string): void {
    if (
      !cookieToken ||
      !safeEqual(cookieToken, submittedToken) ||
      !safeEqual(hash(cookieToken), session.csrfHash)
    ) {
      throw new AuthenticationError('browser_csrf_invalid');
    }
  }

  private async refreshSession(
    sessionId: string,
    current: BrowserSessionRecord
  ): Promise<BrowserSessionRecord> {
    if (!current.refreshToken) throw new AuthenticationError('browser_session_refresh_unavailable');
    const owner = randomId();
    const lockKey = `${sessionKey(sessionId)}:refresh`;
    const acquired = await this.store.acquireLock(lockKey, owner, 15);
    if (!acquired) {
      if (current.accessTokenExpiresAt > Date.now()) return current;
      throw new AuthenticationError('browser_session_refresh_busy');
    }
    try {
      const latestEncoded = await this.store.get(sessionKey(sessionId));
      if (!latestEncoded) throw new AuthenticationError('browser_session_missing');
      const latest = this.cipher.open<BrowserSessionRecord>('session', sessionId, latestEncoded);
      if (latest.accessTokenExpiresAt - Date.now() > this.config.refreshSkewSeconds * 1_000) {
        return latest;
      }
      const tokens = await this.oidc.refresh(
        latest.refreshToken ?? current.refreshToken,
        latest.subject,
        latest.idToken
      );
      const refreshed: BrowserSessionRecord = {
        ...latest,
        ...tokens,
        refreshToken: tokens.refreshToken ?? latest.refreshToken,
      };
      await this.saveSession(sessionId, refreshed);
      return refreshed;
    } catch (error) {
      await this.store.delete(sessionKey(sessionId));
      throw error;
    } finally {
      await this.store.releaseLock(lockKey, owner);
    }
  }

  private saveSession(sessionId: string, session: BrowserSessionRecord): Promise<void> {
    const ttl = Math.max(1, Math.ceil((session.sessionExpiresAt - Date.now()) / 1_000));
    return this.store.put(
      sessionKey(sessionId),
      this.cipher.seal('session', sessionId, session),
      ttl
    );
  }
}

function validateReturnTo(value: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.length > 2_000
  ) {
    throw new AuthenticationError('browser_return_to_invalid');
  }
  return value;
}

function randomId(): string {
  return randomBytes(32).toString('base64url');
}

function assertOpaqueId(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new AuthenticationError('browser_session_id_invalid');
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function transactionKey(id: string): string {
  return `auth:tx:${hash(id)}`;
}

function sessionKey(id: string): string {
  return `auth:session:${hash(id)}`;
}
