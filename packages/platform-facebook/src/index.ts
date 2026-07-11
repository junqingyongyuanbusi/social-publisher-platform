import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

export interface MetaPage {
  readonly id: string;
  readonly name: string;
  readonly accessToken: string;
  readonly tasks: readonly string[];
  readonly instagramAccount?: {
    readonly id: string;
    readonly username?: string;
    readonly name?: string;
  };
}
export class MetaApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    readonly resultUnknown = false,
    readonly retryAfterMs?: number,
    readonly platformRequestId?: string
  ) {
    super(code);
    this.name = 'MetaApiError';
  }
}
export class MetaGraphClient {
  private readonly request: typeof fetch;
  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      apiVersion: string;
      fetch?: typeof fetch;
    }
  ) {
    if (!options.clientId || !options.clientSecret || !/^v\d+\.\d+$/.test(options.apiVersion))
      throw new MetaApiError('meta_config_invalid', 500);
    this.request = options.fetch ?? fetch;
  }
  authorizationUrl(state: string, scopes: readonly string[]): string {
    const url = new URL(`https://www.facebook.com/${this.options.apiVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      state,
      response_type: 'code',
      scope: [...new Set(scopes)].join(','),
    }).toString();
    return url.toString();
  }
  async exchangeCode(code: string): Promise<{ accessToken: string; expiresIn: number }> {
    return this.token(
      new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        code,
      })
    );
  }
  async exchangeLongLived(shortToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    return this.token(
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        fb_exchange_token: shortToken,
      })
    );
  }
  async pages(accessToken: string): Promise<readonly MetaPage[]> {
    const fields = 'id,name,access_token,tasks,instagram_business_account{id,username,name}';
    const url = this.graph('/me/accounts', { fields, limit: '100', access_token: accessToken });
    const response = await this.request(url, { headers: { accept: 'application/json' } });
    const body = await json(response);
    if (!response.ok) throw metaError('meta_account_discovery_failed', response);
    const rows = Array.isArray(body.data) ? body.data : [];
    return rows.flatMap((value) => {
      const row = record(value),
        id = text(row.id),
        name = text(row.name),
        token = text(row.access_token);
      if (!id || !name || !token) return [];
      const instagram = record(row.instagram_business_account);
      return [
        {
          id,
          name,
          accessToken: token,
          tasks: Array.isArray(row.tasks)
            ? row.tasks.filter((x): x is string => typeof x === 'string')
            : [],
          ...(text(instagram.id)
            ? {
                instagramAccount: {
                  id: text(instagram.id),
                  ...(text(instagram.username) ? { username: text(instagram.username) } : {}),
                  ...(text(instagram.name) ? { name: text(instagram.name) } : {}),
                },
              }
            : {}),
        },
      ];
    });
  }
  async revoke(accessToken: string): Promise<void> {
    const response = await this.request(
      this.graph('/me/permissions', { access_token: accessToken }),
      { method: 'DELETE' }
    );
    if (!response.ok) throw metaError('meta_token_revoke_failed', response);
  }
  async publishPagePost(
    pageId: string,
    accessToken: string,
    input: { message: string; link?: string },
    signal?: AbortSignal
  ): Promise<{ id: string; platformRequestId?: string }> {
    const form = new URLSearchParams({
      message: input.message,
      access_token: accessToken,
      ...(input.link ? { link: input.link } : {}),
    });
    return this.publish(`/${encodeURIComponent(pageId)}/feed`, form, signal);
  }
  async publishPagePhoto(
    pageId: string,
    accessToken: string,
    bytes: Uint8Array,
    mimeType: string,
    caption: string,
    signal?: AbortSignal
  ): Promise<{ id: string; platformRequestId?: string }> {
    const form = new FormData();
    form.set('source', new Blob([new Uint8Array(bytes)], { type: mimeType }), 'image');
    form.set('caption', caption);
    form.set('access_token', accessToken);
    return this.publish(`/${encodeURIComponent(pageId)}/photos`, form, signal);
  }
  async getPublishedObject(
    objectId: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<{ id: string; permalinkUrl?: string } | null> {
    let response: Response;
    try {
      response = await this.request(
        this.graph(`/${encodeURIComponent(objectId)}`, {
          fields: 'id,permalink_url',
          access_token: accessToken,
        }),
        { ...(signal ? { signal } : {}), headers: { accept: 'application/json' } }
      );
    } catch {
      throw new MetaApiError('meta_verify_unavailable', 0, true);
    }
    if (response.status === 404) return null;
    const body = await json(response);
    if (!response.ok) throw metaError('meta_verify_failed', response);
    const id = text(body.id);
    if (!id) throw new MetaApiError('meta_verify_response_invalid', 502, true);
    return { id, ...(text(body.permalink_url) ? { permalinkUrl: text(body.permalink_url) } : {}) };
  }
  private async publish(
    path: string,
    body: BodyInit,
    signal?: AbortSignal
  ): Promise<{ id: string; platformRequestId?: string }> {
    let response: Response;
    try {
      response = await this.request(this.graph(path), {
        method: 'POST',
        ...(signal ? { signal } : {}),
        body,
      });
    } catch {
      throw new MetaApiError('meta_publish_result_unknown', 0, false, true);
    }
    const payload = await json(response);
    const requestId =
      response.headers.get('x-fb-trace-id') ?? response.headers.get('x-fb-request-id') ?? undefined;
    if (!response.ok) throw metaError('meta_publish_failed', response, requestId);
    const id = text(payload.post_id) || text(payload.id);
    if (!id)
      throw new MetaApiError(
        'meta_publish_response_invalid',
        502,
        false,
        true,
        undefined,
        requestId
      );
    return { id, ...(requestId ? { platformRequestId: requestId } : {}) };
  }
  private async token(query: URLSearchParams) {
    const response = await this.request(`${this.graph('/oauth/access_token')}?${query}`, {
      headers: { accept: 'application/json' },
    });
    const body = await json(response);
    if (!response.ok) throw metaError('meta_token_exchange_failed', response);
    const accessToken = text(body.access_token);
    if (!accessToken) throw new MetaApiError('meta_token_response_invalid', 502);
    return {
      accessToken,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 5_184_000,
    };
  }
  private graph(path: string, query?: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${this.options.apiVersion}${path}`);
    if (query) url.search = new URLSearchParams(query).toString();
    return url.toString();
  }
}
async function json(response: Response): Promise<Record<string, unknown>> {
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
function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}
function metaError(code: string, response: Response, requestId?: string) {
  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterMs =
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
  return new MetaApiError(
    response.status === 401 || response.status === 403 ? 'meta_authorization_required' : code,
    response.status,
    response.status === 429 || response.status >= 500,
    false,
    retryAfterMs,
    requestId
  );
}

export class FacebookAdapter implements PlatformAdapter {
  public readonly platform = 'facebook' as const;

  public getCapabilities(): PlatformCapabilities {
    return {
      text: true,
      link: true,
      image: { enabled: true, maxCount: 1 },
      video: { enabled: true },
      carousel: false,
      reels: false,
      stories: false,
      delete: true,
    };
  }

  public validate(draft: PlatformDraft): readonly ValidationIssue[] {
    if (!draft.text.trim() && draft.media.length === 0) {
      return [{ code: 'FB_EMPTY_POST', path: 'text', messageKey: 'errors.facebook.emptyPost' }];
    }
    if (draft.media.length > 1)
      return [
        {
          code: 'FB_SINGLE_IMAGE_ONLY',
          path: 'media',
          messageKey: 'errors.facebook.singleImageOnly',
        },
      ];
    return [];
  }

  public async publish(_draft: PlatformDraft): Promise<PlatformPublishResult> {
    throw new Error('FACEBOOK_NOT_CONFIGURED: Page OAuth and publishing require a Meta App.');
  }
}
