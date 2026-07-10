import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators.js';

@ApiTags('health')
@Controller('health')
@Public()
class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  live(): { status: 'ok'; service: string; timestamp: string } {
    return { status: 'ok', service: 'social-publisher-api', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  ready(): { status: 'ready'; checks: Record<string, string> } {
    return { status: 'ready', checks: { api: 'up' } };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
