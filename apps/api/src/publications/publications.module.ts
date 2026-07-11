import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createPublicationSchema } from '@social/contracts';
import { DomainProblem } from '@social/domain';
import { PlatformRegistry } from '../platforms/platform-registry.service.js';
import { RequirePermission } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/database.module.js';

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
