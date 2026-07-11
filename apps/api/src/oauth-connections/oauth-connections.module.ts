import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CredentialEnvelopeCipher,
  CredentialService,
  LocalAesKekProvider,
  OAuthTokenService,
  type KeyEncryptionKeyProvider,
} from '@social/credential-vault';
import { AwsKmsKeyProvider, createAwsKmsClient } from '@social/credential-vault-aws';
import {
  PrismaCredentialVersionRepository,
  PrismaOAuthTokenVersionRepository,
} from '@social/database';
import { XOAuthClient } from '@social/platform-x';
import Redis from 'ioredis';
import { z } from 'zod';
import { RequirePermission } from '../auth/auth.decorators.js';
import { getPrincipal, type AuthenticatedRequest } from '../auth/authenticated-request.js';
import { API_CONFIG, type ApiConfig } from '../config/api-config.module.js';
import { PrismaService } from '../database/database.module.js';

const TX_STORE = Symbol('PLATFORM_OAUTH_TX_STORE');
const OAUTH_SERVICE = Symbol('PLATFORM_OAUTH_SERVICE');
const id = z.string().uuid();
const callback = z.object({
  code: z.string().min(1).max(2_048),
  state: z.string().min(32).max(500),
});

interface OAuthTransaction {
  workspaceId: string;
  platformAppId: string;
  actorId: string;
  verifier: string;
  returnTo: string;
}

@Injectable()
class OAuthTransactionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttl: number
  ) {}
  async create(value: OAuthTransaction): Promise<{ state: string; challenge: string }> {
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(64));
    await this.redis.set(
      this.key(state),
      JSON.stringify({ ...value, verifier }),
      'EX',
      this.ttl,
      'NX'
    );
    return { state, challenge: base64url(createHash('sha256').update(verifier).digest()) };
  }
  async take(state: string): Promise<OAuthTransaction | null> {
    const raw = await this.redis.call('GETDEL', this.key(state));
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as OAuthTransaction;
    } catch {
      return null;
    }
  }
  private key(state: string): string {
    return `social:platform-oauth:v1:${createHash('sha256').update(state).digest('hex')}`;
  }
}

