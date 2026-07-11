import {
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  type KMSClient,
} from '@aws-sdk/client-kms';
import { describe, expect, it, vi } from 'vitest';
import { AwsKmsKeyProvider, checkAwsKmsKey } from './index.js';

const context = {
  credentialId: 'credential-1',
  workspaceId: 'workspace-1',
  platformAppId: 'platform-app-1',
  credentialType: 'app_secret',
};

describe('AwsKmsKeyProvider', () => {
  it('generates a unique AES-256 data key with non-secret encryption context', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GenerateDataKeyCommand);
      const input = (command as GenerateDataKeyCommand).input;
      expect(input).toMatchObject({
        KeyId: 'alias/social-publisher-production',
        KeySpec: 'AES_256',
        EncryptionContext: {
          application: 'social-publisher',
          credential_id: 'credential-1',
          workspace_id: 'workspace-1',
          platform_app_id: 'platform-app-1',
          credential_type: 'app_secret',
        },
      });
      return {
        Plaintext: new Uint8Array(32).fill(7),
        CiphertextBlob: new Uint8Array([1, 2, 3]),
        KeyId: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
      };
    });
    const provider = new AwsKmsKeyProvider({ send } as unknown as KMSClient, {
      keyId: 'alias/social-publisher-production',
    });
    await expect(provider.generateDataKey(context)).resolves.toMatchObject({
      kekVersion: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
    });
  });

  it('decrypts only with the stored key ARN and identical encryption context', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(DecryptCommand);
      expect((command as DecryptCommand).input).toMatchObject({
        KeyId: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        EncryptionContext: { credential_id: 'credential-1', workspace_id: 'workspace-1' },
      });
      return { Plaintext: new Uint8Array(32).fill(9) };
    });
    const provider = new AwsKmsKeyProvider({ send } as unknown as KMSClient, {
      keyId: 'alias/social-publisher-production',
    });
    await expect(
      provider.decryptDataKey(
        {
          encryptedKey: new Uint8Array([1, 2, 3]),
          kekVersion: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
        },
        context
      )
    ).resolves.toHaveLength(32);
  });

  it('normalizes provider failures without leaking SDK details', async () => {
    const provider = new AwsKmsKeyProvider(
      {
        send: vi.fn(async () => Promise.reject(new Error('sensitive AWS detail'))),
      } as unknown as KMSClient,
      { keyId: 'alias/social-publisher-production' }
    );
    await expect(provider.generateDataKey(context)).rejects.toMatchObject({
      code: 'aws_kms_generate_data_key_failed',
      message: 'AWS KMS operation failed',
    });
  });

  it('binds account authorization data to its OAuth connection', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GenerateDataKeyCommand);
      expect((command as GenerateDataKeyCommand).input.EncryptionContext).toMatchObject({
        binding_type: 'OAUTH_CONNECTION',
        binding_id: 'connection-1',
      });
      return {
        Plaintext: new Uint8Array(32).fill(4),
        CiphertextBlob: new Uint8Array([4, 5, 6]),
        KeyId: 'arn:aws:kms:us-east-1:123456789012:key/key-id',
      };
    });
    const provider = new AwsKmsKeyProvider({ send } as unknown as KMSClient, {
      keyId: 'alias/social-publisher-production',
    });

    await provider.generateDataKey({
      ...context,
      credentialType: 'oauth_token_bundle',
      binding: { type: 'OAUTH_CONNECTION', id: 'connection-1' },
    });
  });

  it('checks key readiness without generating or decrypting data', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(DescribeKeyCommand);
      return {
        KeyMetadata: {
          Enabled: true,
          KeyState: 'Enabled',
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
        },
      };
    });

    await expect(
      checkAwsKmsKey({ send } as unknown as KMSClient, 'alias/social-publisher-production')
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });

  it('fails readiness safely for a disabled key', async () => {
    const client = {
      send: vi.fn(async () => ({
        KeyMetadata: {
          Enabled: false,
          KeyState: 'Disabled',
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
        },
      })),
    } as unknown as KMSClient;

    await expect(checkAwsKmsKey(client, 'key-id')).rejects.toMatchObject({
      code: 'aws_kms_key_unavailable',
      message: 'AWS KMS key is unavailable',
    });
  });
});
