import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformDraft,
  PlatformPublishResult,
  ValidationIssue,
} from '@social/platform-contract';

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
