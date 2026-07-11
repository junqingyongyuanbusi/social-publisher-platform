import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialEnvelopeCipher } from './envelope-cipher.js';
import { LocalAesKekProvider } from './local-kek-provider.js';
import {
  OAuthTokenService,
  type AppendOAuthTokenVersion,
  type OAuthTokenVersionMetadata,
  type OAuthTokenVersionRepository,
  type StoredOAuthTokenVersion,
} from './oauth-token-service.js';

class MemoryOAuthTokenRepository implements OAuthTokenVersionRepository {
  readonly records: StoredOAuthTokenVersion[] = [];

  async append(input: AppendOAuthTokenVersion): Promise<OAuthTokenVersionMetadata> {
    for (const record of this.records) {
      if (record.connectionId === input.connectionId && record.status === 'ACTIVE') {
        Object.assign(record, { status: 'SUPERSEDED' as const });
      }
    }
    const versionNo =
      1 +
      Math.max(
        0,
        ...this.records
          .filter((record) => record.connectionId === input.connectionId)
          .map((record) => record.versionNo)
      );
    const record: StoredOAuthTokenVersion = {
      ...input,
      versionNo,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async findActive(
    workspaceId: string,
    connectionId: string
  ): Promise<StoredOAuthTokenVersion | null> {
    return (
      this.records.find(
        (record) =>
          record.workspaceId === workspaceId &&
          record.connectionId === connectionId &&
          record.status === 'ACTIVE'
      ) ?? null
    );
  }

  async revoke(workspaceId: string, connectionId: string): Promise<OAuthTokenVersionMetadata> {
    const record = await this.findActive(workspaceId, connectionId);
    if (!record) throw new Error('not found');
    Object.assign(record, { status: 'REVOKED' as const });
    return record;
  }
}

const base = {
  workspaceId: 'workspace-1',
  platformAppId: 'platform-app-1',
  connectionId: 'connection-1',
  scopes: ['tweet.write', 'users.read', 'tweet.write'],
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  refreshable: true,
  actorId: 'oauth-callback',
  requestId: 'request-1',
};

function fixture() {
  const repository = new MemoryOAuthTokenRepository();
  const cipher = new CredentialEnvelopeCipher(
    new LocalAesKekProvider(randomBytes(32).toString('base64'), 'test-v1')
  );
  return { repository, service: new OAuthTokenService(cipher, repository), cipher };
}

describe('OAuthTokenService', () => {
  it('stores access and refresh material as one zeroized, non-returned version', async () => {
    const { service } = fixture();
    const tokenBundle = Buffer.from(
      '{"access_token":"access-secret","refresh_token":"refresh-secret"}'
    );
    const metadata = await service.put({ ...base, tokenBundle });

    expect(tokenBundle.every((byte) => byte === 0)).toBe(true);
    expect(metadata.scopes).toEqual(['tweet.write', 'users.read']);
    expect(JSON.stringify(metadata)).not.toContain('secret');
    expect(metadata).not.toHaveProperty('envelope');
  });

  it('rotates only within one OAuth connection', async () => {
    const { service, repository } = fixture();
    await service.put({ ...base, tokenBundle: Buffer.from('connection-one-v1') });
    await service.put({
      ...base,
      connectionId: 'connection-2',
      tokenBundle: Buffer.from('connection-two-v1'),
    });
    await service.put({ ...base, tokenBundle: Buffer.from('connection-one-v2') });

    expect(
      repository.records.map(({ connectionId, versionNo, status }) => [
        connectionId,
        versionNo,
        status,
      ])
    ).toEqual([
      ['connection-1', 1, 'SUPERSEDED'],
      ['connection-2', 1, 'ACTIVE'],
      ['connection-1', 2, 'ACTIVE'],
    ]);
  });

  it('binds ciphertext to the OAuth connection identity', async () => {
    const { service, repository, cipher } = fixture();
    await service.put({ ...base, tokenBundle: Buffer.from('bound-token-bundle') });
    const stored = repository.records[0];
    expect(stored).toBeDefined();

    await expect(
      cipher.open(stored!.envelope, {
        credentialId: stored!.id,
        workspaceId: stored!.workspaceId,
        platformAppId: stored!.platformAppId,
        credentialType: 'oauth_token_bundle',
        binding: { type: 'OAUTH_CONNECTION', id: 'attacker-connection' },
      })
    ).rejects.toMatchObject({ code: 'wrapped_data_key_authentication_failed' });
  });

  it('decrypts only inside a callback and zeroizes the callback bytes', async () => {
    const { service } = fixture();
    await service.put({ ...base, tokenBundle: Buffer.from('callback-token-bundle') });
    let captured: Uint8Array | undefined;

    await expect(
      service.withDecryptedTokenBundle(base.workspaceId, base.connectionId, async (tokens) => {
        captured = tokens;
        return Buffer.from(tokens).toString('utf8');
      })
    ).resolves.toBe('callback-token-bundle');
    expect(captured?.every((byte) => byte === 0)).toBe(true);
  });

  it('fails closed when a non-refreshable access token has expired', async () => {
    const { service } = fixture();
    await service.put({
      ...base,
      refreshable: false,
      accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      refreshTokenExpiresAt: null,
      tokenBundle: Buffer.from('expired-token'),
    });

    await expect(
      service.withDecryptedTokenBundle(base.workspaceId, base.connectionId, async () => undefined)
    ).rejects.toMatchObject({ code: 'oauth_access_token_expired' });
  });
});
