import { platforms } from '@social/domain';
import { z } from 'zod';

export const localeSchema = z.enum(['zh-CN', 'en-US']);
export const platformSchema = z.enum(platforms);

export const problemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string(),
  code: z.string(),
  requestId: z.string(),
  traceId: z.string().optional(),
  action: z.string().optional(),
});

export const oauthConnectionStatusSchema = z.enum([
  'ACTIVE',
  'REAUTH_REQUIRED',
  'REVOKED',
  'ERROR',
]);

export const oauthTokenTypeSchema = z.enum(['BEARER', 'OAUTH1']);

/**
 * Transient request-only query received from a platform authorization server.
 * Authorization codes must be consumed once and must never be persisted or returned.
 */
export const oauthCallbackQuerySchema = z.union([
  z
    .object({
      code: z.string().min(1).max(8_192),
      state: z.string().min(32).max(2_048),
    })
    .strict(),
  z
    .object({
      error: z.string().min(1).max(200),
      error_description: z.string().max(2_000).optional(),
      state: z.string().min(32).max(2_048).optional(),
    })
    .strict(),
]);

/** Safe response metadata. Token values are deliberately absent. */
export const oauthTokenMetadataSchema = z
  .object({
    tokenType: oauthTokenTypeSchema,
    grantedScopes: z.array(z.string().min(1).max(200)).max(100),
    accessTokenExpiresAt: z.iso.datetime().nullable(),
    refreshTokenExpiresAt: z.iso.datetime().nullable(),
    lastRefreshedAt: z.iso.datetime().nullable(),
  })
  .strict();

/** Safe OAuth connection response. Secrets, codes, and token values are never projected here. */
export const oauthConnectionMetadataSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    platformAppId: z.string().uuid(),
    socialAccountId: z.string().uuid(),
    platform: platformSchema,
    status: oauthConnectionStatusSchema,
    remoteSubjectId: z.string().min(1).max(500),
    authorization: oauthTokenMetadataSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastValidatedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const mediaKindSchema = z.enum(['IMAGE', 'VIDEO']);
export const mediaSourceSchema = z.enum(['UPLOAD', 'REMOTE_IMPORT', 'GENERATED']);
export const mediaAssetStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'UPLOADED',
  'PROCESSING',
  'READY',
  'FAILED',
  'DELETED',
]);
export const mediaVariantKindSchema = z.enum([
  'ORIGINAL',
  'THUMBNAIL',
  'PLATFORM_IMAGE',
  'PLATFORM_VIDEO',
]);
export const mediaVariantStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
  'DELETED',
]);

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nullableDimensionSchema = z.number().int().positive().nullable();

export const createMediaAssetSchema = z
  .object({
    kind: mediaKindSchema,
    source: mediaSourceSchema,
    originalFilename: z.string().min(1).max(1_024).nullable().default(null),
    mimeType: z.string().min(1).max(200),
    byteSize: z.number().int().positive(),
    checksumSha256: checksumSchema,
  })
  .strict();

