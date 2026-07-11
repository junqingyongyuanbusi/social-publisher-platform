import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  CredentialEnvelopeCipher,
  CredentialService,
  LocalAesKekProvider,
  OAuthTokenService,
  type KeyEncryptionKeyProvider,
  type OAuthTokenVersionMetadata,
} from '@social/credential-vault';
import { AwsKmsKeyProvider, createAwsKmsClient } from '@social/credential-vault-aws';
import {
  PrismaClient,
  PrismaCredentialVersionRepository,
  PrismaOAuthTokenVersionRepository,
} from '@social/database';
import { XApiError, XOAuthClient } from '@social/platform-x';
import { MetaApiError, MetaGraphClient } from '@social/platform-facebook';
import { InstagramApiError, InstagramGraphClient } from '@social/platform-instagram';
import { PUBLICATION_QUEUE, jobOptions } from './queue-policy.js';

type PublicationJob = { publicationId: string; workspaceId: string };
type TokenBundle = { accessToken: string; refreshToken: string | null; tokenType: string };
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const locks = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const prisma = new PrismaClient();
const queue = new Queue<PublicationJob>(PUBLICATION_QUEUE, { connection });
const cipher = new CredentialEnvelopeCipher(keyProvider());
const tokenRepository = new PrismaOAuthTokenVersionRepository(prisma);
const tokens = new OAuthTokenService(cipher, tokenRepository);
const credentials = new CredentialService(cipher, new PrismaCredentialVersionRepository(prisma));

const worker = new Worker<PublicationJob>(PUBLICATION_QUEUE, execute, {
  connection,
  concurrency: positiveInteger(process.env['WORKER_CONCURRENCY'], 5),
});

async function execute(job: Job<PublicationJob>): Promise<void> {
  const { publicationId, workspaceId } = job.data;
  if (!publicationId || !workspaceId) throw new Error('publication_job_invalid');
  const claimed = await prisma.$transaction(async (database) => {
    await database.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `publication\0${publicationId}`
    );
    const publication = await database.publication.findFirst({
      where: { id: publicationId, workspaceId },
      include: {
        socialAccount: { include: { oauthConnection: { include: { platformApp: true } } } },
        media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
      },
    });
    if (
      !publication ||
      publication.status === 'CANCELLED' ||
      publication.status === 'PUBLISHED' ||
      publication.status === 'FAILED' ||
      publication.status === 'REAUTH_REQUIRED' ||
      publication.status === 'RESULT_UNKNOWN'
    )
      return null;
    if (publication.status === 'PUBLISHING') {
      await database.publication.update({
        where: { id: publication.id },
        data: { status: 'RESULT_UNKNOWN' },
      });
      return null;
    }
    if (publication.status !== 'QUEUED') return null;
    if (publication.scheduledAt && publication.scheduledAt.getTime() > Date.now())
      throw new Error('publication_dispatched_before_schedule');
    const connection = publication.socialAccount.oauthConnection;
    if (
      !connection ||
      connection.status !== 'ACTIVE' ||
      publication.socialAccount.status !== 'ACTIVE'
    ) {
      await database.publication.update({
        where: { id: publication.id },
        data: { status: 'REAUTH_REQUIRED' },
      });
      return null;
    }
    const token = await database.oAuthTokenVersion.findFirst({
      where: { connectionId: connection.id, status: 'ACTIVE' },
      orderBy: { versionNo: 'desc' },
    });
    if (!token) {
      await database.publication.update({
        where: { id: publication.id },
        data: { status: 'REAUTH_REQUIRED' },
      });
      return null;
    }
    const last = await database.publicationAttempt.aggregate({
      where: { publicationId },
      _max: { attemptNo: true },
    });
    const attempt = await database.publicationAttempt.create({
      data: {
        publicationId,
        oauthTokenVersionId: token.id,
        attemptNo: (last._max.attemptNo ?? 0) + 1,
        stage: 'PUBLISH',
        status: 'RUNNING',
        traceId: String(job.data.publicationId),
        startedAt: new Date(),
      },
    });
    await database.publication.update({
      where: { id: publicationId },
      data: { status: 'PUBLISHING' },
    });
    return { publication, connection, attempt };
  });
  if (!claimed) return;

  try {
    const result =
      claimed.publication.platform === 'X'
        ? await withValidXAccessToken(claimed.connection, async (client, accessToken) => {
            const mediaIds: string[] = [];
            for (const item of claimed.publication.media) {
              if (
                item.mediaAsset.kind !== 'IMAGE' ||
                !['image/jpeg', 'image/png', 'image/webp'].includes(item.mediaAsset.mimeType)
              )
                throw new XApiError('x_media_unsupported', 422);
              const bytes = await readMedia(item.mediaAsset);
              try {
                const uploaded = await client.uploadImage(
                  accessToken,
                  bytes,
                  item.mediaAsset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
                  item.altText ?? undefined,
                  AbortSignal.timeout(30_000)
                );
                mediaIds.push(uploaded.id);
                await prisma.publicationMedia.update({
                  where: { id: item.id },
                  data: { remoteMediaId: uploaded.id },
                });
              } finally {
                bytes.fill(0);
              }
            }
            return client.createPost(
              accessToken,
              {
                text: claimed.publication.text,
                ...replySetting(claimed.publication.settings),
                ...(mediaIds.length ? { mediaIds } : {}),
              },
              AbortSignal.timeout(20_000)
            );
          })
        : claimed.publication.platform === 'FACEBOOK'
          ? await publishFacebook(claimed)
          : claimed.publication.platform === 'INSTAGRAM'
            ? await publishInstagram(claimed)
            : (() => {
                throw new MetaApiError('platform_executor_not_implemented', 501);
              })();
    await prisma.$transaction([
      prisma.publicationAttempt.update({
        where: { id: claimed.attempt.id },
        data: {
          status: 'SUCCEEDED',
          ...(result.platformRequestId ? { platformRequestId: result.platformRequestId } : {}),
          httpStatus: 201,
          finishedAt: new Date(),
        },
      }),
      prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'PUBLISHED',
          remotePostId: result.id,
          remotePostUrl:
            ('remoteUrl' in result ? result.remoteUrl : undefined) ??
            (claimed.publication.platform === 'X'
              ? `https://x.com/i/web/status/${result.id}`
              : null),
          publishedAt: new Date(),
        },
      }),
    ]);
    log('info', 'publication_published', {
      publicationId,
      attemptId: claimed.attempt.id,
      remotePostId: result.id,
    });
  } catch (error) {
    await recordFailure(claimed, error, job);
  }
}