@Injectable()
class OAuthConnectionsService {
  private readonly credentials: CredentialService;
  private readonly tokens: OAuthTokenService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: OAuthTransactionStore
  ) {
    const cipher = new CredentialEnvelopeCipher(keyProvider());
    this.credentials = new CredentialService(cipher, new PrismaCredentialVersionRepository(prisma));
    this.tokens = new OAuthTokenService(cipher, new PrismaOAuthTokenVersionRepository(prisma));
  }

  list(workspaceId: string) {
    return this.prisma.socialAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        platform: true,
        displayName: true,
        username: true,
        status: true,
        oauthConnection: {
          select: { id: true, status: true, grantedScopes: true, updatedAt: true },
        },
        platformApp: { select: { id: true, name: true } },
      },
      orderBy: [{ platform: 'asc' }, { displayName: 'asc' }],
    });
  }

  async connect(workspaceId: string, platformAppId: string, actorId: string, returnTo: string) {
    const app = await this.app(workspaceId, platformAppId);
    if (app.platform !== 'X') throw new Error('platform_oauth_not_implemented');
    const tx = await this.transactions.create({
      workspaceId,
      platformAppId,
      actorId,
      verifier: '',
      returnTo: safeReturnTo(returnTo),
    });
    const client = new XOAuthClient({ clientId: app.publicClientId, redirectUri: app.redirectUri });
    return {
      authorizationUrl: client.authorizationUrl({
        state: tx.state,
        codeChallenge: tx.challenge,
        scopes: requiredXScopes(app.scopes),
      }),
      expiresIn: 600,
    };
  }

  async complete(input: unknown, actorId: string, requestId: string) {
    const parsed = callback.parse(input);
    const tx = await this.transactions.take(parsed.state);
    if (!tx || tx.actorId !== actorId) throw new Error('oauth_transaction_invalid');
    const app = await this.app(tx.workspaceId, tx.platformAppId);
    const result = await this.withClient(app, (client) =>
      client.exchangeCode(parsed.code, tx.verifier)
    );
    const user = await new XOAuthClient({
      clientId: app.publicClientId,
      redirectUri: app.redirectUri,
    }).currentUser(result.accessToken);
    const connection = await this.prisma.$transaction(async (database) => {
      const account = await database.socialAccount.upsert({
        where: {
          workspaceId_platform_remoteId: {
            workspaceId: tx.workspaceId,
            platform: 'X',
            remoteId: user.id,
          },
        },
        create: {
          workspaceId: tx.workspaceId,
          platformAppId: app.id,
          platform: 'X',
          remoteId: user.id,
          displayName: user.name,
          username: user.username,
          status: 'ACTIVE',
          capabilities: { text: true, image: true, video: true },
        },
        update: {
          platformAppId: app.id,
          displayName: user.name,
          username: user.username,
          status: 'ACTIVE',
        },
      });
      return database.oAuthConnection.upsert({
        where: {
          workspaceId_socialAccountId_platformAppId: {
            workspaceId: tx.workspaceId,
            socialAccountId: account.id,
            platformAppId: app.id,
          },
        },
        create: {
          workspaceId: tx.workspaceId,
          platformAppId: app.id,
          socialAccountId: account.id,
          providerSubject: user.id,
          status: 'ERROR',
          grantedScopes: [...result.scopes],
        },
        update: { providerSubject: user.id, status: 'ERROR', grantedScopes: [...result.scopes] },
      });
    });
    const bundle = Buffer.from(
      JSON.stringify({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? null,
        tokenType: result.tokenType,
      }),
      'utf8'
    );
    await this.tokens.put({
      workspaceId: tx.workspaceId,
      platformAppId: app.id,
      connectionId: connection.id,
      tokenBundle: bundle,
      scopes: result.scopes,
      accessTokenExpiresAt: new Date(Date.now() + result.expiresIn * 1000).toISOString(),
      refreshTokenExpiresAt: null,
      refreshable: Boolean(result.refreshToken),
      actorId,
      requestId,
    });
    return {
      returnTo: tx.returnTo,
      account: {
        id: connection.socialAccountId,
        platform: 'X',
        displayName: user.name,
        username: user.username,
        status: 'ACTIVE',
      },
    };
  }

  async disconnect(workspaceId: string, connectionId: string, actorId: string, requestId: string) {
    const connection = await this.prisma.oAuthConnection.findFirst({
      where: { id: connectionId, workspaceId },
      select: { id: true, socialAccountId: true, platformApp: true },
    });
    if (!connection) throw new Error('oauth_connection_not_found');
    await this.tokens.withDecryptedTokenBundle(workspaceId, connectionId, async (bytes) => {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as { accessToken?: unknown };
      if (typeof parsed.accessToken !== 'string') throw new Error('oauth_token_bundle_invalid');
      await this.withClient(connection.platformApp, (client) =>
        client.revoke(parsed.accessToken as string)
      );
    });
    await this.tokens.revoke(workspaceId, connectionId, actorId, requestId);
    await this.prisma.socialAccount.update({
      where: { id: connection.socialAccountId },
      data: { status: 'DISCONNECTED' },
    });
    return { id: connectionId, status: 'REVOKED' };
  }

  private async app(workspaceId: string, platformAppId: string) {
    const app = await this.prisma.platformApp.findFirst({
      where: { id: platformAppId, workspaceId, status: 'ACTIVE' },
    });
    if (!app) throw new Error('platform_app_not_found');
    return app;
  }
  private async withClient<T>(
    app: Awaited<ReturnType<OAuthConnectionsService['app']>>,
    operation: (client: XOAuthClient) => Promise<T>
  ): Promise<T> {
    const active = (await this.credentials.list(app.workspaceId, app.id)).find(
      (item) => item.credentialType === 'app_secret' && item.status === 'ACTIVE'
    );
    if (!active)
      return operation(
        new XOAuthClient({ clientId: app.publicClientId, redirectUri: app.redirectUri })
      );
    return this.credentials.withDecryptedCredential(app.workspaceId, active.id, async (bytes) =>
      operation(
        new XOAuthClient({
          clientId: app.publicClientId,
          clientSecret: Buffer.from(bytes).toString('utf8'),
          redirectUri: app.redirectUri,
        })
      )
    );
  }
}

