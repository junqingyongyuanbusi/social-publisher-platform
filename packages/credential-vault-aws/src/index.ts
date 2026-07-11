import {
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from '@aws-sdk/client-kms';
import {
  CredentialVaultError,
  type CredentialContext,
  type GeneratedDataKey,
  type KeyEncryptionKeyProvider,
  type WrappedDataKey,
} from '@social/credential-vault';

export interface AwsKmsKeyProviderConfig {
  readonly keyId: string;
}

export class AwsKmsKeyProvider implements KeyEncryptionKeyProvider {
  constructor(
    private readonly client: KMSClient,
    private readonly config: AwsKmsKeyProviderConfig
  ) {
    if (config.keyId.length === 0 || config.keyId.length > 2_048) {
      throw new CredentialVaultError('aws_kms_configuration_invalid', 'AWS KMS key ID is invalid');
    }
  }

  async generateDataKey(context: CredentialContext): Promise<GeneratedDataKey> {
    try {
      const response = await this.client.send(
        new GenerateDataKeyCommand({
          KeyId: this.config.keyId,
          KeySpec: 'AES_256',
          EncryptionContext: encryptionContext(context),
        })
      );
      const plaintextKey = response.Plaintext;
      const encryptedKey = response.CiphertextBlob;
      const kekVersion = response.KeyId;
      if (
        !plaintextKey ||
        plaintextKey.byteLength !== 32 ||
        !encryptedKey?.byteLength ||
        !kekVersion
      ) {
        plaintextKey?.fill(0);
        throw new CredentialVaultError(
          'aws_kms_response_invalid',
          'AWS KMS returned an invalid data key response'
        );
      }
      return { plaintextKey, encryptedKey, kekVersion };
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error;
      throw new CredentialVaultError(
        'aws_kms_generate_data_key_failed',
        'AWS KMS operation failed',
        {
          cause: error,
        }
      );
    }
  }

  async decryptDataKey(wrapped: WrappedDataKey, context: CredentialContext): Promise<Uint8Array> {
    try {
      const response = await this.client.send(
        new DecryptCommand({
          KeyId: wrapped.kekVersion,
          CiphertextBlob: wrapped.encryptedKey,
          EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
          EncryptionContext: encryptionContext(context),
        })
      );
      if (!response.Plaintext || response.Plaintext.byteLength !== 32) {
        response.Plaintext?.fill(0);
        throw new CredentialVaultError(
          'aws_kms_response_invalid',
          'AWS KMS returned an invalid decrypted data key'
        );
      }
      return response.Plaintext;
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error;
      throw new CredentialVaultError(
        'aws_kms_decrypt_data_key_failed',
        'AWS KMS operation failed',
        {
          cause: error,
        }
      );
    }
  }
}

export function createAwsKmsClient(region: string): KMSClient {
  if (region.length === 0) {
    throw new CredentialVaultError('aws_kms_configuration_invalid', 'AWS region is required');
  }
  return new KMSClient({ region, maxAttempts: 3 });
}

/** Non-mutating readiness check. The workload role requires kms:DescribeKey on this key. */
export async function checkAwsKmsKey(client: KMSClient, keyId: string): Promise<void> {
  try {
    const { KeyMetadata: metadata } = await client.send(new DescribeKeyCommand({ KeyId: keyId }));
    if (
      !metadata?.Enabled ||
      metadata.KeyState !== 'Enabled' ||
      metadata.KeyUsage !== 'ENCRYPT_DECRYPT' ||
      metadata.KeySpec !== 'SYMMETRIC_DEFAULT'
    ) {
      throw new CredentialVaultError('aws_kms_key_unavailable', 'AWS KMS key is unavailable');
    }
  } catch (error) {
    if (error instanceof CredentialVaultError) throw error;
    throw new CredentialVaultError('aws_kms_key_unavailable', 'AWS KMS key is unavailable', {
      cause: error,
    });
  }
}

function encryptionContext(context: CredentialContext): Record<string, string> {
  return {
    application: 'social-publisher',
    credential_id: context.credentialId,
    workspace_id: context.workspaceId,
    platform_app_id: context.platformAppId,
    credential_type: context.credentialType,
    ...(context.binding
      ? { binding_type: context.binding.type, binding_id: context.binding.id }
      : {}),
  };
}
