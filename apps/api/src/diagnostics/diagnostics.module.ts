import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public, RequirePermission } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/database.module.js';

const id = z.string().uuid();
const statuses = [
  'DRAFT',
  'VALIDATING',
  'VALIDATION_FAILED',
  'SCHEDULED',
  'QUEUED',
  'PUBLISHING',
  'RETRY_WAITING',
  'RESULT_UNKNOWN',
  'RECONCILING',
  'REAUTH_REQUIRED',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const;
const platforms = ['X', 'FACEBOOK', 'INSTAGRAM'] as const;
@ApiTags('diagnostics')
@ApiBearerAuth()
@RequirePermission('diagnostics.read')
@Controller('workspaces/:workspaceId/diagnostics')
export class DiagnosticsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('summary') async summary(@Param('workspaceId') workspaceId: string) {
    workspaceId = id.parse(workspaceId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [statusRows, platformRows, accounts, outbox] = await Promise.all([
      this.prisma.publication.groupBy({
        by: ['status'],
        where: { workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.publication.groupBy({
        by: ['platform'],
        where: { workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.socialAccount.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
    ]);
    const published = statusRows.find((x) => x.status === 'PUBLISHED')?._count._all ?? 0;
    const terminal = statusRows
      .filter((x) => ['PUBLISHED', 'FAILED'].includes(x.status))
      .reduce((n, x) => n + x._count._all, 0);
    return {
      windowHours: 24,
      publications: Object.fromEntries(statusRows.map((x) => [x.status, x._count._all])),
      platforms: Object.fromEntries(platformRows.map((x) => [x.platform, x._count._all])),
      accounts: Object.fromEntries(accounts.map((x) => [x.status, x._count._all])),
      outbox: Object.fromEntries(outbox.map((x) => [x.status, x._count._all])),
      successRate: terminal ? published / terminal : null,
      attention: statusRows
        .filter((x) =>
          ['FAILED', 'RESULT_UNKNOWN', 'REAUTH_REQUIRED', 'RETRY_WAITING'].includes(x.status)
        )
        .reduce((n, x) => n + x._count._all, 0),
    };
  }
  @Get('publications') list(
    @Param('workspaceId') workspaceId: string,
    @Query() query: Record<string, unknown>
  ) {
    workspaceId = id.parse(workspaceId);
    const parsed = z
      .object({
        status: z.enum(statuses).optional(),
        platform: z.enum(platforms).optional(),
        q: z.string().trim().max(200).optional(),
      })
      .parse(query);
    return this.prisma.publication.findMany({
      where: {
        workspaceId,
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.platform ? { platform: parsed.platform } : {}),
        ...(parsed.q
          ? id.safeParse(parsed.q).success
            ? { id: parsed.q }
            : {
                OR: [
                  { text: { contains: parsed.q, mode: 'insensitive' } },
                  { remotePostId: { contains: parsed.q, mode: 'insensitive' } },
                ],
              }
          : {}),
      },
      select: {
        id: true,
        platform: true,
        status: true,
        text: true,
        scheduledAt: true,
        publishedAt: true,
        remotePostId: true,
        remotePostUrl: true,
        createdAt: true,
        updatedAt: true,
        socialAccount: { select: { displayName: true, username: true } },
        attempts: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            attemptNo: true,
            stage: true,
            status: true,
            errorCode: true,
            errorClass: true,
            platformRequestId: true,
            startedAt: true,
            finishedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Get('publications/:publicationId') async detail(
    @Param('workspaceId') workspaceId: string,
    @Param('publicationId') publicationId: string
  ) {
    workspaceId = id.parse(workspaceId);
    publicationId = id.parse(publicationId);
    const publication = await this.prisma.publication.findFirst({
      where: { id: publicationId, workspaceId },
      select: {
        id: true,
        platform: true,
        status: true,
        text: true,
        scheduledAt: true,
        publishedAt: true,
        remotePostId: true,
        remotePostUrl: true,
        createdAt: true,
        updatedAt: true,
        socialAccount: { select: { id: true, displayName: true, username: true, status: true } },
        media: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            altText: true,
            remoteMediaId: true,
            remoteContainerId: true,
            mediaAsset: {
              select: { id: true, kind: true, mimeType: true, sizeBytes: true, status: true },
            },
          },
        },
        attempts: {
          orderBy: [{ attemptNo: 'asc' }, { startedAt: 'asc' }],
          select: {
            id: true,
            attemptNo: true,
            stage: true,
            status: true,
            traceId: true,
            platformRequestId: true,
            httpStatus: true,
            errorCode: true,
            errorClass: true,
            startedAt: true,
            finishedAt: true,
            oauthTokenVersion: {
              select: {
                id: true,
                versionNo: true,
                status: true,
                accessTokenExpiresAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!publication) return null;
    const [outbox, audit] = await Promise.all([
      this.prisma.outboxEvent.findMany({
        where: { workspaceId, aggregateId: publicationId },
        select: {
          id: true,
          eventType: true,
          status: true,
          attempts: true,
          traceId: true,
          occurredAt: true,
          availableAt: true,
          publishedAt: true,
          lastErrorCode: true,
        },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.auditEvent.findMany({
        where: { workspaceId, targetId: publicationId },
        select: {
          id: true,
          action: true,
          actorId: true,
          requestId: true,
          createdAt: true,
          metadata: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ...publication,
      media: publication.media.map((item) => ({
        ...item,
        mediaAsset: { ...item.mediaAsset, sizeBytes: Number(item.mediaAsset.sizeBytes) },
      })),
      outbox,
      audit,
    };
  }
}

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8') async metrics() {
    const [publications, outbox, accounts] = await Promise.all([
      this.prisma.publication.groupBy({ by: ['platform', 'status'], _count: { _all: true } }),
      this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.socialAccount.groupBy({ by: ['platform', 'status'], _count: { _all: true } }),
    ]);
    return [
      '# HELP social_publications_total Current publications by platform and status',
      '# TYPE social_publications_total gauge',
      ...publications.map(
        (x) =>
          `social_publications_total{platform="${x.platform.toLowerCase()}",status="${x.status.toLowerCase()}"} ${x._count._all}`
      ),
      '# HELP social_outbox_events_total Current outbox events by status',
      '# TYPE social_outbox_events_total gauge',
      ...outbox.map(
        (x) => `social_outbox_events_total{status="${x.status.toLowerCase()}"} ${x._count._all}`
      ),
      '# HELP social_accounts_total Current accounts by platform and status',
      '# TYPE social_accounts_total gauge',
      ...accounts.map(
        (x) =>
          `social_accounts_total{platform="${x.platform.toLowerCase()}",status="${x.status.toLowerCase()}"} ${x._count._all}`
      ),
      '',
    ].join('\n');
  }
}
@Module({ controllers: [DiagnosticsController, MetricsController] })
export class DiagnosticsModule {}