@ApiTags('social-accounts')
@ApiBearerAuth()
@RequirePermission('credential.manage')
@Controller('workspaces/:workspaceId')
class OAuthConnectionsController {
  constructor(@Inject(OAUTH_SERVICE) private readonly service: OAuthConnectionsService) {}
  @Get('social-accounts') list(@Param('workspaceId') workspaceId: string) {
    return this.service.list(valid(workspaceId));
  }
  @Post('platform-apps/:platformAppId/oauth/connect') connect(
    @Param('workspaceId') workspaceId: string,
    @Param('platformAppId') appId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const returnTo =
      z.object({ returnTo: z.string().optional() }).parse(body).returnTo ?? '/zh-CN/accounts';
    return this.service.connect(
      valid(workspaceId),
      valid(appId),
      getPrincipal(req).subject,
      returnTo
    );
  }
  @Delete('oauth-connections/:connectionId') disconnect(
    @Param('workspaceId') workspaceId: string,
    @Param('connectionId') connectionId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.disconnect(
      valid(workspaceId),
      valid(connectionId),
      getPrincipal(req).subject,
      req.header('x-request-id') ?? randomUUID()
    );
  }
}

@ApiTags('social-accounts')
@ApiBearerAuth()
@RequirePermission('credential.manage')
@Controller('platform-oauth')
class PlatformOAuthCallbackController {
  constructor(@Inject(OAUTH_SERVICE) private readonly service: OAuthConnectionsService) {}
  @Post('callback') complete(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.complete(
      body,
      getPrincipal(req).subject,
      req.header('x-request-id') ?? randomUUID()
    );
  }
}

@Module({
  controllers: [OAuthConnectionsController, PlatformOAuthCallbackController],
  providers: [
    {
      provide: TX_STORE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new OAuthTransactionStore(
          new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 }),
          config.platformOAuth.transactionTtlSeconds
        ),
    },
    {
      provide: OAUTH_SERVICE,
      inject: [PrismaService, TX_STORE],
      useFactory: (prisma: PrismaService, store: OAuthTransactionStore) =>
        new OAuthConnectionsService(prisma, store),
    },
  ],
})
export class OAuthConnectionsModule {}

function valid(value: string): string {
  return id.parse(value);
}
function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}
function safeReturnTo(value: string): string {
  return /^\/(?:zh-CN|en-US)\/accounts(?:\?.*)?$/.test(value) ? value : '/zh-CN/accounts';
}
function requiredXScopes(scopes: readonly string[]): readonly string[] {
  return [...new Set([...scopes, 'tweet.read', 'tweet.write', 'users.read', 'offline.access'])];
}
function keyProvider(): KeyEncryptionKeyProvider {
  if ((process.env['CREDENTIAL_KEK_PROVIDER'] ?? 'local') === 'aws-kms')
    return new AwsKmsKeyProvider(createAwsKmsClient(required('AWS_REGION')), {
      keyId: required('AWS_KMS_KEY_ID'),
    });
  return new LocalAesKekProvider(
    required('CREDENTIAL_LOCAL_KEK_BASE64'),
    required('CREDENTIAL_LOCAL_KEK_VERSION')
  );
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing`);
  return value;
}