async function withValidXAccessToken<T>(
  connectionRecord: {
    id: string;
    workspaceId: string;
    platformAppId: string;
    platformApp: { publicClientId: string; redirectUri: string };
  },
  operation: (client: XOAuthClient, accessToken: string) => Promise<T>
): Promise<T> {
  const metadata = await tokenRepository.findActive(
    connectionRecord.workspaceId,
    connectionRecord.id
  );
  if (!metadata) throw new XApiError('x_authorization_required', 401);
  if (
    metadata.accessTokenExpiresAt &&
    Date.parse(metadata.accessTokenExpiresAt) <= Date.now() + 300_000
  )
    await refreshConnection(connectionRecord);
  return tokens.withDecryptedTokenBundle(
    connectionRecord.workspaceId,
    connectionRecord.id,
    async (bytes) => {
      const bundle = parseBundle(bytes);
      return operation(
        new XOAuthClient({
          clientId: connectionRecord.platformApp.publicClientId,
          redirectUri: connectionRecord.platformApp.redirectUri,
        }),
        bundle.accessToken
      );
    }
  );
}

async function publishFacebook(claimed: {
  publication: {
    text: string;
    settings: unknown;
    socialAccount: { remoteId: string };
    media: {
      id: string;
      altText: string | null;
      mediaAsset: {
        kind: string;
        mimeType: string;
        storageProvider: string;
        storageBucket: string;
        storageKey: string;
        sizeBytes: bigint;
      };
    }[];
  };
  connection: {
    id: string;
    workspaceId: string;
    platformAppId: string;
    platformApp: { publicClientId: string; redirectUri: string; apiVersion: string | null };
  };
}) {
  if (claimed.publication.media.length > 1)
    throw new MetaApiError('facebook_single_image_only', 422);
  return withMetaAccess(claimed.connection, async (client, accessToken) => {
    const media = claimed.publication.media[0];
    let result: { id: string; platformRequestId?: string };
    if (media) {
      if (media.mediaAsset.kind !== 'IMAGE')
        throw new MetaApiError('facebook_media_unsupported', 422);
      const bytes = await readMedia(media.mediaAsset);
      try {
        result = await client.publishPagePhoto(
          claimed.publication.socialAccount.remoteId,
          accessToken,
          bytes,
          media.mediaAsset.mimeType,
          claimed.publication.text,
          AbortSignal.timeout(30_000)
        );
        await prisma.publicationMedia.update({
          where: { id: media.id },
          data: { remoteMediaId: result.id },
        });
      } finally {
        bytes.fill(0);
      }
    } else {
      result = await client.publishPagePost(
        claimed.publication.socialAccount.remoteId,
        accessToken,
        { message: claimed.publication.text, ...facebookLink(claimed.publication.settings) },
        AbortSignal.timeout(20_000)
      );
    }
    let remoteUrl: string | undefined;
    try {
      remoteUrl = (
        await client.getPublishedObject(result.id, accessToken, AbortSignal.timeout(10_000))
      )?.permalinkUrl;
    } catch {}
    return { ...result, ...(remoteUrl ? { remoteUrl } : {}) };
  });
}

