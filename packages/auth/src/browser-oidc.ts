import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  None,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  type Configuration,
} from 'openid-client';
import { AuthenticationError } from './principal.js';

export interface BrowserOidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly production: boolean;
}

export interface AuthorizationTransaction {
  readonly codeVerifier: string;
  readonly state: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly createdAt: number;
}

export interface BrowserTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string;
  readonly subject: string;
  readonly accessTokenExpiresAt: number;
}

export interface BrowserAuthorizationClient {
  begin(
    returnTo: string
  ): Promise<{ authorizationUrl: string; transaction: AuthorizationTransaction }>;
  exchange(callbackUrl: URL, transaction: AuthorizationTransaction): Promise<BrowserTokens>;
  refresh(refreshToken: string, subject: string, currentIdToken: string): Promise<BrowserTokens>;
}

export class OpenIdBrowserAuthorizationClient implements BrowserAuthorizationClient {
  private constructor(
    private readonly config: BrowserOidcConfig,
    private readonly client: Configuration
  ) {}

  static async discover(config: BrowserOidcConfig): Promise<OpenIdBrowserAuthorizationClient> {
    const issuer = secureUrl('issuer', config.issuer, config.production);
    secureUrl('redirectUri', config.redirectUri, config.production);
    if (config.clientId.length === 0 || config.scope.split(/\s+/).includes('openid') === false) {
      throw new AuthenticationError('browser_auth_config_invalid');
    }
    const metadata = config.clientSecret
      ? { client_secret: config.clientSecret, redirect_uris: [config.redirectUri] }
      : { redirect_uris: [config.redirectUri], token_endpoint_auth_method: 'none' };
    const client = await discovery(
      issuer,
      config.clientId,
      metadata,
      config.clientSecret ? ClientSecretPost(config.clientSecret) : None(),
      { timeout: 5 }
    );
    client.timeout = 5;
    return new OpenIdBrowserAuthorizationClient(config, client);
  }

  async begin(
    returnTo: string
  ): Promise<{ authorizationUrl: string; transaction: AuthorizationTransaction }> {
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    const authorizationUrl = buildAuthorizationUrl(this.client, {
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scope,
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return {
      authorizationUrl: authorizationUrl.toString(),
      transaction: { codeVerifier, state, nonce, returnTo, createdAt: Date.now() },
    };
  }

  async exchange(callbackUrl: URL, transaction: AuthorizationTransaction): Promise<BrowserTokens> {
    try {
      const trustedCallback = new URL(this.config.redirectUri);
      trustedCallback.search = callbackUrl.search;
      const response = await authorizationCodeGrant(this.client, trustedCallback, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      return tokenResponse(response);
    } catch (error) {
      throw new AuthenticationError('browser_auth_callback_invalid', { cause: error });
    }
  }

  async refresh(
    refreshToken: string,
    subject: string,
    currentIdToken: string
  ): Promise<BrowserTokens> {
    try {
      const response = await refreshTokenGrant(this.client, refreshToken);
      const idToken = response.id_token;
      const claims = response.claims();
      if (claims?.sub && claims.sub !== subject) {
        throw new AuthenticationError('browser_auth_subject_changed');
      }
      return tokenResponse(response, subject, idToken ?? currentIdToken);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('browser_auth_refresh_failed', { cause: error });
    }
  }
}

function tokenResponse(
  response: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expiresIn(): number | undefined;
    claims(): { sub?: string } | undefined;
  },
  expectedSubject?: string,
  fallbackIdToken?: string
): BrowserTokens {
  const expiresIn = response.expiresIn();
  const subject = response.claims()?.sub ?? expectedSubject;
  const idToken = response.id_token ?? fallbackIdToken;
  if (!expiresIn || expiresIn < 1 || !subject || !idToken) {
    throw new AuthenticationError('browser_auth_token_response_invalid');
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    idToken,
    subject,
    accessTokenExpiresAt: Date.now() + expiresIn * 1_000,
  };
}

function secureUrl(field: string, value: string, production: boolean): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password || (production && url.protocol !== 'https:'))
      throw new Error();
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url;
  } catch (error) {
    throw new AuthenticationError(`browser_auth_${field}_invalid`, { cause: error });
  }
}
