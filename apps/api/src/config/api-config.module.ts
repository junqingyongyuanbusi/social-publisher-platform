import { DynamicModule, Global, Module } from '@nestjs/common';
import { z } from 'zod';

export const API_CONFIG = Symbol('API_CONFIG');

const allowedAlgorithms = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const;

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
    API_READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(5_000).default(1_000),
    ENABLE_SWAGGER: z.enum(['true', 'false']).default('false'),
    DATABASE_URL: z.string().min(1).max(4_096),
    WEB_ORIGIN: z.string().min(1).max(2_048).default('http://localhost:3000'),
    OIDC_ISSUER: z.string().min(1).max(2_048),
    OIDC_AUDIENCE: z.string().trim().min(1).max(500),
    OIDC_JWKS_URI: z.string().min(1).max(2_048),
    OIDC_ALGORITHMS: z.string().default('RS256,ES256'),
    OIDC_MAX_TOKEN_AGE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
    CREDENTIAL_KEK_PROVIDER: z.enum(['local', 'aws-kms']).default('local'),
    CREDENTIAL_LOCAL_KEK_BASE64: z.string().optional(),
    CREDENTIAL_LOCAL_KEK_VERSION: z.string().trim().min(1).max(200).optional(),
    AWS_REGION: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/)
      .optional(),
    AWS_KMS_KEY_ID: z.string().trim().min(1).max(2_048).optional(),
  })
  .superRefine((environment, context) => {
    const databaseUrl = safeDatabaseUrl(environment.DATABASE_URL);
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
      issue(context, 'DATABASE_URL', 'invalid_database_url');
    }

    const webOrigin = safeHttpUrl(environment.WEB_ORIGIN);
    if (!webOrigin || !isOriginOnly(webOrigin)) {
      issue(context, 'WEB_ORIGIN', 'invalid_web_origin');
    }

    const issuer = safeHttpUrl(environment.OIDC_ISSUER);
    if (!issuer) issue(context, 'OIDC_ISSUER', 'invalid_oidc_issuer');
    const jwksUri = safeHttpUrl(environment.OIDC_JWKS_URI);
    if (!jwksUri) issue(context, 'OIDC_JWKS_URI', 'invalid_oidc_jwks_uri');

    const algorithms = parseAlgorithms(environment.OIDC_ALGORITHMS);
    if (
      algorithms.length === 0 ||
      algorithms.some((algorithm) => !allowedAlgorithms.includes(algorithm as never))
    ) {
      issue(context, 'OIDC_ALGORITHMS', 'invalid_oidc_algorithms');
    }

    if (environment.CREDENTIAL_KEK_PROVIDER === 'local') {
      if (!isThirtyTwoByteBase64(environment.CREDENTIAL_LOCAL_KEK_BASE64)) {
        issue(context, 'CREDENTIAL_LOCAL_KEK_BASE64', 'invalid_local_kek');
      }
      if (!environment.CREDENTIAL_LOCAL_KEK_VERSION) {
        issue(context, 'CREDENTIAL_LOCAL_KEK_VERSION', 'missing_local_kek_version');
      }
    } else {
      if (!environment.AWS_REGION) issue(context, 'AWS_REGION', 'missing_aws_region');
      if (!environment.AWS_KMS_KEY_ID) issue(context, 'AWS_KMS_KEY_ID', 'missing_aws_kms_key');
    }

    if (environment.NODE_ENV !== 'production') return;

    if (environment.CREDENTIAL_KEK_PROVIDER !== 'aws-kms') {
      issue(context, 'CREDENTIAL_KEK_PROVIDER', 'production_kms_required');
    }
    if (databaseUrl && isLocalHost(databaseUrl.hostname)) {
      issue(context, 'DATABASE_URL', 'production_database_must_not_be_local');
    }
    if (
      !webOrigin ||
      webOrigin.protocol !== 'https:' ||
      isLocalHost(webOrigin.hostname) ||
      isPlaceholderHost(webOrigin.hostname)
    ) {
      issue(context, 'WEB_ORIGIN', 'production_web_origin_invalid');
    }
    if (
      !issuer ||
      issuer.protocol !== 'https:' ||
      isLocalHost(issuer.hostname) ||
      isPlaceholderHost(issuer.hostname)
    ) {
      issue(context, 'OIDC_ISSUER', 'production_oidc_issuer_invalid');
    }
    if (
      !jwksUri ||
      jwksUri.protocol !== 'https:' ||
      isLocalHost(jwksUri.hostname) ||
      isPlaceholderHost(jwksUri.hostname)
    ) {
      issue(context, 'OIDC_JWKS_URI', 'production_oidc_jwks_uri_invalid');
    }
  });

