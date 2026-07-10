import { randomUUID } from 'node:crypto';
import { CredentialVaultError } from './context.js';
import type { CredentialEnvelopeCipher } from './envelope-cipher.js';
import { maskCredential } from './redaction.js';
import type {
  CredentialContext,
  CredentialMetadata,
  CredentialVersionRepository,
} from './types.js';

export interface PutCredentialInput {
  readonly workspaceId: string;
  readonly platformAppId: string;
  readonly credentialType: string;
  /** Ownership transfers to the service; the buffer is zeroized before return. */
  readonly secret: Uint8Array;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
  readonly actorId: string;
  readonly requestId: string;
}

export class CredentialService {
  constructor(
    private readonly cipher: CredentialEnvelopeCipher,
    private readonly repository: CredentialVersionRepository
  ) {}

  async put(input: PutCredentialInput): Promise<CredentialMetadata> {
    try {
      assertIdentifier('actorId', input.actorId);
      assertIdentifier('requestId', input.requestId);
      assertCredentialMetadata(input);
      const credentialId = randomUUID();
      const context: CredentialContext = {
        credentialId,
        workspaceId: input.workspaceId,
        platformAppId: input.platformAppId,
        credentialType: input.credentialType,
      };
      const maskedValue = maskSecret(input.secret);
      const envelope = await this.cipher.seal(input.secret, context);
      const stored = await this.repository.append({
        id: credentialId,
        workspaceId: input.workspaceId,
        platformAppId: input.platformAppId,
        credentialType: input.credentialType,
        envelope,
        maskedValue,
        scopes: [...new Set(input.scopes)].sort(),
        expiresAt: input.expiresAt,
        actorId: input.actorId,
        requestId: input.requestId,
      });
      return toMetadata(stored);
    } finally {
      input.secret.fill(0);
    }
  }

  async list(workspaceId: string, platformAppId: string): Promise<readonly CredentialMetadata[]> {
    return (await this.repository.list(workspaceId, platformAppId)).map(toMetadata);
  }

  revoke(
    workspaceId: string,
    platformAppId: string,
    credentialId: string,
    actorId: string,
    requestId: string
  ): Promise<CredentialMetadata> {
    assertIdentifier('actorId', actorId);
    assertIdentifier('requestId', requestId);
    return this.repository
      .revoke(workspaceId, platformAppId, credentialId, actorId, requestId)
      .then((metadata) => toMetadata(metadata));
  }

  async withDecryptedCredential<T>(
    workspaceId: string,
    credentialId: string,
    operation: (secret: Uint8Array) => Promise<T>
  ): Promise<T> {
    const stored = await this.repository.findById(workspaceId, credentialId);
    if (!stored || stored.status !== 'ACTIVE') {
      throw new CredentialVaultError(
        'credential_not_available',
        'Credential is missing or inactive'
      );
    }
    if (stored.expiresAt !== null && Date.parse(stored.expiresAt) <= Date.now()) {
      throw new CredentialVaultError('credential_expired', 'Credential has expired');
    }

    const plaintext = await this.cipher.open(stored.envelope, {
      credentialId: stored.id,
      workspaceId: stored.workspaceId,
      platformAppId: stored.platformAppId,
      credentialType: stored.credentialType,
    });
    try {
      return await operation(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }
}

function maskSecret(secret: Uint8Array): string {
  const copy = Buffer.from(secret);
  try {
    return maskCredential(copy.toString('utf8'));
  } finally {
    copy.fill(0);
  }
}

function assertCredentialMetadata(input: PutCredentialInput): void {
  if (
    input.scopes.length > 100 ||
    input.scopes.some((scope) => scope.length === 0 || scope.length > 200)
  ) {
    throw new CredentialVaultError('credential_input_invalid', 'Invalid scopes');
  }
  if (input.expiresAt !== null && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new CredentialVaultError('credential_input_invalid', 'Invalid expiresAt');
  }
}

function toMetadata(value: CredentialMetadata): CredentialMetadata {
  return {
    id: value.id,
    platformAppId: value.platformAppId,
    credentialType: value.credentialType,
    versionNo: value.versionNo,
    status: value.status,
    maskedValue: value.maskedValue,
    scopes: [...value.scopes],
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
  };
}

function assertIdentifier(field: string, value: string): void {
  if (value.length === 0 || value.length > 200) {
    throw new CredentialVaultError('credential_input_invalid', `Invalid ${field}`);
  }
}
