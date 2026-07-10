import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { PlatformsModule } from './platforms/platforms.module.js';
import { PublicationsModule } from './publications/publications.module.js';

@Module({
  imports: [AuthModule, HealthModule, IdentityModule, PlatformsModule, PublicationsModule],
})
export class AppModule {}
