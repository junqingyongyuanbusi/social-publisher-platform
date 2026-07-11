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
    readonly retryable = false
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
function metaError(code: string, response: Response) {
  return new MetaApiError(
    response.status === 401 || response.status === 403 ? 'meta_authorization_required' : code,
    response.status,
    response.status === 429 || response.status >= 500
  );
}

export class FacebookAdapter implements PlatformAdapter {
  public readonly platform = 'facebook' as const;

  public getCapabilities(): PlatformCapabilities {
    return {
      text: true,
      link: true,
      image: { enabled: true, maxCount: 10 },
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
    return [];
  }

  public async publish(_draft: PlatformDraft): Promise<PlatformPublishResult> {
    throw new Error('FACEBOOK_NOT_CONFIGURED: Page OAuth and publishing require a Meta App.');
  }
}
