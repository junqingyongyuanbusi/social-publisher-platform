import { describe, expect, it } from 'vitest';
import { ApiConfigurationError, parseApiConfig } from './api-config.module.js';

const developmentEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  API_PORT: '3001',
  API_READINESS_TIMEOUT_MS: '750',
  DATABASE_URL: 'postgresql://social:social@localhost:5432/social_publisher',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  OIDC_ISSUER: 'http://localhost:8080/realms/social-publisher',
  OIDC_AUDIENCE: 'social-publisher-api',
  OIDC_JWKS_URI: 'http://localhost:8080/realms/social-publisher/certs',
  OIDC_ALGORITHMS: 'RS256,ES256',
  OIDC_MAX_TOKEN_AGE_SECONDS: '3600',
  CREDENTIAL_KEK_PROVIDER: 'local',
  CREDENTIAL_LOCAL_KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
  CREDENTIAL_LOCAL_KEK_VERSION: 'test-v1',
};

describe('API production configuration', () => {
  it('parses a complete development configuration without importing AuthModule', () => {
    expect(parseApiConfig(developmentEnvironment)).toMatchObject({
      environment: 'development',
      port: 3001,
      readinessTimeoutMs: 750,
      webOrigin: 'http://localhost:3000',
      oidc: { algorithms: ['RS256', 'ES256'] },
      credentialKek: { provider: 'local', configured: true },
    });
  });

  it('accepts a non-local production configuration backed by AWS KMS', () => {
    const config = parseApiConfig({
      ...developmentEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://service:secret@db.internal:5432/social_publisher?sslmode=require',
      REDIS_URL: 'rediss://cache.internal:6379',
      WEB_ORIGIN: 'https://publisher.company.com',
      PLATFORM_OAUTH_CALLBACK_URL: 'https://publisher.company.com/api/platform-oauth/callback',
      MEDIA_STORAGE_PROVIDER: 's3',
      MEDIA_S3_BUCKET: 'publisher-media-production',
      MEDIA_S3_REGION: 'us-east-1',
      OIDC_ISSUER: 'https://login.company.com/realms/social-publisher',
      OIDC_JWKS_URI: 'https://login.company.com/realms/social-publisher/certs',
      CREDENTIAL_KEK_PROVIDER: 'aws-kms',
      AWS_REGION: 'us-east-1',
      AWS_KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
    });

    expect(config).toMatchObject({
      environment: 'production',
      credentialKek: { provider: 'aws-kms', configured: true },
    });
  });

  it('rejects local and placeholder production dependencies before startup', () => {
    expect(() =>
      parseApiConfig({
        ...developmentEnvironment,
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://identity.example.com/realms/social-publisher',
        OIDC_JWKS_URI: 'https://identity.example.com/realms/social-publisher/certs',
      })
    ).toThrowError(
      expect.objectContaining({
        invalidFields: expect.arrayContaining([
          'CREDENTIAL_KEK_PROVIDER',
          'DATABASE_URL',
          'OIDC_ISSUER',
          'OIDC_JWKS_URI',
          'WEB_ORIGIN',
        ]),
      })
    );
  });

  it('reports only invalid field names and never includes secret configuration values', () => {
    const secret = 'do-not-echo-this-secret';
    let caught: unknown;
    try {
      parseApiConfig({
        ...developmentEnvironment,
        CREDENTIAL_LOCAL_KEK_BASE64: secret,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiConfigurationError);
    expect((caught as Error).message).toContain('CREDENTIAL_LOCAL_KEK_BASE64');
    expect((caught as Error).message).not.toContain(secret);
  });
});