export const mediaVariantMetadataSchema = z
  .object({
    id: z.string().uuid(),
    kind: mediaVariantKindSchema,
    platform: platformSchema.nullable(),
    status: mediaVariantStatusSchema,
    mimeType: z.string().min(1).max(200),
    byteSize: z.number().int().nonnegative(),
    checksumSha256: checksumSchema,
    width: nullableDimensionSchema,
    height: nullableDimensionSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** Safe media response metadata. Delivery and upload URLs are issued by separate short-lived APIs. */
export const mediaAssetMetadataSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind: mediaKindSchema,
    source: mediaSourceSchema,
    status: mediaAssetStatusSchema,
    originalFilename: z.string().min(1).max(1_024).nullable(),
    mimeType: z.string().min(1).max(200),
    byteSize: z.number().int().nonnegative(),
    checksumSha256: checksumSchema,
    width: nullableDimensionSchema,
    height: nullableDimensionSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    variants: z.array(mediaVariantMetadataSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const publicationMediaInputSchema = z
  .object({
    mediaAssetId: z.string().uuid(),
    position: z.number().int().min(0).max(9),
    altText: z.string().max(1_000).nullable().default(null),
  })
  .strict();

export const publicationMediaListSchema = z
  .array(publicationMediaInputSchema)
  .max(10)
  .superRefine((items, context) => {
    const positions = new Set<number>();
    const assetIds = new Set<string>();
    items.forEach((item, index) => {
      if (positions.has(item.position)) {
        context.addIssue({
          code: 'custom',
          message: 'Publication media positions must be unique',
          path: [index, 'position'],
        });
      }
      if (assetIds.has(item.mediaAssetId)) {
        context.addIssue({
          code: 'custom',
          message: 'A media asset can appear only once in a publication',
          path: [index, 'mediaAssetId'],
        });
      }
      positions.add(item.position);
      assetIds.add(item.mediaAssetId);
    });
  });

export const publicationMediaMetadataSchema = z
  .object({
    id: z.string().uuid(),
    publicationId: z.string().uuid(),
    mediaAssetId: z.string().uuid(),
    selectedVariantId: z.string().uuid().nullable(),
    position: z.number().int().min(0).max(9),
    altText: z.string().max(1_000).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const platformSettingsSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('x'), replyToId: z.string().optional() }).strict(),
  z
    .object({
      platform: z.literal('facebook'),
      postType: z.enum(['feed', 'photo', 'video']),
      link: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      platform: z.literal('instagram'),
      postType: z.enum(['feed', 'carousel', 'reel']),
      collaborators: z.array(z.string()).max(3).optional(),
    })
    .strict(),
]);

export const createPublicationSchema = z
  .object({
    contentVersionId: z.string().uuid(),
    accountId: z.string().uuid(),
    text: z.string(),
    contentLocale: localeSchema,
    scheduledAt: z.iso.datetime().optional(),
    media: publicationMediaListSchema.default([]),
    settings: platformSettingsSchema,
  })
  .strict();

export const credentialStatusSchema = z.enum(['ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED']);
export const appCredentialTypeSchema = z.enum(['app_secret', 'api_key', 'webhook_secret']);

export const credentialMetadataSchema = z
  .object({
    id: z.string().uuid(),
    platformAppId: z.string().uuid(),
    credentialType: appCredentialTypeSchema,
    versionNo: z.number().int().positive(),
    status: credentialStatusSchema,
    maskedValue: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

/** Request-only schema. Secret fields must never appear in a response contract. */
export const putCredentialSchema = z
  .object({
    credentialType: appCredentialTypeSchema,
    secret: z.string().min(1).max(65_536),
    scopes: z.array(z.string().min(1).max(200)).max(100).default([]),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();

export type Locale = z.infer<typeof localeSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type OAuthConnectionStatus = z.infer<typeof oauthConnectionStatusSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
export type OAuthTokenMetadata = z.infer<typeof oauthTokenMetadataSchema>;
export type OAuthConnectionMetadata = z.infer<typeof oauthConnectionMetadataSchema>;
export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaSource = z.infer<typeof mediaSourceSchema>;
export type MediaAssetStatus = z.infer<typeof mediaAssetStatusSchema>;
export type MediaVariantKind = z.infer<typeof mediaVariantKindSchema>;
export type MediaVariantStatus = z.infer<typeof mediaVariantStatusSchema>;
export type CreateMediaAssetInput = z.infer<typeof createMediaAssetSchema>;
export type MediaVariantMetadata = z.infer<typeof mediaVariantMetadataSchema>;
export type MediaAssetMetadata = z.infer<typeof mediaAssetMetadataSchema>;
export type PublicationMediaInput = z.infer<typeof publicationMediaInputSchema>;
export type PublicationMediaMetadata = z.infer<typeof publicationMediaMetadataSchema>;
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type CredentialMetadata = z.infer<typeof credentialMetadataSchema>;
export type AppCredentialType = z.infer<typeof appCredentialTypeSchema>;
export type PutCredentialInput = z.infer<typeof putCredentialSchema>;
