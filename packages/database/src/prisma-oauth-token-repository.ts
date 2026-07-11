import type {
  AppendOAuthTokenVersion,
  CredentialEnvelope,
  OAuthTokenVersionMetadata,
  OAuthTokenVersionRepository,
  StoredOAuthTokenVersion,
} from '@social/credential-vault';
import type { OAuthTokenVersion, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CredentialPersistenceError } from './prisma-credential-repository.js';

export class PrismaOAuthTokenVersionRepository implements OAuthTokenVersionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendOAuthTokenVersion): Promise<OAuthTokenVersionMetadata> {
    return this.prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, input.connectionId);
      const connection = await transaction.oAuthConnection.findFirst({
        where: {
          id: input.connectionId,
          workspaceId: input.workspaceId,
          platformAppId: input.platformAppId,
        },
        select: { id: true, status: true },
      });
      if (!connection) throw new CredentialPersistenceError('oauth_connection_not_found');

      const latest = await transaction.oAuthTokenVersion.findFirst({
        where: { connectionId: input.connectionId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const versionNo = (latest?.versionNo ?? 0) + 1;
      const now = new Date();
      await transaction.oAuthTokenVersion.updateMany({
        where: { connectionId: input.connectionId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });
      const created = await transaction.oAuthTokenVersion.create({
        data: {
          id: input.id,
          workspaceId: input.workspaceId,
          platformAppId: input.platformAppId,
          connectionId: input.connectionId,
          versionNo,
          status: 'ACTIVE',
          ciphertext: databaseBytes(input.envelope.ciphertext),
          encryptedDek: databaseBytes(input.envelope.encryptedKey),
          envelopeVersion: input.envelope.envelopeVersion,
          cipherSuite: input.envelope.cipherSuite,
          nonce: databaseBytes(input.envelope.nonce),
          authTag: databaseBytes(input.envelope.authTag),
          kekVersion: input.envelope.kekVersion,
          scopes: [...input.scopes],
          refreshable: input.refreshable,
          accessTokenExpiresAt: toDate(input.accessTokenExpiresAt),
          refreshTokenExpiresAt: toDate(input.refreshTokenExpiresAt),
          createdBy: input.actorId,
        },
      });
      await transaction.oAuthConnection.update({
        where: { id: input.connectionId },
        data: { status: 'ACTIVE', grantedScopes: [...input.scopes] },
      });
      await transaction.auditEvent.create({
        data: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action:
            versionNo === 1
              ? 'oauth_connection.authorized'
              : connection.status === 'ACTIVE'
                ? 'oauth_connection.refreshed'
                : 'oauth_connection.reauthorized',
          targetType: 'oauth_token_version',
          targetId: input.id,
          requestId: input.requestId,
          metadata: {
            connectionId: input.connectionId,
            platformAppId: input.platformAppId,
            versionNo,
            scopes: [...input.scopes],
            accessTokenExpiresAt: input.accessTokenExpiresAt ?? 'none',
            refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? 'none',
            refreshable: input.refreshable,
          },
        },
      });
      return toMetadata(created);
    });
  }

  async findActive(
    workspaceId: string,
    connectionId: string
  ): Promise<StoredOAuthTokenVersion | null> {
    const record = await this.prisma.oAuthTokenVersion.findFirst({
      where: {
        connectionId,
        status: 'ACTIVE',
        connection: { workspaceId, status: { not: 'REVOKED' } },
      },
    });
    return record ? toStored(record) : null;
  }

  async revoke(
    workspaceId: string,
    connectionId: string,
    actorId: string,
    requestId: string
  ): Promise<OAuthTokenVersionMetadata> {
    return this.prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, connectionId);
      const active = await transaction.oAuthTokenVersion.findFirst({
        where: { connectionId, status: 'ACTIVE', connection: { workspaceId } },
      });
      if (!active) throw new CredentialPersistenceError('oauth_token_not_found');
      const now = new Date();
      const revoked = await transaction.oAuthTokenVersion.update({
        where: { id: active.id },
        data: { status: 'REVOKED', revokedAt: now, revokedBy: actorId },
      });
      await transaction.oAuthConnection.update({
        where: { id: connectionId },
        data: { status: 'REVOKED' },
      });
      await transaction.auditEvent.create({
        data: {
          workspaceId,
          actorId,
          action: 'oauth_connection.revoked',
          targetType: 'oauth_token_version',
          targetId: active.id,
          requestId,
          metadata: {
            connectionId,
            platformAppId: active.platformAppId,
            versionNo: active.versionNo,
          },
        },
      });
      return toMetadata(revoked);
    });
  }
}

async function lockConnection(
  transaction: Prisma.TransactionClient,
  connectionId: string
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`oauth-token\u0000${connectionId}`}, 0))`
  );
}

function toStored(record: OAuthTokenVersion): StoredOAuthTokenVersion {
  return {
    ...toMetadata(record),
    workspaceId: record.workspaceId,
    platformAppId: record.platformAppId,
    envelope: toEnvelope(record),
  };
}

function toMetadata(record: OAuthTokenVersion): OAuthTokenVersionMetadata {
  return {
    id: record.id,
    connectionId: record.connectionId,
    versionNo: record.versionNo,
    status: record.status,
    scopes: [...record.scopes],
    accessTokenExpiresAt: record.accessTokenExpiresAt?.toISOString() ?? null,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt?.toISOString() ?? null,
    refreshable: record.refreshable,
    createdAt: record.createdAt.toISOString(),
  };
}

function toEnvelope(record: OAuthTokenVersion): CredentialEnvelope {
  if (record.envelopeVersion !== 1 || record.cipherSuite !== 'AES-256-GCM') {
    throw new CredentialPersistenceError('credential_envelope_unsupported');
  }
  return {
    envelopeVersion: 1,
    cipherSuite: 'AES-256-GCM',
    ciphertext: record.ciphertext,
    encryptedKey: record.encryptedDek,
    nonce: record.nonce,
    authTag: record.authTag,
    kekVersion: record.kekVersion,
  };
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