async function publishInstagram(claimed: {
  publication: {
    text: string;
    socialAccount: { remoteId: string };
    media: {
      id: string;
      remoteContainerId: string | null;
      mediaAsset: {
        kind: string;
        storageProvider: string;
        storageBucket: string;
        storageKey: string;
      };
    }[];
  };
  connection: { id: string; workspaceId: string; platformApp: { apiVersion: string | null } };
}) {
  if (claimed.publication.media.length !== 1)
    throw new InstagramApiError('instagram_single_image_required', 422);
  const item = claimed.publication.media[0]!;
  if (item.mediaAsset.kind !== 'IMAGE' || item.mediaAsset.storageProvider !== 's3')
    throw new InstagramApiError('instagram_s3_image_required', 422);
  return tokens.withDecryptedTokenBundle(
    claimed.connection.workspaceId,
    claimed.connection.id,
    async (bytes) => {
      const accessToken = parseBundle(bytes).accessToken;
      const client = new InstagramGraphClient({
        apiVersion: claimed.connection.platformApp.apiVersion ?? 'v23.0',
      });
      let containerId = item.remoteContainerId;
      if (!containerId) {
        const imageUrl = await signedMediaUrl(
          item.mediaAsset.storageBucket,
          item.mediaAsset.storageKey
        );
        const created = await client.createImageContainer(
          claimed.publication.socialAccount.remoteId,
          accessToken,
          imageUrl,
          claimed.publication.text,
          AbortSignal.timeout(20_000)
        );
        containerId = created.id;
        await prisma.publicationMedia.update({
          where: { id: item.id },
          data: { remoteContainerId: containerId },
        });
      }
      for (let poll = 0; poll < 20; poll += 1) {
        const status = await client.containerStatus(
          containerId,
          accessToken,
          AbortSignal.timeout(10_000)
        );
        if (status.status === 'FINISHED') {
          const published = await client.publishContainer(
            claimed.publication.socialAccount.remoteId,
            accessToken,
            containerId,
            AbortSignal.timeout(20_000)
          );
          const verified = await client.media(
            published.id,
            accessToken,
            AbortSignal.timeout(10_000)
          );
          return { ...published, remoteUrl: verified.permalink };
        }
        if (status.status === 'ERROR' || status.status === 'EXPIRED')
          throw new InstagramApiError('instagram_container_failed', 422);
        await delay(3_000);
      }
      throw new InstagramApiError('instagram_container_processing', 503, true);
    }
  );
}

async function signedMediaUrl(bucket: string, key: string) {
  const client = new S3Client({
    region: process.env['MEDIA_S3_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['MEDIA_S3_ENDPOINT']
      ? { endpoint: process.env['MEDIA_S3_ENDPOINT'], forcePathStyle: true }
      : {}),
  });
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 900,
    });
  } finally {
    client.destroy();
  }
}

