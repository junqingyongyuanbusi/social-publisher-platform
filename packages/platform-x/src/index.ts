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
  mediaMetadata: 'https://api.x.com/2/media/metadata',
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

export interface XPost {
  readonly id: string;
  readonly text: string;
}
export interface XUploadedMedia {
  readonly id: string;
  readonly expiresAfterSeconds: number;
  readonly platformRequestId?: string;
}

export class XApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    readonly resultUnknown = false,
    readonly retryAfterMs?: number,
    readonly platformRequestId?: string
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

  async createPost(
    accessToken: string,
    input: { text: string; replyToId?: string; mediaIds?: readonly string[] },
    signal?: AbortSignal
  ): Promise<XPost & { platformRequestId?: string }> {
    let response: Response;
    try {
      response = await this.request(X_API_ENDPOINTS.createPost, {
        method: 'POST',
        ...(signal ? { signal } : {}),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          text: input.text,
          ...(input.replyToId ? { reply: { in_reply_to_tweet_id: input.replyToId } } : {}),
          ...(input.mediaIds?.length ? { media: { media_ids: [...input.mediaIds] } } : {}),
        }),
      });
    } catch {
      throw new XApiError('x_create_post_result_unknown', 0, false, true);
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const payload = await readJson(response);
    if (!response.ok) throw responseError('x_create_post_failed', response, requestId);
    const data = record(payload.data);
    const id = string(data.id);
    const text = string(data.text);
    if (!id)
      throw new XApiError('x_create_post_response_invalid', 502, false, true, undefined, requestId);
    return { id, text, ...(requestId ? { platformRequestId: requestId } : {}) };
  }

  async uploadImage(
    accessToken: string,
    bytes: Uint8Array,
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
    altText?: string,
    signal?: AbortSignal
  ): Promise<XUploadedMedia> {
    let response: Response;
    try {
      response = await this.request(X_API_ENDPOINTS.uploadMedia, {
        method: 'POST',
        ...(signal ? { signal } : {}),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          media: Buffer.from(bytes).toString('base64'),
          media_category: 'tweet_image',
          media_type: mimeType,
          shared: false,
        }),
      });
    } catch {
      throw new XApiError('x_media_upload_unavailable', 0, true);
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const payload = await readJson(response);
    if (!response.ok) throw responseError('x_media_upload_failed', response, requestId);
    const data = record(payload.data);
    const id = string(data.id);
    const expiresAfterSeconds = number(data.expires_after_secs);
    if (!id)
      throw new XApiError(
        'x_media_upload_response_invalid',
        502,
        true,
        false,
        undefined,
        requestId
      );
    if (altText?.trim()) await this.setImageAltText(accessToken, id, altText.trim(), signal);
    return { id, expiresAfterSeconds, ...(requestId ? { platformRequestId: requestId } : {}) };
  }

  private async setImageAltText(
    accessToken: string,
    mediaId: string,
    altText: string,
    signal?: AbortSignal
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.request(X_API_ENDPOINTS.mediaMetadata, {
        method: 'POST',
        ...(signal ? { signal } : {}),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: altText } } }),
      });
    } catch {
      throw new XApiError('x_media_metadata_unavailable', 0, true);
    }
    if (!response.ok)
      throw responseError(
        'x_media_metadata_failed',
        response,
        response.headers.get('x-request-id') ?? undefined
      );
  }

  async getPost(
    accessToken: string,
    postId: string,
    signal?: AbortSignal
  ): Promise<(XPost & { platformRequestId?: string }) | null> {
    let response: Response;
    try {
      response = await this.request(`${X_API_ENDPOINTS.createPost}/${encodeURIComponent(postId)}`, {
        ...(signal ? { signal } : {}),
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
    } catch {
      throw new XApiError('x_get_post_unavailable', 0, true);
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (response.status === 404) return null;
    const payload = await readJson(response);
    if (!response.ok) throw responseError('x_get_post_failed', response, requestId);
    const data = record(payload.data);
    const id = string(data.id);
    const text = string(data.text);
    if (!id)
      throw new XApiError('x_get_post_response_invalid', 502, true, false, undefined, requestId);
    return { id, text, ...(requestId ? { platformRequestId: requestId } : {}) };
  }

  private async token(values: Record<string, string>): Promise<XTokenSet> {
    const response = await this.request(X_API_ENDPOINTS.token, {
      method: 'POST',
      headers: this.headers(),
      body: this.form(values),
    });
    const body = await readJson(response);
    if (!response.ok) {
      if (response.status === 400 && string(body.error) === 'invalid_grant')
        throw new XApiError('x_authorization_required', response.status);
      throw responseError(
        'x_token_exchange_failed',
        response,
        response.headers.get('x-request-id') ?? undefined
      );
    }
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

function responseError(code: string, response: Response, requestId?: string): XApiError {
  const seconds = Number(response.headers.get('retry-after'));
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
  const retryable = response.status === 429 || response.status >= 500;
  return new XApiError(
    response.status === 401 || response.status === 403 ? 'x_authorization_required' : code,
    response.status,
    retryable,
    false,
    retryAfterMs,
    requestId
  );
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
    if (Array.from(draft.text).length > 280) {
      issues.push({ code: 'X_TEXT_TOO_LONG', path: 'text', messageKey: 'errors.x.textTooLong' });
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
