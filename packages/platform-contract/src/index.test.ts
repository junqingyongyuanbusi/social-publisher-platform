import { describe, expect, it } from 'vitest';
import type { PlatformAdapter, PlatformStageExecutionResult } from './index.js';
import { platformExecutionStages, supportsStagedExecution } from './index.js';

describe('staged platform execution contract', () => {
  it('defines the only restart-safe execution stages in dependency order', () => {
    expect(platformExecutionStages).toEqual([
      'PREPARE_MEDIA',
      'UPLOAD',
      'WAIT_PROCESSING',
      'PUBLISH',
      'VERIFY',
    ]);
  });

  it('distinguishes unknown remote results from a retryable wait', () => {
    const unknown: PlatformStageExecutionResult = {
      outcome: 'RESULT_UNKNOWN',
      stage: 'PUBLISH',
      code: 'PLATFORM_TIMEOUT_AFTER_REQUEST',
      verifyAfterMs: 5_000,
      checkpoint: { remoteUploadId: 'upload-1' },
    };
    const waiting: PlatformStageExecutionResult = {
      outcome: 'WAIT',
      stage: 'WAIT_PROCESSING',
      retryAfterMs: 3_000,
      checkpoint: { remoteMediaIds: ['media-1'] },
    };

    expect(unknown.outcome).toBe('RESULT_UNKNOWN');
    expect(waiting.outcome).toBe('WAIT');
  });

  it('detects adapters that are safe for the staged worker', () => {
    const legacy = {
      platform: 'x',
      getCapabilities: () => ({
        text: true,
        link: true,
        image: { enabled: true, maxCount: 4 },
        video: { enabled: true },
        carousel: false,
        reels: false,
        stories: false,
        delete: true,
      }),
      validate: () => [],
      publish: async () => ({ remotePostId: '1', publishedAt: new Date(0).toISOString() }),
    } satisfies PlatformAdapter;
    const staged: PlatformAdapter = { ...legacy, executeStage: async () => waitingResult };

    expect(supportsStagedExecution(legacy)).toBe(false);
    expect(supportsStagedExecution(staged)).toBe(true);
  });
});

const waitingResult: PlatformStageExecutionResult = {
  outcome: 'WAIT',
  stage: 'VERIFY',
  retryAfterMs: 1_000,
  checkpoint: {},
};
