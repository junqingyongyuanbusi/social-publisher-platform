import type { Platform } from '@social/domain';

export interface PlatformCapabilities {
  readonly text: boolean;
  readonly link: boolean;
  readonly image: { readonly enabled: boolean; readonly maxCount: number };
  readonly video: { readonly enabled: boolean };
  readonly carousel: boolean;
  readonly reels: boolean;
  readonly stories: boolean;
  readonly delete: boolean;
  readonly maxTextLength?: number;
}

export interface PlatformDraft {
  readonly publicationId: string;
  readonly accountId: string;
  readonly text: string;
  readonly mediaUrls: readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly messageKey: string;
}

export interface PlatformPublishResult {
  readonly remotePostId: string;
  readonly remotePostUrl?: string;
  readonly publishedAt: string;
  readonly platformRequestId?: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  getCapabilities(): PlatformCapabilities;
  validate(draft: PlatformDraft): readonly ValidationIssue[];
  publish(draft: PlatformDraft): Promise<PlatformPublishResult>;
}
