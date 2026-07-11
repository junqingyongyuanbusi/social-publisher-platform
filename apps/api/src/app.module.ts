import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ApiConfigModule } from './config/api-config.module.js';
import { CredentialsModule } from './credentials/credentials.module.js';
import { ContentsModule } from './contents/contents.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { DiagnosticsModule } from './diagnostics/diagnostics.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { MediaModule } from './media/media.module.js';
import { PlatformAppsModule } from './platform-apps/platform-apps.module.js';
import { OAuthConnectionsModule } from './oauth-connections/oauth-connections.module.js';
import { PlatformsModule } from './platforms/platforms.module.js';
import { PublicationsModule } from './publications/publications.module.js';

@Module({
  imports: [
    ApiConfigModule.forRoot(),
    AuthModule,
    DatabaseModule,
    ContentsModule,
    CredentialsModule,
    HealthModule,
    DiagnosticsModule,
    IdentityModule,
    MediaModule,
    OAuthConnectionsModule,
    PlatformAppsModule,
    PlatformsModule,
    PublicationsModule,
  ],
})
export class AppModule {}
