import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

export const X_API_ENDPOINTS = {
  createPost: 'https://api.x.com/2/tweets',
  uploadMedia: 'https://api.x.com/2/media/upload',
  initializeMedia: 'https://api.x.com/2/media/upload/initialize',
} as const;

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
    if (!draft.text.trim() && draft.mediaUrls.length === 0) {
      issues.push({ code: 'X_EMPTY_POST', path: 'text', messageKey: 'errors.x.emptyPost' });
    }
    if (draft.mediaUrls.length > 4) {
      issues.push({
        code: 'X_TOO_MANY_MEDIA',
        path: 'mediaUrls',
        messageKey: 'errors.x.tooManyMedia',
      });
    }
    return issues;
  }

  public async publish(_draft: PlatformDraft): Promise<PlatformPublishResult> {
    throw new Error('X_NOT_CONFIGURED: OAuth and publishing are implemented in a dedicated issue.');
  }
}