async function withMetaAccess<T>(
  connectionRecord: {
    id: string;
    workspaceId: string;
    platformAppId: string;
    platformApp: { publicClientId: string; redirectUri: string; apiVersion: string | null };
  },
  operation: (client: MetaGraphClient, accessToken: string) => Promise<T>
): Promise<T> {
  const active = (
    await credentials.list(connectionRecord.workspaceId, connectionRecord.platformAppId)
  ).find((item) => item.credentialType === 'app_secret' && item.status === 'ACTIVE');
  if (!active) throw new MetaApiError('platform_app_secret_required', 500);
  return credentials.withDecryptedCredential(connectionRecord.workspaceId, active.id, (secret) =>
    tokens.withDecryptedTokenBundle(connectionRecord.workspaceId, connectionRecord.id, (bytes) =>
      operation(
        new MetaGraphClient({
          clientId: connectionRecord.platformApp.publicClientId,
          clientSecret: Buffer.from(secret).toString('utf8'),
          redirectUri: connectionRecord.platformApp.redirectUri,
          apiVersion: connectionRecord.platformApp.apiVersion ?? 'v23.0',
        }),
        parseBundle(bytes).accessToken
      )
    )
  );
}

async function refreshConnection(connectionRecord: {
  id: string;
  workspaceId: string;
  platformAppId: string;
  platformApp: { publicClientId: string; redirectUri: string };
}): Promise<OAuthTokenVersionMetadata> {
  const lockKey = `social:oauth-refresh:v1:${connectionRecord.id}`;
  const lockValue = randomUUID();
  const acquired = await locks.set(lockKey, lockValue, 'PX', 30_000, 'NX');
  if (!acquired) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(250);
      const current = await tokenRepository.findActive(
        connectionRecord.workspaceId,
        connectionRecord.id
      );
      if (
        current?.accessTokenExpiresAt &&
        Date.parse(current.accessTokenExpiresAt) > Date.now() + 300_000
      )
        return current;
    }
    throw new XApiError('x_token_refresh_busy', 503, true);
  }
  try {
    const current = await tokenRepository.findActive(
      connectionRecord.workspaceId,
      connectionRecord.id
    );
    if (!current) throw new XApiError('x_authorization_required', 401);
    if (
      current.accessTokenExpiresAt &&
      Date.parse(current.accessTokenExpiresAt) > Date.now() + 300_000
    )
      return current;
    return tokens.withDecryptedTokenBundle(
      connectionRecord.workspaceId,
      connectionRecord.id,
      async (bytes) => {
        const old = parseBundle(bytes);
        if (!old.refreshToken) throw new XApiError('x_authorization_required', 401);
        return withXClient(connectionRecord, async (client) => {
          const fresh = await client.refresh(old.refreshToken as string);
          const bundle = Buffer.from(
            JSON.stringify({
              accessToken: fresh.accessToken,
              refreshToken: fresh.refreshToken ?? old.refreshToken,
              tokenType: fresh.tokenType,
            })
          );
          return tokens.put({
            workspaceId: connectionRecord.workspaceId,
            platformAppId: connectionRecord.platformAppId,
            connectionId: connectionRecord.id,
            tokenBundle: bundle,
            scopes: fresh.scopes.length ? fresh.scopes : current.scopes,
            accessTokenExpiresAt: new Date(Date.now() + fresh.expiresIn * 1_000).toISOString(),
            refreshTokenExpiresAt: null,
            refreshable: true,
            actorId: 'system:worker',
            requestId: randomUUID(),
          });
        });
      }
    );
  } finally {
    if ((await locks.get(lockKey)) === lockValue) await locks.del(lockKey);
  }
}

