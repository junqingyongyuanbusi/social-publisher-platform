import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiConfig, type ApiConfig } from '../config/api-config.module.js';
import type { PrismaService } from '../database/database.module.js';
import { HealthController, ReadinessService } from './health.module.js';

const config: ApiConfig = parseApiConfig({
  NODE_ENV: 'test',
  API_READINESS_TIMEOUT_MS: '100',
  DATABASE_URL: 'postgresql://social:social@localhost:5432/social_publisher',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  OIDC_ISSUER: 'http://localhost:8080/realms/social-publisher',
  OIDC_AUDIENCE: 'social-publisher-api',
  OIDC_JWKS_URI: 'http://localhost:8080/realms/social-publisher/certs',
  CREDENTIAL_KEK_PROVIDER: 'local',
  CREDENTIAL_LOCAL_KEK_BASE64: Buffer.alloc(32, 9).toString('base64'),
  CREDENTIAL_LOCAL_KEK_VERSION: 'test-v1',
});

afterEach(() => vi.useRealTimers());

describe('API health probes', () => {
  it('keeps liveness process-only', () => {
    const controller = new HealthController(readinessWith(async () => Promise.reject()));
    expect(controller.live()).toMatchObject({ status: 'ok', service: 'social-publisher-api' });
  });

  it('reports ready only after a successful PostgreSQL probe', async () => {
    const query = vi.fn(async () => [{ value: 1 }]);
    const result = await readinessWith(query).check();

    expect(query).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 'ready',
      code: 'service_ready',
      checks: { postgres: 'ready', oidc: 'configured', credentialKek: 'ready' },
    });
  });

  it('returns a stable unavailable code without exposing a database error', async () => {
    const result = await readinessWith(async () => {
      throw new Error('postgresql://user:secret@db.internal/private');
    }).check();

    expect(result).toEqual({
      status: 'not_ready',
      code: 'service_not_ready',
      checks: { postgres: 'unavailable', oidc: 'configured', credentialKek: 'ready' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('bounds a stuck PostgreSQL probe with the configured timeout', async () => {
    vi.useFakeTimers();
    const resultPromise = readinessWith(() => new Promise(() => undefined)).check();
    await vi.advanceTimersByTimeAsync(config.readinessTimeoutMs);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'not_ready',
      checks: { postgres: 'timeout' },
    });
  });

  it('sets HTTP 503 for a failed readiness result', async () => {
    const controller = new HealthController(
      readinessWith(async () => {
        throw new Error('database unavailable');
      })
    );
    const response = { status: vi.fn() } as unknown as Response;

    await expect(controller.ready(response)).resolves.toMatchObject({ status: 'not_ready' });
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns not ready when the configured KMS key is unavailable', async () => {
    const result = await readinessWith(
      async () => [{ value: 1 }],
      async () => {
        throw new Error('kms permission denied');
      }
    ).check();

    expect(result).toEqual({
      status: 'not_ready',
      code: 'service_not_ready',
      checks: { postgres: 'ready', oidc: 'configured', credentialKek: 'unavailable' },
    });
  });
});

function readinessWith(
  query: (...arguments_: unknown[]) => Promise<unknown>,
  checkKek: () => Promise<void> = async () => undefined
): ReadinessService {
  const prisma = { $queryRaw: vi.fn(query) } as unknown as PrismaService;
  return new ReadinessService(prisma, config, { check: checkKek });
}
