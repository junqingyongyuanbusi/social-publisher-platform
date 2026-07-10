import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { PlatformsModule } from './platforms/platforms.module.js';
import { PublicationsModule } from './publications/publications.module.js';

@Module({ imports: [HealthModule, PlatformsModule, PublicationsModule] })
export class AppModule {}