export interface ApiConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly port: number;
  readonly readinessTimeoutMs: number;
  readonly swaggerEnabled: boolean;
  readonly databaseUrl: string;
  readonly webOrigin: string;
  readonly oidc: {
    readonly issuer: string;
    readonly audience: string;
    readonly jwksUri: string;
    readonly algorithms: readonly string[];
    readonly maxTokenAgeSeconds: number;
  };
  readonly credentialKek:
    | { readonly provider: 'local'; readonly configured: true }
    | {
        readonly provider: 'aws-kms';
        readonly configured: true;
        readonly region: string;
        readonly keyId: string;
      };
}

export class ApiConfigurationError extends Error {
  constructor(readonly invalidFields: readonly string[]) {
    super(`API configuration is invalid: ${invalidFields.join(', ')}`);
    this.name = 'ApiConfigurationError';
  }
}

export function parseApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const invalidFields = [
      ...new Set(
        result.error.issues
          .map((item) => item.path[0])
          .filter((field): field is string => typeof field === 'string')
      ),
    ].sort();
    throw new ApiConfigurationError(invalidFields.length > 0 ? invalidFields : ['environment']);
  }

  const value = result.data;
  return {
    environment: value.NODE_ENV,
    port: value.API_PORT,
    readinessTimeoutMs: value.API_READINESS_TIMEOUT_MS,
    swaggerEnabled: value.NODE_ENV !== 'production' || value.ENABLE_SWAGGER === 'true',
    databaseUrl: value.DATABASE_URL,
    webOrigin: new URL(value.WEB_ORIGIN).origin,
    oidc: {
      issuer: value.OIDC_ISSUER,
      audience: value.OIDC_AUDIENCE,
      jwksUri: value.OIDC_JWKS_URI,
      algorithms: parseAlgorithms(value.OIDC_ALGORITHMS),
      maxTokenAgeSeconds: value.OIDC_MAX_TOKEN_AGE_SECONDS,
    },
    credentialKek:
      value.CREDENTIAL_KEK_PROVIDER === 'aws-kms'
        ? {
            provider: 'aws-kms',
            configured: true,
            region: value.AWS_REGION as string,
            keyId: value.AWS_KMS_KEY_ID as string,
          }
        : { provider: 'local', configured: true },
  };
}

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(environment: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = parseApiConfig(environment);
    return {
      global: true,
      module: ApiConfigModule,
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}

function issue(
  context: { addIssue(issue: { code: 'custom'; path: string[]; message: string }): void },
  field: string,
  message: string
): void {
  context.addIssue({ code: 'custom', path: [field], message });
}

function safeDatabaseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function isOriginOnly(url: URL): boolean {
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

function parseAlgorithms(value: string): readonly string[] {
  return value
    .split(',')
    .map((algorithm) => algorithm.trim())
    .filter(Boolean);
}

function isThirtyTwoByteBase64(value: string | undefined): boolean {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value, 'base64').byteLength === 32;
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '::'
  );
}

function isPlaceholderHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'example.com' ||
    normalized.endsWith('.example.com') ||
    normalized.endsWith('.example') ||
    normalized.endsWith('.invalid') ||
    normalized.endsWith('.test')
  );
}
