import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OidcAccessTokenVerifier } from '@social/auth';
import { API_CONFIG, type ApiConfig } from '../config/api-config.module.js';
import { ACCESS_TOKEN_VERIFIER } from './auth.constants.js';
import { OidcAuthGuard } from './oidc-auth.guard.js';

@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new OidcAccessTokenVerifier({
          issuer: config.oidc.issuer,
          audience: config.oidc.audience,
          jwksUri: config.oidc.jwksUri,
          algorithms: config.oidc.algorithms,
          maxTokenAgeSeconds: config.oidc.maxTokenAgeSeconds,
          production: config.environment === 'production',
        }),
    },
    { provide: APP_GUARD, useClass: OidcAuthGuard },
  ],
})
export class AuthModule {}
