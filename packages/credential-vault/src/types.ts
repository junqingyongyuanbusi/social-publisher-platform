export const CREDENTIAL_CIPHER_SUITE = 'AES-256-GCM' as const;
export const CREDENTIAL_ENVELOPE_VERSION = 1 as const;

export interface CredentialContext {
  readonly credentialId: string;
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly credentialType: string;
}

export interface WrappedDataKey {
  readonly encryptedKey: Uint8Array;
  readonly kekVersion: string;
}

export interface GeneratedDataKey extends WrappedDataKey {
  readonly plaintextKey: Uint8Array;
}

export interface KeyEncryptionKeyProvider {
  generateDataKey(context: CredentialContext): Promise<GeneratedDataKey>;
  decryptDataKey(wrapped: WrappedDataKey, context: CredentialContext): Promise<Uint8Array>;
}

export interface CredentialEnvelope extends WrappedDataKey {
  readonly envelopeVersion: typeof CREDENTIAL_ENVELOPE_VERSION;
  readonly cipherSuite: typeof CREDENTIAL_CIPHER_SUITE;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
}

export interface CredentialMetadata {
  readonly id: string;
  readonly platformAppId: string;
  readonly credentialType: string;
  readonly versionNo: number;
  readonly status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED';
  readonly maskedValue: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface StoredCredential extends CredentialMetadata {
  readonly workspaceId: string;
  readonly envelope: CredentialEnvelope;
}

export interface AppendCredentialVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly credentialType: string;
  readonly envelope: CredentialEnvelope;
  readonly maskedValue: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
  readonly actorId: string;
  readonly requestId: string;
}

export interface CredentialVersionRepository {
  /** Atomically assigns versionNo and supersedes the previously active version. */
  append(input: AppendCredentialVersion): Promise<CredentialMetadata>;
  findById(workspaceId: string, credentialId: string): Promise<StoredCredential | null>;
  list(workspaceId: string, platformAppId: string): Promise<readonly CredentialMetadata[]>;
  revoke(
    workspaceId: string,
    credentialId: string,
    actorId: string,
    requestId: string
  ): Promise<CredentialMetadata>;
}
