import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

export const X_API_ENDPOINTS = {
  authorize: 'https://x.com/i/oauth2/authorize',
  token: 'https://api.x.com/2/oauth2/token',
  revoke: 'https://api.x.com/2/oauth2/revoke',
  currentUser: 'https://api.x.com/2/users/me',
  createPost: 'https://api.x.com/2/tweets',
  uploadMedia: 'https://api.x.com/2/media/upload',
  initializeMedia: 'https://api.x.com/2/media/upload/initialize',
} as const;

export interface XOAuthClientOptions {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly fetch?: typeof fetch;
}

export interface XTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly scopes: readonly string[];
}

export interface XUser {
  readonly id: string;
  readonly name: string;
  readonly username: string;
}

export class XApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = 'XApiError';
  }
}

export class XOAuthClient {
  private readonly request: typeof fetch;

  constructor(private readonly options: XOAuthClientOptions) {
    if (!options.clientId || !isHttpsCallback(options.redirectUri)) {
      throw new XApiError('x_oauth_config_invalid', 500);
    }
    this.request = options.fetch ?? fetch;
  }

  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    scopes: readonly string[];
  }): string {
    const url = new URL(X_API_ENDPOINTS.authorize);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: [...new Set(input.scopes)].join(' '),
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  exchangeCode(code: string, codeVerifier: string): Promise<XTokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  refresh(refreshToken: string): Promise<XTokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async currentUser(accessToken: string): Promise<XUser> {
    const response = await this.request(X_API_ENDPOINTS.currentUser, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    const body = await readJson(response);
    if (!response.ok) throw new XApiError('x_user_lookup_failed', response.status);
    const data = record(body.data);
    const id = string(data.id);
    const name = string(data.name);
    const username = string(data.username);
    if (!id || !name || !username) throw new XApiError('x_user_response_invalid', 502);
    return { id, name, username };
  }

  async revoke(token: string): Promise<void> {
    const response = await this.request(X_API_ENDPOINTS.revoke, {
      method: 'POST',
      headers: this.headers(),
      body: this.form({ token, token_type_hint: 'access_token' }),
    });
    if (!response.ok) throw new XApiError('x_token_revoke_failed', response.status);
  }

  private async token(values: Record<string, string>): Promise<XTokenSet> {
    const response = await this.request(X_API_ENDPOINTS.token, {
      method: 'POST',
      headers: this.headers(),
      body: this.form(values),
    });
    const body = await readJson(response);
    if (!response.ok) throw new XApiError('x_token_exchange_failed', response.status);
    const accessToken = string(body.access_token);
    const expiresIn = number(body.expires_in);
    if (!accessToken || !expiresIn) throw new XApiError('x_token_response_invalid', 502);
    const refreshToken = string(body.refresh_token);
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      tokenType: string(body.token_type) || 'bearer',
      expiresIn,
      scopes: (string(body.scope) || '').split(' ').filter(Boolean),
    };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(this.options.clientSecret
        ? {
            authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64')}`,
          }
        : {}),
    };
  }

  private form(values: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      ...values,
      ...(this.options.clientSecret ? {} : { client_id: this.options.clientId }),
    });
  }
}

function isHttpsCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return record(await response.json());
  } catch {
    return {};
  }
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function number(value: unknown): number {
  return typeof value === 'number' && value > 0 ? value : 0;
}

export class XAdapter implements PlatformAdapter {
  public readonly platform = 'x' as const;

  public getCapabilities(): PlatformCapabilities {
    return {
      text: true,
      link: true,
      image: { enabled: true, maxCount: 4 },
      video: { enabled: true },
      carousel: false,
      reels: false,
      stories: false,
      delete: true,
      maxTextLength: 280,
    };
  }

  public validate(draft: PlatformDraft): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!draft.text.trim() && draft.media.length === 0) {
      issues.push({ code: 'X_EMPTY_POST', path: 'text', messageKey: 'errors.x.emptyPost' });
    }
    if (draft.media.length > 4) {
      issues.push({
        code: 'X_TOO_MANY_MEDIA',
        path: 'media',
        messageKey: 'errors.x.tooManyMedia',
      });
    }
    const videos = draft.media.filter(({ kind }) => kind === 'VIDEO').length;
    if (videos > 1 || (videos === 1 && draft.media.length > 1)) {
      issues.push({
        code: 'X_MEDIA_COMBINATION_INVALID',
        path: 'media',
        messageKey: 'errors.x.mediaCombinationInvalid',
      });
    }
    return issues;
  }

  public async publish(_draft: PlatformDraft): Promise<PlatformPublishResult> {
    throw new Error('X_NOT_CONFIGURED: OAuth and publishing are implemented in a dedicated issue.');
  }
}