async function withXClient<T>(
  connectionRecord: {
    workspaceId: string;
    platformAppId: string;
    platformApp: { publicClientId: string; redirectUri: string };
  },
  operation: (client: XOAuthClient) => Promise<T>
): Promise<T> {
  const active = (
    await credentials.list(connectionRecord.workspaceId, connectionRecord.platformAppId)
  ).find((x) => x.credentialType === 'app_secret' && x.status === 'ACTIVE');
  if (!active)
    return operation(
      new XOAuthClient({
        clientId: connectionRecord.platformApp.publicClientId,
        redirectUri: connectionRecord.platformApp.redirectUri,
      })
    );
  return credentials.withDecryptedCredential(connectionRecord.workspaceId, active.id, (bytes) =>
    operation(
      new XOAuthClient({
        clientId: connectionRecord.platformApp.publicClientId,
        clientSecret: Buffer.from(bytes).toString('utf8'),
        redirectUri: connectionRecord.platformApp.redirectUri,
      })
    )
  );
}

async function recordFailure(
  claimed: {
    publication: { id: string; workspaceId: string; socialAccountId: string };
    connection: { id: string };
    attempt: { id: string; attemptNo: number; traceId: string };
  },
  error: unknown,
  job: Job<PublicationJob>
): Promise<void> {
  const x =
    error instanceof XApiError ||
    error instanceof MetaApiError ||
    error instanceof InstagramApiError
      ? error
      : new XApiError('publication_executor_failed', 0, true);
  const status = x.resultUnknown
    ? 'RESULT_UNKNOWN'
    : [
          'x_authorization_required',
          'meta_authorization_required',
          'instagram_authorization_required',
        ].includes(x.code)
      ? 'REAUTH_REQUIRED'
      : x.retryable
        ? 'RETRY_WAITING'
        : 'FAILED';
  await prisma.$transaction(async (database) => {
    await database.publicationAttempt.update({
      where: { id: claimed.attempt.id },
      data: {
        status: x.resultUnknown ? 'UNKNOWN' : 'FAILED',
        ...(x.platformRequestId ? { platformRequestId: x.platformRequestId } : {}),
        httpStatus: x.status || null,
        errorCode: x.code,
        errorClass: x.resultUnknown
          ? 'UNKNOWN_RESULT'
          : [
                'x_authorization_required',
                'meta_authorization_required',
                'instagram_authorization_required',
              ].includes(x.code)
            ? 'AUTHENTICATION'
            : x.retryable
              ? 'TRANSIENT'
              : 'PERMANENT',
        finishedAt: new Date(),
      },
    });
    await database.publication.update({ where: { id: claimed.publication.id }, data: { status } });
    if (status === 'REAUTH_REQUIRED') {
      await database.oAuthConnection.update({
        where: { id: claimed.connection.id },
        data: { status: 'REAUTH_REQUIRED' },
      });
      await database.socialAccount.update({
        where: { id: claimed.publication.socialAccountId },
        data: { status: 'REAUTH_REQUIRED' },
      });
    }
    if (status === 'RETRY_WAITING')
      await database.outboxEvent.create({
        data: {
          workspaceId: claimed.publication.workspaceId,
          aggregateType: 'publication',
          aggregateId: claimed.publication.id,
          eventType: 'publication.execute.requested',
          deduplicationKey: `publication.attempt:${claimed.publication.id}:${claimed.attempt.attemptNo}`,
          traceId: claimed.attempt.traceId,
          payload: {
            publicationId: claimed.publication.id,
            workspaceId: claimed.publication.workspaceId,
          },
          availableAt: new Date(
            Date.now() +
              (x.retryAfterMs ?? Math.min(300_000, 5_000 * 2 ** claimed.attempt.attemptNo))
          ),
        },
      });
  });
  log('error', 'publication_attempt_failed', {
    publicationId: claimed.publication.id,
    attemptId: claimed.attempt.id,
    code: x.code,
    status,
  });
  if (x.retryable) job.discard();
}

