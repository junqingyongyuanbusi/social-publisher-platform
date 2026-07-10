import { Controller, Get, Module, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../auth/auth.decorators.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';

@ApiTags('identity')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/identity')
class IdentityController {
  @Get('me')
  @RequirePermission('workspace.read')
  @ApiOperation({ summary: 'Get the authenticated identity in one authorized workspace' })
  me(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    const principal = getPrincipal(request);
    const membership = principal.memberships.find((item) => item.workspaceId === workspaceId);
    if (!membership) throw new Error('Authorization invariant violated');
    return {
      subject: principal.subject,
      email: principal.email ?? null,
      displayName: principal.displayName ?? null,
      workspaceId,
      role: membership.role,
    };
  }
}

@Module({ controllers: [IdentityController] })
export class IdentityModule {}
