import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

export class InstagramAdapter implements PlatformAdapter {
  public readonly platform = 'instagram' as const;

  public getCapabilities(): PlatformCapabilities {
    return {
      text: false,
      link: false,
      image: { enabled: true, maxCount: 10 },
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
    if (draft.media.length > 10) {
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
