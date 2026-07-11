import { Controller, Get, HttpStatus, Inject, Injectable, Module, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators.js';
import { API_CONFIG, type ApiConfig } from '../config/api-config.module.js';
import { PrismaService } from '../database/database.module.js';
import { checkAwsKmsKey, createAwsKmsClient } from '@social/credential-vault-aws';
import Redis from 'ioredis';

export type ReadinessCheckCode = 'configured' | 'ready' | 'timeout' | 'unavailable';
const CREDENTIAL_KEK_PROBE = Symbol('CREDENTIAL_KEK_PROBE');
const REDIS_PROBE = Symbol('REDIS_PROBE');

export interface CredentialKekProbe {
  check(): Promise<void>;
}
export interface DependencyProbe {
  check(): Promise<void>;
  onModuleDestroy?(): Promise<void>;
}

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly code: 'service_ready' | 'service_not_ready';
  readonly checks: {
    readonly postgres: ReadinessCheckCode;
    readonly redis: ReadinessCheckCode;
    readonly oidc: 'configured';
    readonly credentialKek: ReadinessCheckCode;
  };
}

class ReadinessTimeoutError extends Error {}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(CREDENTIAL_KEK_PROBE) private readonly credentialKek: CredentialKekProbe,
    @Inject(REDIS_PROBE) private readonly redis: DependencyProbe
  ) {}

  async check(): Promise<ReadinessResult> {
    const [postgres, redis, credentialKek] = await Promise.all([
      probe(
        this.prisma.$queryRaw<readonly [{ '?column?': number }]>`SELECT 1`,
        this.config.readinessTimeoutMs
      ),
      probe(this.redis.check(), this.config.readinessTimeoutMs),
      probe(this.credentialKek.check(), this.config.readinessTimeoutMs),
    ]);

    const ready = postgres === 'ready' && redis === 'ready' && credentialKek === 'ready';
    return {
      status: ready ? 'ready' : 'not_ready',
      code: ready ? 'service_ready' : 'service_not_ready',
      checks: {
        postgres,
        redis,
        // OIDC URLs and algorithms are validated synchronously before Nest starts. JWKS retrieval
        // remains demand-driven and bounded by the verifier's own timeout/cache.
        oidc: 'configured',
        credentialKek,
      },
    };
  }
}

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  live(): { status: 'ok'; service: string; timestamp: string } {
    return { status: 'ok', service: 'social-publisher-api', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResult> {
    const result = await this.readiness.check();
    if (result.status === 'not_ready') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}

@Module({
  controllers: [HealthController],
  providers: [
    ReadinessService,
    {
      provide: CREDENTIAL_KEK_PROBE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): CredentialKekProbe => createCredentialKekProbe(config),
    },
    {
      provide: REDIS_PROBE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): DependencyProbe => {
        const client = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
        return {
          check: async () => {
            if (client.status === 'wait') await client.connect();
            await client.ping();
          },
          onModuleDestroy: async () => {
            if (client.status !== 'end') await client.quit();
          },
        };
      },
    },
  ],
})
export class HealthModule {}

function createCredentialKekProbe(config: ApiConfig): CredentialKekProbe {
  const credentialKek = config.credentialKek;
  if (credentialKek.provider === 'local') {
    return { check: async () => undefined };
  }
  const client = createAwsKmsClient(credentialKek.region);
  return {
    check: () => checkAwsKmsKey(client, credentialKek.keyId),
  };
}

async function probe(operation: Promise<unknown>, timeoutMs: number): Promise<ReadinessCheckCode> {
  try {
    await withTimeout(operation, timeoutMs);
    return 'ready';
  } catch (error) {
    return error instanceof ReadinessTimeoutError ? 'timeout' : 'unavailable';
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ReadinessTimeoutError()), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
