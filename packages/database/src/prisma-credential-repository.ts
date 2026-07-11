import type {
  AppendCredentialVersion,
  CredentialEnvelope,
  CredentialMetadata,
  CredentialVersionRepository,
  StoredCredential,
} from '@social/credential-vault';
import type { CredentialStatus, CredentialVersion, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

export class PrismaCredentialVersionRepository implements CredentialVersionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendCredentialVersion): Promise<CredentialMetadata> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCredentialStream(transaction, input.platformAppId, input.credentialType);
      const platformApp = await transaction.platformApp.findFirst({
        where: { id: input.platformAppId, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!platformApp) throw new CredentialPersistenceError('platform_app_not_found');

      const latest = await transaction.credentialVersion.findFirst({
        where: { platformAppId: input.platformAppId, credentialType: input.credentialType },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const versionNo = (latest?.versionNo ?? 0) + 1;
      const now = new Date();

      await transaction.credentialVersion.updateMany({
        where: {
          platformAppId: input.platformAppId,
          credentialType: input.credentialType,
          status: 'ACTIVE',
        },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });

      const created = await transaction.credentialVersion.create({
        data: {
          id: input.id,
          platformAppId: input.platformAppId,
          credentialType: input.credentialType,
          versionNo,
          ciphertext: databaseBytes(input.envelope.ciphertext),
          encryptedDek: databaseBytes(input.envelope.encryptedKey),
          envelopeVersion: input.envelope.envelopeVersion,
          cipherSuite: input.envelope.cipherSuite,
          nonce: databaseBytes(input.envelope.nonce),
          authTag: databaseBytes(input.envelope.authTag),
          kekVersion: input.envelope.kekVersion,
          maskedValue: input.maskedValue,
          scopes: [...input.scopes],
          expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
          status: 'ACTIVE',
          createdBy: input.actorId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: versionNo === 1 ? 'credential.created' : 'credential.rotated',
          targetType: 'credential_version',
          targetId: input.id,
          requestId: input.requestId,
          metadata: {
            platformAppId: input.platformAppId,
            credentialType: input.credentialType,
            versionNo,
            scopes: [...input.scopes],
            expiresAt: input.expiresAt ?? 'none',
          },
        },
      });
      return toMetadata(created);
    });
  }

  async findById(workspaceId: string, credentialId: string): Promise<StoredCredential | null> {
    const record = await this.prisma.credentialVersion.findFirst({
      where: { id: credentialId, platformApp: { workspaceId } },
      include: { platformApp: { select: { workspaceId: true } } },
    });
    if (!record) return null;
    return {
      ...toMetadata(record),
      workspaceId: record.platformApp.workspaceId,
      envelope: toEnvelope(record),
    };
  }

  async list(workspaceId: string, platformAppId: string): Promise<readonly CredentialMetadata[]> {
    const records = await this.prisma.credentialVersion.findMany({
      where: { platformAppId, platformApp: { workspaceId } },
      orderBy: [{ credentialType: 'asc' }, { versionNo: 'desc' }],
    });
    return records.map(toMetadata);
  }

  async revoke(
    workspaceId: string,
    platformAppId: string,
    credentialId: string,
    actorId: string,
    requestId: string
  ): Promise<CredentialMetadata> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.credentialVersion.findFirst({
        where: { id: credentialId, platformAppId, platformApp: { workspaceId } },
      });
      if (!existing) throw new CredentialPersistenceError('credential_not_found');
      const revoked = await transaction.credentialVersion.update({
        where: { id: existing.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: actorId },
      });
      await transaction.auditEvent.create({
        data: {
          workspaceId,
          actorId,
          action: 'credential.revoked',
          targetType: 'credential_version',
          targetId: existing.id,
          requestId,
          metadata: {
            platformAppId: existing.platformAppId,
            credentialType: existing.credentialType,
            versionNo: existing.versionNo,
          },
        },
      });
      return toMetadata(revoked);
    });
  }
}

async function lockCredentialStream(
  transaction: Prisma.TransactionClient,
  platformAppId: string,
  credentialType: string
): Promise<void> {
  const stream = `${platformAppId}\u0000${credentialType}`;
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${stream}, 0))`
  );
}

function toMetadata(record: CredentialVersion): CredentialMetadata {
  return {
    id: record.id,
    platformAppId: record.platformAppId,
    credentialType: record.credentialType,
    versionNo: record.versionNo,
    status: mapStatus(record.status),
    maskedValue: record.maskedValue ?? '[REDACTED]',
    scopes: record.scopes,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function toEnvelope(record: CredentialVersion): CredentialEnvelope {
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

function mapStatus(status: CredentialStatus): CredentialMetadata['status'] {
  return status;
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

export class CredentialPersistenceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CredentialPersistenceError';
  }
}
