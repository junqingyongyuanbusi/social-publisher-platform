import { randomUUID } from 'node:crypto';
import { CredentialVaultError } from './context.js';
import type { CredentialEnvelopeCipher } from './envelope-cipher.js';
import type { CredentialEnvelope } from './types.js';

export type OAuthTokenVersionStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED';

export interface OAuthTokenVersionMetadata {
  readonly id: string;
  readonly connectionId: string;
  readonly versionNo: number;
  readonly status: OAuthTokenVersionStatus;
  readonly scopes: readonly string[];
  readonly accessTokenExpiresAt: string | null;
  readonly refreshTokenExpiresAt: string | null;
  readonly refreshable: boolean;
  readonly createdAt: string;
}

export interface StoredOAuthTokenVersion extends OAuthTokenVersionMetadata {
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly envelope: CredentialEnvelope;
}

export interface AppendOAuthTokenVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly connectionId: string;
  readonly envelope: CredentialEnvelope;
  readonly scopes: readonly string[];
  readonly accessTokenExpiresAt: string | null;
  readonly refreshTokenExpiresAt: string | null;
  readonly refreshable: boolean;
  readonly actorId: string;
  readonly requestId: string;
}

export interface OAuthTokenVersionRepository {
  /** Atomically assigns a version and supersedes only this connection's active version. */
  append(input: AppendOAuthTokenVersion): Promise<OAuthTokenVersionMetadata>;
  findActive(workspaceId: string, connectionId: string): Promise<StoredOAuthTokenVersion | null>;
  revoke(
    workspaceId: string,
    connectionId: string,
    actorId: string,
    requestId: string
  ): Promise<OAuthTokenVersionMetadata>;
}

export interface PutOAuthTokenVersionInput {
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly connectionId: string;
  /**
   * One provider token response encoded as owned bytes. Access and refresh tokens rotate together.
   * Ownership transfers to the service and the bytes are zeroized before return.
   */
  readonly tokenBundle: Uint8Array;
  readonly scopes: readonly string[];
  readonly accessTokenExpiresAt: string | null;
  readonly refreshTokenExpiresAt: string | null;
  readonly refreshable: boolean;
  readonly actorId: string;
  readonly requestId: string;
}

export class OAuthTokenService {
  constructor(
    private readonly cipher: CredentialEnvelopeCipher,
    private readonly repository: OAuthTokenVersionRepository
  ) {}

  async put(input: PutOAuthTokenVersionInput): Promise<OAuthTokenVersionMetadata> {
    try {
      assertIdentifier('workspaceId', input.workspaceId);
      assertIdentifier('platformAppId', input.platformAppId);
      assertIdentifier('connectionId', input.connectionId);
      assertIdentifier('actorId', input.actorId);
      assertIdentifier('requestId', input.requestId);
      assertMetadata(input);

      const id = randomUUID();
      const envelope = await this.cipher.seal(input.tokenBundle, {
        credentialId: id,
        workspaceId: input.workspaceId,
        platformAppId: input.platformAppId,
        credentialType: 'oauth_token_bundle',
        binding: { type: 'OAUTH_CONNECTION', id: input.connectionId },
      });
      return toMetadata(
        await this.repository.append({
          id,
          workspaceId: input.workspaceId,
          platformAppId: input.platformAppId,
          connectionId: input.connectionId,
          envelope,
          scopes: [...new Set(input.scopes)].sort(),
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          refreshable: input.refreshable,
          actorId: input.actorId,
          requestId: input.requestId,
        })
      );
    } finally {
      input.tokenBundle.fill(0);
    }
  }

  async withDecryptedTokenBundle<T>(
    workspaceId: string,
    connectionId: string,
    operation: (tokenBundle: Uint8Array, metadata: OAuthTokenVersionMetadata) => Promise<T>
  ): Promise<T> {
    assertIdentifier('workspaceId', workspaceId);
    assertIdentifier('connectionId', connectionId);
    const stored = await this.repository.findActive(workspaceId, connectionId);
    if (!stored || stored.status !== 'ACTIVE') {
      throw new CredentialVaultError('oauth_token_not_available', 'OAuth grant is unavailable');
    }
    if (isElapsed(stored.refreshTokenExpiresAt)) {
      throw new CredentialVaultError('oauth_refresh_token_expired', 'OAuth grant requires renewal');
    }
    if (!stored.refreshable && isElapsed(stored.accessTokenExpiresAt)) {
      throw new CredentialVaultError('oauth_access_token_expired', 'OAuth grant requires renewal');
    }

    const plaintext = await this.cipher.open(stored.envelope, {
      credentialId: stored.id,
      workspaceId: stored.workspaceId,
      platformAppId: stored.platformAppId,
      credentialType: 'oauth_token_bundle',
      binding: { type: 'OAUTH_CONNECTION', id: stored.connectionId },
    });
    try {
      return await operation(plaintext, toMetadata(stored));
    } finally {
      plaintext.fill(0);
    }
  }

  revoke(
    workspaceId: string,
    connectionId: string,
    actorId: string,
    requestId: string
  ): Promise<OAuthTokenVersionMetadata> {
    assertIdentifier('workspaceId', workspaceId);
    assertIdentifier('connectionId', connectionId);
    assertIdentifier('actorId', actorId);
    assertIdentifier('requestId', requestId);
    return this.repository
      .revoke(workspaceId, connectionId, actorId, requestId)
      .then((metadata) => toMetadata(metadata));
  }
}

function assertMetadata(input: PutOAuthTokenVersionInput): void {
  if (
    input.scopes.length > 100 ||
    input.scopes.some((scope) => scope.length === 0 || scope.length > 200)
  ) {
    throw new CredentialVaultError('oauth_token_input_invalid', 'Invalid OAuth scopes');
  }
  for (const value of [input.accessTokenExpiresAt, input.refreshTokenExpiresAt]) {
    if (value !== null && !Number.isFinite(Date.parse(value))) {
      throw new CredentialVaultError('oauth_token_input_invalid', 'Invalid OAuth expiration');
    }
  }
}

function assertIdentifier(field: string, value: string): void {
  if (value.length === 0 || value.length > 200) {
    throw new CredentialVaultError('oauth_token_input_invalid', `Invalid ${field}`);
  }
}

function isElapsed(value: string | null): boolean {
  return value !== null && Date.parse(value) <= Date.now();
}

function toMetadata(value: OAuthTokenVersionMetadata): OAuthTokenVersionMetadata {
  return {
    id: value.id,
    connectionId: value.connectionId,
    versionNo: value.versionNo,
    status: value.status,
    scopes: [...value.scopes],
    accessTokenExpiresAt: value.accessTokenExpiresAt,
    refreshTokenExpiresAt: value.refreshTokenExpiresAt,
    refreshable: value.refreshable,
    createdAt: value.createdAt,
  };
}
