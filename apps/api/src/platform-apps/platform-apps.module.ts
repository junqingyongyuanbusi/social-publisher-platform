import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CredentialVaultError } from '@social/credential-vault';
import { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/database.module.js';

@ApiTags('platform-apps')
@ApiBearerAuth()
@RequirePermission('credential.manage')
@Controller('workspaces/:workspaceId/platform-apps')
class PlatformAppsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List platform applications available for credential management' })
  list(@Param('workspaceId') workspaceId: string) {
    const parsed = z.string().uuid().safeParse(workspaceId);
    if (!parsed.success)
      throw new CredentialVaultError('credential_input_invalid', 'Invalid workspace ID');
    return this.prisma.platformApp.findMany({
      where: { workspaceId: parsed.data },
      select: {
        id: true,
        platform: true,
        name: true,
        environment: true,
        publicClientId: true,
        apiVersion: true,
        redirectUri: true,
        scopes: true,
        status: true,
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
  }
}

@Module({ controllers: [PlatformAppsController] })
export class PlatformAppsModule {}
