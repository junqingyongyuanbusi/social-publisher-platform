import { describe, expect, it } from 'vitest';
import {
  appCredentialTypeSchema,
  credentialMetadataSchema,
  mediaAssetMetadataSchema,
  mediaAssetStatusSchema,
  mediaKindSchema,
  mediaVariantStatusSchema,
  oauthConnectionMetadataSchema,
  oauthTokenMetadataSchema,
  platformSchema,
  publicationMediaListSchema,
} from './index.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-07-10T12:00:00.000Z';
const CHECKSUM = 'a'.repeat(64);

describe('response metadata safety', () => {
  it('rejects OAuth token values and client secrets from safe metadata', () => {
    const safeTokenMetadata = {
      tokenType: 'BEARER',
      grantedScopes: ['tweet.write'],
      accessTokenExpiresAt: NOW,
      refreshTokenExpiresAt: null,
      lastRefreshedAt: NOW,
    } as const;

    expect(oauthTokenMetadataSchema.parse(safeTokenMetadata)).toEqual(safeTokenMetadata);
    for (const forbidden of ['accessToken', 'refreshToken', 'clientSecret', 'authorizationCode']) {
      expect(
        oauthTokenMetadataSchema.safeParse({ ...safeTokenMetadata, [forbidden]: 'must-not-leak' })
          .success
      ).toBe(false);
    }

    const connection = {
      id: ID_A,
      workspaceId: ID_B,
      platformAppId: ID_C,
      socialAccountId: ID_B,
      platform: 'x',
      status: 'ACTIVE',
      remoteSubjectId: 'remote-user-1',
      authorization: safeTokenMetadata,
      createdAt: NOW,
      updatedAt: NOW,
      lastValidatedAt: NOW,
    } as const;
    expect(oauthConnectionMetadataSchema.parse(connection)).toEqual(connection);
    expect(
      oauthConnectionMetadataSchema.safeParse({ ...connection, refreshToken: 'must-not-leak' })
        .success
    ).toBe(false);
  });

  it('rejects secrets and encrypted envelope fields from credential responses', () => {
    const credential = {
      id: ID_A,
      platformAppId: ID_B,
      credentialType: 'app_secret',
      versionNo: 1,
      status: 'ACTIVE',
      maskedValue: '••••1234',
      scopes: [],
      expiresAt: null,
      createdAt: NOW,
    } as const;

    expect(credentialMetadataSchema.parse(credential)).toEqual(credential);
    for (const forbidden of ['secret', 'ciphertext', 'encryptedDek', 'authTag']) {
      expect(
        credentialMetadataSchema.safeParse({ ...credential, [forbidden]: 'must-not-leak' }).success
      ).toBe(false);
    }
  });
});

describe('bounded platform and media vocabulary', () => {
  it('keeps account OAuth tokens out of the application-secret API', () => {
    expect(appCredentialTypeSchema.safeParse('app_secret').success).toBe(true);
    expect(appCredentialTypeSchema.safeParse('oauth_access_token').success).toBe(false);
    expect(appCredentialTypeSchema.safeParse('oauth_refresh_token').success).toBe(false);
  });

  it('accepts only the three supported platforms', () => {
    expect(platformSchema.options).toEqual(['x', 'facebook', 'instagram']);
    expect(platformSchema.safeParse('linkedin').success).toBe(false);
    expect(platformSchema.safeParse('X').success).toBe(false);
  });

  it('rejects unsupported media kinds and lifecycle states', () => {
    expect(mediaKindSchema.safeParse('IMAGE').success).toBe(true);
    expect(mediaKindSchema.safeParse('AUDIO').success).toBe(false);
    expect(mediaAssetStatusSchema.safeParse('READY').success).toBe(true);
    expect(mediaAssetStatusSchema.safeParse('PUBLISHED').success).toBe(false);
    expect(mediaVariantStatusSchema.safeParse('PROCESSING').success).toBe(true);
    expect(mediaVariantStatusSchema.safeParse('UPLOADED').success).toBe(false);
  });

  it('keeps media response metadata strict and free of delivery URLs', () => {
    const asset = {
      id: ID_A,
      workspaceId: ID_B,
      kind: 'IMAGE',
      source: 'UPLOAD',
      status: 'READY',
      originalFilename: 'campaign.jpg',
      mimeType: 'image/jpeg',
      byteSize: 1_024,
      checksumSha256: CHECKSUM,
      width: 1_080,
      height: 1_080,
      durationMs: null,
      variants: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    expect(mediaAssetMetadataSchema.parse(asset)).toEqual(asset);
    expect(
      mediaAssetMetadataSchema.safeParse({ ...asset, deliveryUrl: 'https://signed.example/test' })
        .success
    ).toBe(false);
  });

  it('rejects duplicate media assets and ordering positions in one publication', () => {
    expect(
      publicationMediaListSchema.safeParse([
        { mediaAssetId: ID_A, position: 0, altText: null },
        { mediaAssetId: ID_B, position: 0, altText: null },
      ]).success
    ).toBe(false);
    expect(
      publicationMediaListSchema.safeParse([
        { mediaAssetId: ID_A, position: 0, altText: null },
        { mediaAssetId: ID_A, position: 1, altText: null },
      ]).success
    ).toBe(false);
  });
});
