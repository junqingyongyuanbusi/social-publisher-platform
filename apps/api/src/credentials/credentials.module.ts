import { Body, Controller, Delete, Get, Inject, Module, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { putCredentialSchema } from '@social/contracts';
import {
  CredentialEnvelopeCipher,
  CredentialService,
  CredentialVaultError,
  LocalAesKekProvider,
  type KeyEncryptionKeyProvider,
} from '@social/credential-vault';
import { AwsKmsKeyProvider, createAwsKmsClient } from '@social/credential-vault-aws';
import { PrismaCredentialVersionRepository } from '@social/database';
import { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';
import { PrismaService } from '../database/database.module.js';

const CREDENTIAL_SERVICE = Symbol('CREDENTIAL_SERVICE');
const idSchema = z.string().uuid();

@ApiTags('credentials')
@ApiBearerAuth()
@RequirePermission('credential.manage')
@Controller('workspaces/:workspaceId/platform-apps/:platformAppId/credentials')
class CredentialsController {
  constructor(@Inject(CREDENTIAL_SERVICE) private readonly credentials: CredentialService) {}

  @Get()
  @ApiOperation({ summary: 'List masked credential-version metadata' })
  list(@Param('workspaceId') workspaceId: string, @Param('platformAppId') platformAppId: string) {
    return this.credentials.list(validId(workspaceId), validId(platformAppId));
  }

  @Post()
  @ApiOperation({ summary: 'Create or rotate a credential version' })
  async put(
    @Param('workspaceId') workspaceId: string,
    @Param('platformAppId') platformAppId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    const parsed = putCredentialSchema.safeParse(body);
    if (!parsed.success) {
      redactRequestSecret(body);
      throw new CredentialVaultError('credential_input_invalid', 'Invalid input');
    }
    const ownedSecret = Buffer.from(parsed.data.secret, 'utf8');
    try {
      return await this.credentials.put({
        workspaceId: validId(workspaceId),
        platformAppId: validId(platformAppId),
        credentialType: parsed.data.credentialType,
        secret: ownedSecret,
        scopes: parsed.data.scopes,
        expiresAt: parsed.data.expiresAt,
        actorId: getPrincipal(request).subject,
        requestId: request.header('x-request-id') ?? 'unknown',
      });
    } finally {
      ownedSecret.fill(0);
      redactRequestSecret(body);
    }
  }

  @Delete(':credentialId')
  @ApiOperation({ summary: 'Revoke a credential version' })
  revoke(
    @Param('workspaceId') workspaceId: string,
    @Param('platformAppId') platformAppId: string,
    @Param('credentialId') credentialId: string,
    @Req() request: AuthenticatedRequest
  ) {
    return this.credentials.revoke(
      validId(workspaceId),
      validId(platformAppId),
      validId(credentialId),
      getPrincipal(request).subject,
      request.header('x-request-id') ?? 'unknown'
    );
  }
}

@Module({
  controllers: [CredentialsController],
  providers: [
    {
      provide: CREDENTIAL_SERVICE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CredentialService(
          new CredentialEnvelopeCipher(keyProvider()),
          new PrismaCredentialVersionRepository(prisma)
        ),
    },
  ],
})
export class CredentialsModule {}

function keyProvider(): KeyEncryptionKeyProvider {
  const provider = process.env['CREDENTIAL_KEK_PROVIDER'] ?? 'local';
  if (provider === 'aws-kms') {
    return new AwsKmsKeyProvider(createAwsKmsClient(required('AWS_REGION')), {
      keyId: required('AWS_KMS_KEY_ID'),
    });
  }
  if (provider === 'local') {
    return new LocalAesKekProvider(
      required('CREDENTIAL_LOCAL_KEK_BASE64'),
      required('CREDENTIAL_LOCAL_KEK_VERSION')
    );
  }
  throw new Error(`Unsupported CREDENTIAL_KEK_PROVIDER: ${provider}`);
}

function validId(value: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new CredentialVaultError('credential_input_invalid', 'Invalid ID');
  return parsed.data;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}

function redactRequestSecret(body: unknown): void {
  if (body !== null && typeof body === 'object' && 'secret' in body) {
    Reflect.set(body, 'secret', '[REDACTED]');
  }
}
