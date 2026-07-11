import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Platform } from '@social/domain';
import { Public } from '../auth/auth.decorators.js';
import { PlatformRegistry } from './platform-registry.service.js';

@ApiTags('platforms')
@Controller('platforms')
@Public()
class PlatformsController {
  constructor(private readonly registry: PlatformRegistry) {}

  @Get()
  @ApiOperation({ summary: 'List platform modules and capabilities' })
  list() {
    return this.registry.list().map((adapter) => ({
      platform: adapter.platform,
      capabilities: adapter.getCapabilities(),
    }));
  }

  @Get(':platform/capabilities')
  @ApiOperation({ summary: 'Get current platform capabilities' })
  capabilities(@Param('platform') platform: Platform) {
    return this.registry.get(platform).getCapabilities();
  }
}

@Module({
  controllers: [PlatformsController],
  providers: [PlatformRegistry],
  exports: [PlatformRegistry],
})
export class PlatformsModule {}
