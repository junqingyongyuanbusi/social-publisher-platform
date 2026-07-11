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

export const platformExecutionStages = [
  'PREPARE_MEDIA',
  'UPLOAD',
  'WAIT_PROCESSING',
  'PUBLISH',
  'VERIFY',
] as const;

export type PlatformExecutionStage = (typeof platformExecutionStages)[number];

export interface PlatformDraft {
  readonly publicationId: string;
  readonly accountId: string;
  readonly text: string;
  readonly media: readonly PlatformDraftMedia[];
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface PlatformDraftMedia {
  readonly assetId: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly altText?: string;
}

/** Internal media reference. Delivery URLs may be short-lived and must never be logged. */
export interface PlatformMedia {
  readonly assetId: string;
  readonly variantId: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly mimeType: string;
  readonly byteSize: number;
  readonly deliveryUrl: string;
  readonly altText?: string;
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

/**
 * Non-secret, restart-safe state persisted between execution stages. Adapter implementations must
 * never place access tokens, refresh tokens, cookies, signed URLs, or authorization codes here.
 */
export type PlatformExecutionCheckpoint = Readonly<{
  remoteMediaIds?: readonly string[];
  remoteContainerIds?: readonly string[];
  remoteUploadId?: string;
}>;

export interface PlatformStageExecutionInput {
  readonly stage: PlatformExecutionStage;
  readonly attemptId: string;
  readonly draft: PlatformDraft;
  readonly media: readonly PlatformMedia[];
  readonly checkpoint: PlatformExecutionCheckpoint;
  readonly signal?: AbortSignal;
}

export type PlatformAdvanceResult =
  | Readonly<{
      outcome: 'ADVANCE';
      completedStage: 'PREPARE_MEDIA';
      nextStage: 'UPLOAD';
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>
  | Readonly<{
      outcome: 'ADVANCE';
      completedStage: 'UPLOAD';
      nextStage: 'WAIT_PROCESSING';
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>
  | Readonly<{
      outcome: 'ADVANCE';
      completedStage: 'WAIT_PROCESSING';
      nextStage: 'PUBLISH';
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>
  | Readonly<{
      outcome: 'ADVANCE';
      completedStage: 'PUBLISH';
      nextStage: 'VERIFY';
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>;

export type PlatformStageExecutionResult =
  | PlatformAdvanceResult
  | Readonly<{
      outcome: 'WAIT';
      stage: 'WAIT_PROCESSING' | 'VERIFY';
      retryAfterMs: number;
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>
  | Readonly<{
      outcome: 'PUBLISHED';
      stage: 'PUBLISH' | 'VERIFY';
      result: PlatformPublishResult;
    }>
  | Readonly<{
      /** The remote side effect may have succeeded. The orchestrator must verify, not republish. */
      outcome: 'RESULT_UNKNOWN';
      stage: 'PUBLISH' | 'VERIFY';
      code: string;
      verifyAfterMs: number;
      checkpoint: PlatformExecutionCheckpoint;
      platformRequestId?: string;
    }>;

export interface PlatformAdapter {
  readonly platform: Platform;
  getCapabilities(): PlatformCapabilities;
  validate(draft: PlatformDraft): readonly ValidationIssue[];
  /**
   * Staged execution is optional only during the adapter migration. The worker must require it
   * before enabling a platform for production publishing.
   */
  executeStage?(input: PlatformStageExecutionInput): Promise<PlatformStageExecutionResult>;
  /** @deprecated Use executeStage so asynchronous uploads and unknown results are recoverable. */
  publish(draft: PlatformDraft): Promise<PlatformPublishResult>;
}

export type StagedPlatformAdapter = PlatformAdapter &
  Required<Pick<PlatformAdapter, 'executeStage'>>;

export function supportsStagedExecution(
  adapter: PlatformAdapter
): adapter is StagedPlatformAdapter {
  return typeof adapter.executeStage === 'function';
}
