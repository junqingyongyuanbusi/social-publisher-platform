import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OidcAccessTokenVerifier } from '@social/auth';
import { ACCESS_TOKEN_VERIFIER } from './auth.constants.js';
import { OidcAuthGuard } from './oidc-auth.guard.js';

@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: () =>
        new OidcAccessTokenVerifier({
          issuer: requiredEnvironment('OIDC_ISSUER'),
          audience: requiredEnvironment('OIDC_AUDIENCE'),
          jwksUri: requiredEnvironment('OIDC_JWKS_URI'),
          algorithms: (process.env['OIDC_ALGORITHMS'] ?? 'RS256,ES256')
            .split(',')
            .map((value) => value.trim()),
          maxTokenAgeSeconds: Number(process.env['OIDC_MAX_TOKEN_AGE_SECONDS'] ?? 3_600),
          production: process.env['NODE_ENV'] === 'production',
        }),
    },
    { provide: APP_GUARD, useClass: OidcAuthGuard },
  ],
})
export class AuthModule {}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}
