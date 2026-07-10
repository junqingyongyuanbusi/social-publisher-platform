import type { CredentialContext } from './types.js';

const CONTEXT_DOMAIN = 'social-publisher/credential/v1';

export function credentialAad(context: CredentialContext): Uint8Array {
  assertContext(context);
  return Buffer.from(
    JSON.stringify([
      CONTEXT_DOMAIN,
      context.credentialId,
      context.workspaceId,
      context.platformAppId,
      context.credentialType,
    ]),
    'utf8'
  );
}

export function assertContext(context: CredentialContext): void {
  for (const [field, value] of Object.entries({
    credentialId: context.credentialId,
    workspaceId: context.workspaceId,
    platformAppId: context.platformAppId,
    credentialType: context.credentialType,
  })) {
    if (value.length === 0 || value.length > 200) {
      throw new CredentialVaultError('credential_context_invalid', `Invalid ${field}`);
    }
  }
}

export class CredentialVaultError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CredentialVaultError';
  }
}
