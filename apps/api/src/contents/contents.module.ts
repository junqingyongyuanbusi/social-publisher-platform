import { createHash, randomUUID } from 'node:crypto';
import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';
import { PrismaService } from '../database/database.module.js';

const input = z
  .object({
    title: z.string().trim().min(1).max(500),
    body: z.string().max(100_000),
    locale: z.enum(['zh-CN', 'en-US']),
  })
  .strict();
const identifier = z.string().uuid();
@ApiTags('contents')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/contents')
class ContentsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @RequirePermission('workspace.read')
  list(@Param('workspaceId') workspaceId: string) {
    return this.prisma.content.findMany({
      where: { workspaceId: identifier.parse(workspaceId) },
      include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }
  @Post()
  @RequirePermission('publication.create')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    workspaceId = identifier.parse(workspaceId);
    const value = input.parse(body);
    const requestId = request.header('x-request-id') ?? randomUUID();
    return this.prisma.$transaction(async (database) => {
      const content = await database.content.create({
        data: {
          workspaceId,
          title: value.title,
          versions: {
            create: {
              versionNo: 1,
              sourceLocale: value.locale,
              body: value.body,
              checksum: createHash('sha256').update(value.body).digest('hex'),
            },
          },
        },
        include: { versions: true },
      });
      await database.auditEvent.create({
        data: {
          workspaceId,
          actorId: getPrincipal(request).subject,
          action: 'content.created',
          targetType: 'content',
          targetId: content.id,
          requestId,
          metadata: { versionNo: 1, locale: value.locale },
        },
      });
      return content;
    });
  }
}
@Module({ controllers: [ContentsController] })
export class ContentsModule {}
