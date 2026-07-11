import type { CredentialContext } from './types.js';

const CONTEXT_DOMAIN_V1 = 'social-publisher/credential/v1';
const CONTEXT_DOMAIN_V2 = 'social-publisher/credential/v2';

export function credentialAad(context: CredentialContext): Uint8Array {
  assertContext(context);
  const values = context.binding
    ? [
        CONTEXT_DOMAIN_V2,
        context.credentialId,
        context.workspaceId,
        context.platformAppId,
        context.credentialType,
        context.binding.type,
        context.binding.id,
      ]
    : [
        CONTEXT_DOMAIN_V1,
        context.credentialId,
        context.workspaceId,
        context.platformAppId,
        context.credentialType,
      ];
  return Buffer.from(JSON.stringify(values), 'utf8');
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
  if (context.binding) {
    if (context.binding.type !== 'OAUTH_CONNECTION') {
      throw new CredentialVaultError('credential_context_invalid', 'Invalid binding type');
    }
    if (context.binding.id.length === 0 || context.binding.id.length > 200) {
      throw new CredentialVaultError('credential_context_invalid', 'Invalid binding ID');
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
