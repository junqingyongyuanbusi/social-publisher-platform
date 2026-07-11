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
