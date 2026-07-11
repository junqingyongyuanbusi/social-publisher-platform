import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createPublicationSchema } from '@social/contracts';
import { DomainProblem } from '@social/domain';
import { PlatformRegistry } from '../platforms/platform-registry.service.js';
import { RequirePermission } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/database.module.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';

@ApiTags('publications')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/publications')
export class PublicationsController {
  constructor(
    private readonly registry: PlatformRegistry,
    private readonly prisma: PrismaService
  ) {}

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a publication without creating it' })
  @RequirePermission('publication.validate')
  async validate(@Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const parsed = createPublicationSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainProblem({
        code: 'publication.input_invalid',
        errorClass: 'VALIDATION',
        status: 422,
        messageKey: 'errors.publicationInputInvalid',
        action: 'EDIT_CONTENT',
        retryable: false,
      });
    }

    if (!isUuid(workspaceId)) throw inputProblem();
    const platform = databasePlatform(parsed.data.settings.platform);
    const [account, contentVersion, assets] = await Promise.all([
      this.prisma.socialAccount.findFirst({
        where: { id: parsed.data.accountId, workspaceId, platform },
        select: { id: true },
      }),
      this.prisma.contentVersion.findFirst({
        where: { id: parsed.data.contentVersionId, workspaceId },
        select: { id: true },
      }),
      this.prisma.mediaAsset.findMany({
        where: {
          workspaceId,
          id: { in: parsed.data.media.map(({ mediaAssetId }) => mediaAssetId) },
          status: 'READY',
          deletedAt: null,
        },
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationMs: true,
        },
      }),
    ]);
    if (!account || !contentVersion || assets.length !== parsed.data.media.length) {
      throw new DomainProblem({
        code: 'publication.resources_unavailable',
        errorClass: 'VALIDATION',
        status: 422,
        messageKey: 'errors.publicationResourcesUnavailable',
        action: 'EDIT_CONTENT',
        retryable: false,
      });
    }

    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const media = parsed.data.media.map((item) => {
      const asset = assetsById.get(item.mediaAssetId);
      if (!asset || asset.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)) throw inputProblem();
      return {
        assetId: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        byteSize: Number(asset.sizeBytes),
        ...(asset.width === null ? {} : { width: asset.width }),
        ...(asset.height === null ? {} : { height: asset.height }),
        ...(asset.durationMs === null ? {} : { durationMs: asset.durationMs }),
        ...(item.altText === null ? {} : { altText: item.altText }),
      };
    });
    const adapter = this.registry.get(parsed.data.settings.platform);
    const issues = adapter.validate({
      publicationId: 'validation-only',
      accountId: parsed.data.accountId,
      text: parsed.data.text,
      media,
      settings: parsed.data.settings,
    });
    return { valid: issues.length === 0, platform: adapter.platform, issues };
  }

  @Post()
  @RequirePermission('publication.create')
  async create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    const parsed = createPublicationSchema.safeParse(body);
    if (!parsed.success || !isUuid(workspaceId)) throw inputProblem();
    const validation = await this.validate(workspaceId, body);
    if (!validation.valid) throw inputProblem();
    const idempotencyKey = request.header('idempotency-key')?.trim() || randomUUID();
    if (idempotencyKey.length > 200) throw inputProblem();
    const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    const publicationId = randomUUID();
    const traceId = request.header('x-request-id') ?? randomUUID();
    return this.prisma.$transaction(async (database) => {
      const existing = await database.publication.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
      });
      if (existing) return existing;
      const publication = await database.publication.create({
        data: {
          id: publicationId,
          workspaceId,
          contentVersionId: parsed.data.contentVersionId,
          socialAccountId: parsed.data.accountId,
          platform: databasePlatform(parsed.data.settings.platform),
          status: scheduledAt && scheduledAt.getTime() > Date.now() ? 'SCHEDULED' : 'QUEUED',
          idempotencyKey,
          text: parsed.data.text,
          contentLocale: parsed.data.contentLocale,
          scheduledAt,
          settings: parsed.data.settings,
          media: {
            create: parsed.data.media.map((item) => ({
              workspaceId,
              mediaAssetId: item.mediaAssetId,
              position: item.position,
              role: 'CONTENT',
              altText: item.altText,
            })),
          },
        },
      });
      await database.outboxEvent.create({
        data: {
          workspaceId,
          aggregateType: 'publication',
          aggregateId: publication.id,
          eventType: 'publication.execute.requested',
          deduplicationKey: `publication.execute:${publication.id}`,
          traceId,
          payload: { publicationId: publication.id, workspaceId },
          availableAt: scheduledAt ?? new Date(),
        },
      });
      await database.auditEvent.create({
        data: {
          workspaceId,
          actorId: getPrincipal(request).subject,
          action: 'publication.created',
          targetType: 'publication',
          targetId: publication.id,
          requestId: traceId,
          metadata: {
            platform: publication.platform,
            scheduledAt: publication.scheduledAt?.toISOString() ?? 'now',
          },
        },
      });
      return publication;
    });
  }

  @Get()
  @RequirePermission('diagnostics.read')
  list(@Param('workspaceId') workspaceId: string) {
    if (!isUuid(workspaceId)) throw inputProblem();
    return this.prisma.publication.findMany({
      where: { workspaceId },
      include: {
        socialAccount: { select: { displayName: true, username: true } },
        attempts: { orderBy: [{ attemptNo: 'desc' }, { startedAt: 'desc' }], take: 10 },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get(':publicationId')
  @RequirePermission('diagnostics.read')
  detail(@Param('workspaceId') workspaceId: string, @Param('publicationId') publicationId: string) {
    if (!isUuid(workspaceId) || !isUuid(publicationId)) throw inputProblem();
    return this.prisma.publication.findFirst({
      where: { id: publicationId, workspaceId },
      include: {
        socialAccount: true,
        media: true,
        attempts: { orderBy: [{ attemptNo: 'asc' }, { startedAt: 'asc' }] },
      },
    });
  }

  @Post(':publicationId/cancel')
  @RequirePermission('publication.cancel')
  async cancel(
    @Param('workspaceId') workspaceId: string,
    @Param('publicationId') publicationId: string
  ) {
    if (!isUuid(workspaceId) || !isUuid(publicationId)) throw inputProblem();
    const result = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        workspaceId,
        status: {
          in: [
            'DRAFT',
            'VALIDATION_FAILED',
            'SCHEDULED',
            'QUEUED',
            'RETRY_WAITING',
            'REAUTH_REQUIRED',
            'FAILED',
          ],
        },
      },
      data: { status: 'CANCELLED' },
    });
    if (result.count !== 1) throw inputProblem();
    return { id: publicationId, status: 'CANCELLED' };
  }

  @Post(':publicationId/retry')
  @RequirePermission('publication.create')
  async retry(
    @Param('workspaceId') workspaceId: string,
    @Param('publicationId') publicationId: string,
    @Req() request: AuthenticatedRequest
  ) {
    if (!isUuid(workspaceId) || !isUuid(publicationId)) throw inputProblem();
    return this.prisma.$transaction(async (database) => {
      const publication = await database.publication.findFirst({
        where: {
          id: publicationId,
          workspaceId,
          status: { in: ['FAILED', 'REAUTH_REQUIRED', 'RETRY_WAITING'] },
        },
      });
      if (!publication) throw inputProblem();
      await database.publication.update({
        where: { id: publicationId },
        data: { status: 'QUEUED' },
      });
      await database.outboxEvent.upsert({
        where: {
          workspaceId_deduplicationKey: {
            workspaceId,
            deduplicationKey: `publication.retry:${publicationId}:${publication.updatedAt.getTime()}`,
          },
        },
        create: {
          workspaceId,
          aggregateType: 'publication',
          aggregateId: publicationId,
          eventType: 'publication.execute.requested',
          deduplicationKey: `publication.retry:${publicationId}:${publication.updatedAt.getTime()}`,
          traceId: request.header('x-request-id') ?? randomUUID(),
          payload: { publicationId, workspaceId },
        },
        update: {},
      });
      return { id: publicationId, status: 'QUEUED' };
    });
  }
}

@Module({ imports: [], controllers: [PublicationsController], providers: [PlatformRegistry] })
export class PublicationsModule {}

function inputProblem(): DomainProblem {
  return new DomainProblem({
    code: 'publication.input_invalid',
    errorClass: 'VALIDATION',
    status: 422,
    messageKey: 'errors.publicationInputInvalid',
    action: 'EDIT_CONTENT',
    retryable: false,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function databasePlatform(platform: 'x' | 'facebook' | 'instagram') {
  return platform === 'x'
    ? ('X' as const)
    : platform === 'facebook'
      ? ('FACEBOOK' as const)
      : ('INSTAGRAM' as const);
}