async function dispatchOutbox(): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      availableAt: { lte: new Date() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    orderBy: { occurredAt: 'asc' },
    take: 50,
  });
  for (const event of events) {
    const payload = event.payload as Partial<PublicationJob>;
    if (!payload.publicationId || !payload.workspaceId) continue;
    const lock = await prisma.outboxEvent.updateMany({
      where: { id: event.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: {
        status: 'PROCESSING',
        lockedBy: process.pid.toString(),
        lockedUntil: new Date(Date.now() + 30_000),
        attempts: { increment: 1 },
      },
    });
    if (!lock.count) continue;
    try {
      await prisma.publication.updateMany({
        where: {
          id: payload.publicationId,
          workspaceId: payload.workspaceId,
          status: { in: ['SCHEDULED', 'RETRY_WAITING'] },
        },
        data: { status: 'QUEUED' },
      });
      const target = await prisma.publication.findFirst({
        where: { id: payload.publicationId, workspaceId: payload.workspaceId },
        select: { status: true },
      });
      if (target?.status !== 'QUEUED') {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            lockedBy: null,
            lockedUntil: null,
            lastErrorCode: 'publication_not_dispatchable',
          },
        });
        continue;
      }
      await queue.add(
        'execute',
        { publicationId: payload.publicationId, workspaceId: payload.workspaceId },
        { ...jobOptions, jobId: `publication-${payload.publicationId}-${event.id}` }
      );
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), lockedBy: null, lockedUntil: null },
      });
    } catch {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PENDING',
          availableAt: new Date(Date.now() + 5_000),
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: 'queue_publish_failed',
        },
      });
    }
  }
}

const dispatcher = setInterval(
  () => void dispatchOutbox().catch(() => log('error', 'outbox_dispatch_failed', {})),
  1_000
);
dispatcher.unref();
void dispatchOutbox();
worker.on('failed', (job, error) =>
  log('error', 'publication_job_failed', { jobId: job?.id, code: error.message })
);
async function shutdown() {
  clearInterval(dispatcher);
  await worker.close();
  await queue.close();
  await Promise.all([connection.quit(), locks.quit(), prisma.$disconnect()]);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

function parseBundle(bytes: Uint8Array): TokenBundle {
  const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<TokenBundle>;
  if (!value.accessToken) throw new XApiError('x_authorization_required', 401);
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken ?? null,
    tokenType: value.tokenType ?? 'bearer',
  };
}
function replySetting(value: unknown): { replyToId?: string } {
  if (
    value &&
    typeof value === 'object' &&
    'replyToId' in value &&
    typeof value.replyToId === 'string'
  )
    return { replyToId: value.replyToId };
  return {};
}
function facebookLink(value: unknown): { link?: string } {
  if (value && typeof value === 'object' && 'link' in value && typeof value.link === 'string')
    return { link: value.link };
  return {};
}
async function readMedia(asset: {
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
  sizeBytes: bigint;
}): Promise<Uint8Array> {
  if (asset.sizeBytes > 10n * 1024n * 1024n) throw new XApiError('x_media_too_large', 422);
  if (asset.storageProvider === 's3') {
    const client = new S3Client({
      region: process.env['MEDIA_S3_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1',
      ...(process.env['MEDIA_S3_ENDPOINT']
        ? { endpoint: process.env['MEDIA_S3_ENDPOINT'], forcePathStyle: true }
        : {}),
    });
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey })
      );
      if (!result.Body) throw new Error('empty');
      return new Uint8Array(await result.Body.transformToByteArray());
    } catch {
      throw new XApiError('media_storage_unavailable', 503, true);
    } finally {
      client.destroy();
    }
  }
  if (asset.storageProvider === 'local') {
    const root = resolve(asset.storageBucket);
    const target = join(root, asset.storageKey);
    if (!target.startsWith(`${root}/`)) throw new XApiError('media_storage_key_invalid', 500);
    try {
      return new Uint8Array(await readFile(target));
    } catch {
      throw new XApiError('media_storage_unavailable', 503, true);
    }
  }
  throw new XApiError('media_storage_provider_unsupported', 500);
}
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function positiveInteger(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>) {
  process.stdout.write(
    `${JSON.stringify({ level, event, ...fields, timestamp: new Date().toISOString() })}\n`
  );
}
function keyProvider(): KeyEncryptionKeyProvider {
  if ((process.env['CREDENTIAL_KEK_PROVIDER'] ?? 'local') === 'aws-kms')
    return new AwsKmsKeyProvider(createAwsKmsClient(required('AWS_REGION')), {
      keyId: required('AWS_KMS_KEY_ID'),
    });
  return new LocalAesKekProvider(
    required('CREDENTIAL_LOCAL_KEK_BASE64'),
    required('CREDENTIAL_LOCAL_KEK_VERSION')
  );
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}
