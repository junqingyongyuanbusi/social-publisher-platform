import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createPublicationSchema } from '@social/contracts';
import { DomainProblem } from '@social/domain';
import { PlatformRegistry } from '../platforms/platform-registry.service.js';
import { RequirePermission } from '../auth/auth.decorators.js';

@ApiTags('publications')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/publications')
class PublicationsController {
  constructor(private readonly registry: PlatformRegistry) {}

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a publication without creating it' })
  @RequirePermission('publication.validate')
  validate(@Body() body: unknown) {
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

    const adapter = this.registry.get(parsed.data.settings.platform);
    const issues = adapter.validate({
      publicationId: 'validation-only',
      accountId: parsed.data.accountId,
      text: parsed.data.text,
      mediaUrls: [],
      settings: parsed.data.settings,
    });
    return { valid: issues.length === 0, platform: adapter.platform, issues };
  }
}

@Module({ imports: [], controllers: [PublicationsController], providers: [PlatformRegistry] })
export class PublicationsModule {}
