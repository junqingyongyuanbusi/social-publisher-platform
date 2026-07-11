import { randomUUID } from 'node:crypto';
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
        media: true,
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
    if (claimed.publication.platform !== 'X')
      throw new XApiError('platform_executor_not_implemented', 501);
    if (claimed.publication.media.length > 0)
      throw new XApiError('x_media_pipeline_not_ready', 422);
    const result = await withValidXAccessToken(claimed.connection, async (client, accessToken) =>
      client.createPost(
        accessToken,
        { text: claimed.publication.text, ...replySetting(claimed.publication.settings) },
        AbortSignal.timeout(20_000)
      )
    );
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
          remotePostUrl: `https://x.com/i/web/status/${result.id}`,
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
    error instanceof XApiError ? error : new XApiError('publication_executor_failed', 0, true);
  const status = x.resultUnknown
    ? 'RESULT_UNKNOWN'
    : x.code === 'x_authorization_required'
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
          : x.code === 'x_authorization_required'
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
