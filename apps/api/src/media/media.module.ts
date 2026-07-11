import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';
import { PrismaService } from '../database/database.module.js';

const id = z.string().uuid();
const metadataInput = z.object({ altText: z.string().max(1_000).optional() }).passthrough();
const mimeByFormat: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@ApiTags('media')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/media-assets')
class MediaController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @RequirePermission('workspace.read')
  async list(@Param('workspaceId') workspaceId: string) {
    const rows = await this.prisma.mediaAsset.findMany({
      where: { workspaceId: id.parse(workspaceId), deletedAt: null },
      select: {
        id: true,
        kind: true,
        status: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        width: true,
        height: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
  }

  @Post()
  @RequirePermission('publication.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    workspaceId = id.parse(workspaceId);
    metadataInput.parse(body);
    if (!file?.buffer?.length) throw new Error('media_file_required');
    const info = await sharp(file.buffer, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).metadata();
    const mimeType = info.format ? mimeByFormat[info.format] : undefined;
    if (!mimeType || !info.width || !info.height || (info.pages ?? 1) !== 1)
      throw new Error('media_image_unsupported');
    const assetId = randomUUID();
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const key = `${workspaceId}/${assetId}/original.${extension}`;
    const storage = await store(key, file.buffer, mimeType);
    return this.prisma.$transaction(async (database) => {
      const asset = await database.mediaAsset.create({
        data: {
          id: assetId,
          workspaceId,
          kind: 'IMAGE',
          source: 'UPLOAD',
          status: 'READY',
          originalFilename: safeFilename(file.originalname),
          storageProvider: storage.provider,
          storageBucket: storage.bucket,
          storageKey: key,
          mimeType,
          sizeBytes: file.buffer.byteLength,
          checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
          width: info.width,
          height: info.height,
          createdBy: getPrincipal(request).subject,
        },
      });
      await database.auditEvent.create({
        data: {
          workspaceId,
          actorId: getPrincipal(request).subject,
          action: 'media.uploaded',
          targetType: 'media_asset',
          targetId: asset.id,
          requestId: request.header('x-request-id') ?? randomUUID(),
          metadata: {
            mimeType,
            sizeBytes: file.buffer.byteLength,
            width: info.width,
            height: info.height,
          },
        },
      });
      return { ...asset, sizeBytes: Number(asset.sizeBytes) };
    });
  }
}
@Module({ controllers: [MediaController] })
export class MediaModule {}

async function store(
  key: string,
  bytes: Buffer,
  mimeType: string
): Promise<{ provider: string; bucket: string }> {
  if ((process.env['MEDIA_STORAGE_PROVIDER'] ?? 'local') === 's3') {
    const bucket = required('MEDIA_S3_BUCKET');
    const client = new S3Client({
      region: process.env['MEDIA_S3_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1',
      ...(process.env['MEDIA_S3_ENDPOINT']
        ? { endpoint: process.env['MEDIA_S3_ENDPOINT'], forcePathStyle: true }
        : {}),
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
        ServerSideEncryption: 'AES256',
      })
    );
    client.destroy();
    return { provider: 's3', bucket };
  }
  const root = resolve(process.env['MEDIA_LOCAL_ROOT'] ?? '/tmp/social-publisher-media');
  const target = join(root, key);
  if (!target.startsWith(`${root}/`)) throw new Error('media_storage_key_invalid');
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  return { provider: 'local', bucket: root };
}
function safeFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 255) || 'image';
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}
