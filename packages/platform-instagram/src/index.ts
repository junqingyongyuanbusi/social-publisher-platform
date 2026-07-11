import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

export class InstagramApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    readonly resultUnknown = false,
    readonly retryAfterMs?: number,
    readonly platformRequestId?: string
  ) {
    super(code);
    this.name = 'InstagramApiError';
  }
}
export class InstagramGraphClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: { apiVersion: string; fetch?: typeof fetch }) {
    if (!/^v\d+\.\d+$/.test(options.apiVersion))
      throw new InstagramApiError('instagram_config_invalid', 500);
    this.request = options.fetch ?? fetch;
  }
  async createImageContainer(
    userId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
    signal?: AbortSignal
  ) {
    const body = new URLSearchParams({ image_url: imageUrl, caption, access_token: accessToken });
    return this.create(
      `/${encodeURIComponent(userId)}/media`,
      body,
      'instagram_container_create_result_unknown',
      signal
    );
  }
  async containerStatus(
    containerId: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<{ status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED'; detail?: string }> {
    const response = await this.request(
      this.graph(`/${encodeURIComponent(containerId)}`, {
        fields: 'status_code,status',
        access_token: accessToken,
      }),
      { ...(signal ? { signal } : {}), headers: { accept: 'application/json' } }
    ).catch(() => {
      throw new InstagramApiError('instagram_container_status_unavailable', 0, true);
    });
    const body = await parse(response);
    if (!response.ok) throw graphError('instagram_container_status_failed', response);
    const code = value(body.status_code);
    if (!['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED'].includes(code))
      throw new InstagramApiError('instagram_container_status_invalid', 502, true);
    return {
      status: code as 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED',
      ...(value(body.status) ? { detail: value(body.status) } : {}),
    };
  }
  async publishContainer(
    userId: string,
    accessToken: string,
    creationId: string,
    signal?: AbortSignal
  ) {
    return this.create(
      `/${encodeURIComponent(userId)}/media_publish`,
      new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
      'instagram_publish_result_unknown',
      signal
    );
  }
  async media(
    mediaId: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<{ id: string; permalink?: string }> {
    const response = await this.request(
      this.graph(`/${encodeURIComponent(mediaId)}`, {
        fields: 'id,permalink,timestamp',
        access_token: accessToken,
      }),
      { ...(signal ? { signal } : {}), headers: { accept: 'application/json' } }
    ).catch(() => {
      throw new InstagramApiError('instagram_verify_unavailable', 0, true);
    });
    const body = await parse(response);
    if (!response.ok) throw graphError('instagram_verify_failed', response);
    const id = value(body.id);
    if (!id) throw new InstagramApiError('instagram_verify_response_invalid', 502, true);
    return { id, ...(value(body.permalink) ? { permalink: value(body.permalink) } : {}) };
  }
  private async create(
    path: string,
    body: URLSearchParams,
    unknownCode: string,
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
      throw new InstagramApiError(unknownCode, 0, false, true);
    }
    const payload = await parse(response);
    const requestId =
      response.headers.get('x-fb-trace-id') ?? response.headers.get('x-fb-request-id') ?? undefined;
    if (!response.ok) throw graphError('instagram_graph_request_failed', response, requestId);
    const id = value(payload.id);
    if (!id)
      throw new InstagramApiError(
        'instagram_graph_response_invalid',
        502,
        false,
        true,
        undefined,
        requestId
      );
    return { id, ...(requestId ? { platformRequestId: requestId } : {}) };
  }
  private graph(path: string, query?: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${this.options.apiVersion}${path}`);
    if (query) url.search = new URLSearchParams(query).toString();
    return url.toString();
  }
}
async function parse(response: Response): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await response.json();
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function value(v: unknown) {
  return typeof v === 'string' ? v : '';
}
function graphError(code: string, response: Response, requestId?: string) {
  const after = Number(response.headers.get('retry-after'));
  return new InstagramApiError(
    response.status === 401 || response.status === 403 ? 'instagram_authorization_required' : code,
    response.status,
    response.status === 429 || response.status >= 500,
    false,
    Number.isFinite(after) && after > 0 ? after * 1000 : undefined,
    requestId
  );
}

export class InstagramAdapter implements PlatformAdapter {
  public readonly platform = 'instagram' as const;

  public getCapabilities(): PlatformCapabilities {
    return {
      text: false,
      link: false,
      image: { enabled: true, maxCount: 1 },
      video: { enabled: true },
      carousel: true,
      reels: true,
      stories: false,
      delete: false,
    };
  }

  public validate(draft: PlatformDraft): readonly ValidationIssue[] {
    if (draft.media.length === 0) {
      return [
        {
          code: 'IG_MEDIA_REQUIRED',
          path: 'media',
          messageKey: 'errors.instagram.mediaRequired',
        },
      ];
    }
    if (draft.media.length > 1) {
      return [
        {
          code: 'IG_TOO_MANY_MEDIA',
          path: 'media',
          messageKey: 'errors.instagram.tooManyMedia',
        },
      ];
    }
    return [];
  }

  public async publish(_draft: PlatformDraft): Promise<PlatformPublishResult> {
    throw new Error(
      'INSTAGRAM_NOT_CONFIGURED: Professional Account OAuth and container publishing are pending.'
    );
  }
}
