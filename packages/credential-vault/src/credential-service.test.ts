import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CredentialService } from './credential-service.js';
import { CredentialEnvelopeCipher } from './envelope-cipher.js';
import { LocalAesKekProvider } from './local-kek-provider.js';
import type {
  AppendCredentialVersion,
  CredentialMetadata,
  CredentialVersionRepository,
  StoredCredential,
} from './types.js';

class MemoryRepository implements CredentialVersionRepository {
  readonly records: StoredCredential[] = [];

  async append(input: AppendCredentialVersion): Promise<CredentialMetadata> {
    for (const record of this.records) {
      if (
        record.platformAppId === input.platformAppId &&
        record.credentialType === input.credentialType &&
        record.status === 'ACTIVE'
      ) {
        Object.assign(record, { status: 'SUPERSEDED' as const });
      }
    }
    const versionNo =
      1 +
      Math.max(
        0,
        ...this.records
          .filter(
            (record) =>
              record.platformAppId === input.platformAppId &&
              record.credentialType === input.credentialType
          )
          .map((record) => record.versionNo)
      );
    const record: StoredCredential = {
      ...input,
      versionNo,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async findById(workspaceId: string, credentialId: string): Promise<StoredCredential | null> {
    return (
      this.records.find(
        (record) => record.workspaceId === workspaceId && record.id === credentialId
      ) ?? null
    );
  }

  async list(workspaceId: string, platformAppId: string): Promise<readonly CredentialMetadata[]> {
    return this.records.filter(
      (record) => record.workspaceId === workspaceId && record.platformAppId === platformAppId
    );
  }

  async revoke(
    workspaceId: string,
    platformAppId: string,
    credentialId: string,
    _actorId: string,
    _requestId: string
  ): Promise<CredentialMetadata> {
    const record = this.records.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.platformAppId === platformAppId &&
        item.id === credentialId
    );
    if (!record) throw new Error('not found');
    Object.assign(record, { status: 'REVOKED' as const });
    return record;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const cipher = new CredentialEnvelopeCipher(
    new LocalAesKekProvider(randomBytes(32).toString('base64'), 'test-v1')
  );
  return { repository, service: new CredentialService(cipher, repository) };
}

const base = {
  workspaceId: 'workspace-1',
  platformAppId: 'x-app-1',
  credentialType: 'app_secret',
  scopes: ['tweet.write', 'users.read', 'tweet.write'],
  expiresAt: null,
  actorId: 'admin-1',
  requestId: 'request-1',
};

describe('CredentialService', () => {
  it('zeroizes input and returns only masked metadata', async () => {
    const { service, repository } = fixture();
    const secret = Buffer.from('refresh-token-1234');
    const metadata = await service.put({ ...base, secret });

    expect(secret.every((byte) => byte === 0)).toBe(true);
    expect(metadata.maskedValue).toBe('••••1234');
    expect(metadata.scopes).toEqual(['tweet.write', 'users.read']);
    expect(JSON.stringify(metadata)).not.toContain('refresh-token-1234');
    expect(metadata).not.toHaveProperty('envelope');
    expect(repository.records[0]?.envelope.ciphertext).toBeDefined();
  });

  it('supersedes the previous active version without mutating history', async () => {
    const { service, repository } = fixture();
    const first = await service.put({ ...base, secret: Buffer.from('first-token') });
    const second = await service.put({ ...base, secret: Buffer.from('second-token') });

    expect(first.versionNo).toBe(1);
    expect(second.versionNo).toBe(2);
    expect(repository.records.map(({ status }) => status)).toEqual(['SUPERSEDED', 'ACTIVE']);
  });

  it('decrypts only inside a callback and zeroizes afterward', async () => {
    const { service } = fixture();
    const metadata = await service.put({ ...base, secret: Buffer.from('callback-only-secret') });
    let captured: Uint8Array | undefined;
    const operation = vi.fn(async (secret: Uint8Array) => {
      captured = secret;
      return Buffer.from(secret).toString('utf8').length;
    });

    await expect(
      service.withDecryptedCredential(base.workspaceId, metadata.id, operation)
    ).resolves.toBe(20);
    expect(captured?.every((byte) => byte === 0)).toBe(true);
  });

  it('does not decrypt revoked credentials', async () => {
    const { service } = fixture();
    const metadata = await service.put({ ...base, secret: Buffer.from('revoked-token') });
    await service.revoke(
      base.workspaceId,
      base.platformAppId,
      metadata.id,
      base.actorId,
      base.requestId
    );

    await expect(
      service.withDecryptedCredential(base.workspaceId, metadata.id, async () => undefined)
    ).rejects.toMatchObject({ code: 'credential_not_available' });
  });

  it('does not revoke a credential through a different platform application', async () => {
    const { service } = fixture();
    const metadata = await service.put({ ...base, secret: Buffer.from('scoped-token') });

    await expect(
      service.revoke(
        base.workspaceId,
        'another-platform-app',
        metadata.id,
        base.actorId,
        base.requestId
      )
    ).rejects.toThrow('not found');
  });

  it('zeroizes input even when metadata validation fails', async () => {
    const { service } = fixture();
    const secret = Buffer.from('must-be-erased');
    await expect(service.put({ ...base, requestId: '', secret })).rejects.toMatchObject({
      code: 'credential_input_invalid',
    });
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });
});
