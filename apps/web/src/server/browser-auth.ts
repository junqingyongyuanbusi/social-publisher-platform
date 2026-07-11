import 'server-only';
import {
  BrowserSessionService,
  OpenIdBrowserAuthorizationClient,
  SessionCipher,
} from '@social/auth';
import { Redis } from 'ioredis';
import { RedisBrowserSessionStore } from './redis-session-store';

let servicePromise: Promise<BrowserSessionService> | undefined;

export function browserSessionService(): Promise<BrowserSessionService> {
  servicePromise ??= createService();
  return servicePromise;
}

async function createService(): Promise<BrowserSessionService> {
  const production = process.env['NODE_ENV'] === 'production';
  const oidc = await OpenIdBrowserAuthorizationClient.discover({
    issuer: required('BROWSER_OIDC_ISSUER'),
    clientId: required('BROWSER_OIDC_CLIENT_ID'),
    ...(process.env['BROWSER_OIDC_CLIENT_SECRET']
      ? { clientSecret: process.env['BROWSER_OIDC_CLIENT_SECRET'] }
      : {}),
    redirectUri: required('BROWSER_OIDC_REDIRECT_URI'),
    scope: process.env['BROWSER_OIDC_SCOPE'] ?? 'openid profile email offline_access',
    production,
  });
  const redis = new Redis(required('REDIS_URL'), {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 3_000,
    lazyConnect: true,
  });
  await redis.connect();
  const keyRing = parseKeyRing(required('BROWSER_SESSION_KEYS_JSON'));
  return new BrowserSessionService(
    oidc,
    new RedisBrowserSessionStore(redis),
    new SessionCipher(keyRing),
    {
      transactionTtlSeconds: Number(process.env['BROWSER_AUTH_TRANSACTION_TTL_SECONDS'] ?? 600),
      sessionTtlSeconds: Number(process.env['BROWSER_SESSION_TTL_SECONDS'] ?? 28_800),
      refreshSkewSeconds: Number(process.env['BROWSER_TOKEN_REFRESH_SKEW_SECONDS'] ?? 60),
    }
  );
}

function parseKeyRing(value: string): {
  activeKeyId: string;
  keys: Readonly<Record<string, string>>;
} {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== 'object') throw new Error();
    const activeKeyId = Reflect.get(parsed, 'activeKeyId');
    const keys = Reflect.get(parsed, 'keys');
    if (typeof activeKeyId !== 'string' || keys === null || typeof keys !== 'object') {
      throw new Error();
    }
    return { activeKeyId, keys: keys as Record<string, string> };
  } catch {
    throw new Error('BROWSER_SESSION_KEYS_JSON is invalid');
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}
