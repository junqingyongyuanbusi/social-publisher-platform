import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/database.module.js';
import { PlatformRegistry } from '../platforms/platform-registry.service.js';
import { PublicationsController } from './publications.module.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CONTENT_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';

describe('publication validation resource boundary', () => {
  it('resolves ready workspace media before platform validation', async () => {
    const controller = fixture();

    await expect(controller.validate(WORKSPACE_ID, input())).resolves.toEqual({
      valid: true,
      platform: 'instagram',
      issues: [],
    });
  });

  it('fails with the same safe error when an account or media asset is outside the workspace', async () => {
    const missingAccount = fixture({ account: null });
    const missingMedia = fixture({ assets: [] });

    await expect(missingAccount.validate(WORKSPACE_ID, input())).rejects.toMatchObject({
      definition: { code: 'publication.resources_unavailable', status: 422 },
    });
    await expect(missingMedia.validate(WORKSPACE_ID, input())).rejects.toMatchObject({
      definition: { code: 'publication.resources_unavailable', status: 422 },
    });
  });
});

function fixture(overrides: { account?: { id: string } | null; assets?: unknown[] } = {}) {
  const prisma = {
    socialAccount: {
      findFirst: vi.fn(async () =>
        Object.hasOwn(overrides, 'account') ? overrides.account : { id: ACCOUNT_ID }
      ),
    },
    contentVersion: { findFirst: vi.fn(async () => ({ id: CONTENT_VERSION_ID })) },
    mediaAsset: {
      findMany: vi.fn(
        async () =>
          overrides.assets ?? [
            {
              id: ASSET_ID,
              kind: 'IMAGE',
              mimeType: 'image/jpeg',
              sizeBytes: BigInt(1_024),
              width: 1_080,
              height: 1_080,
              durationMs: null,
            },
          ]
      ),
    },
  } as unknown as PrismaService;
  return new PublicationsController(new PlatformRegistry(), prisma);
}

function input() {
  return {
    contentVersionId: CONTENT_VERSION_ID,
    accountId: ACCOUNT_ID,
    text: 'A launch image',
    contentLocale: 'en-US',
    media: [{ mediaAssetId: ASSET_ID, position: 0, altText: 'Product on a table' }],
    settings: { platform: 'instagram', postType: 'feed' },
  };
}
