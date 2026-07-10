import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { AuthenticationError, parseMemberships, type AuthenticatedPrincipal } from './principal.js';

const DEFAULT_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const;
const MAX_TOKEN_BYTES = 16 * 1024;

export interface OidcVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly membershipsClaim?: string;
  readonly algorithms?: readonly string[];
  readonly maxTokenAgeSeconds?: number;
  readonly production?: boolean;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthenticatedPrincipal>;
}

export class OidcAccessTokenVerifier implements AccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly membershipsClaim: string;
  private readonly algorithms: readonly string[];
  private readonly maxTokenAgeSeconds: number;
  private readonly getKey: JWTVerifyGetKey;

  constructor(config: OidcVerifierConfig, getKey?: JWTVerifyGetKey) {
    const issuer = parseUrl('issuer', config.issuer, config.production ?? false);
    const jwksUri = parseUrl('jwksUri', config.jwksUri, config.production ?? false);
    if (config.audience.length === 0 || config.audience.length > 500) {
      throw new AuthenticationError('auth_config_invalid');
    }
    const algorithms = config.algorithms ?? DEFAULT_ALGORITHMS;
    if (
      algorithms.length === 0 ||
      algorithms.some((algorithm) => !DEFAULT_ALGORITHMS.includes(algorithm as never))
    ) {
      throw new AuthenticationError('auth_config_invalid');
    }
    const maxTokenAgeSeconds = config.maxTokenAgeSeconds ?? 3_600;
    if (
      !Number.isSafeInteger(maxTokenAgeSeconds) ||
      maxTokenAgeSeconds < 60 ||
      maxTokenAgeSeconds > 86_400
    ) {
      throw new AuthenticationError('auth_config_invalid');
    }

    this.issuer = issuer.toString().replace(/\/$/, '');
    this.audience = config.audience;
    this.membershipsClaim = config.membershipsClaim ?? 'social_workspaces';
    this.algorithms = algorithms;
    this.maxTokenAgeSeconds = maxTokenAgeSeconds;
    this.getKey =
      getKey ??
      createRemoteJWKSet(jwksUri, {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1_000,
      });
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    if (
      Buffer.byteLength(token, 'utf8') === 0 ||
      Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
    ) {
      throw new AuthenticationError('auth_token_invalid');
    }
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: [...this.algorithms],
        clockTolerance: 5,
        maxTokenAge: `${this.maxTokenAgeSeconds}s`,
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      return this.toPrincipal(payload);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('auth_token_invalid', { cause: error });
    }
  }

  private toPrincipal(payload: JWTPayload): AuthenticatedPrincipal {
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 500) {
      throw new AuthenticationError('auth_subject_invalid');
    }
    const optional = optionalIdentityClaims(payload);
    return {
      subject: payload.sub,
      issuer: this.issuer,
      memberships: parseMemberships(payload[this.membershipsClaim]),
      ...optional,
    };
  }
}

function optionalIdentityClaims(
  payload: JWTPayload
): Pick<AuthenticatedPrincipal, 'email' | 'displayName'> {
  const result: { email?: string; displayName?: string } = {};
  if (typeof payload['email'] === 'string' && payload['email'].length <= 500) {
    result.email = payload['email'];
  }
  if (typeof payload['name'] === 'string' && payload['name'].length <= 500) {
    result.displayName = payload['name'];
  }
  return result;
}

function parseUrl(field: string, value: string, production: boolean): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) {
      throw new Error('unsafe URL');
    }
    if (production && url.protocol !== 'https:') throw new Error('HTTPS required');
    return url;
  } catch (error) {
    throw new AuthenticationError(`auth_${field}_invalid`, { cause: error });
  }
}
