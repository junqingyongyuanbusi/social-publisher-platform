import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CredentialEnvelopeCipher } from './envelope-cipher.js';
import { LocalAesKekProvider } from './local-kek-provider.js';
import type { CredentialContext } from './types.js';

const context: CredentialContext = {
  credentialId: 'credential-1',
  workspaceId: 'workspace-1',
  platformAppId: 'platform-app-1',
  credentialType: 'oauth_refresh_token',
};

function createCipher(): CredentialEnvelopeCipher {
  return new CredentialEnvelopeCipher(
    new LocalAesKekProvider(randomBytes(32).toString('base64'), 'local-test-v1')
  );
}

describe('CredentialEnvelopeCipher', () => {
  it('round-trips a credential without storing plaintext', async () => {
    const cipher = createCipher();
    const plaintext = Buffer.from('never-log-this-refresh-token');
    const envelope = await cipher.seal(plaintext, context);

    expect(Buffer.from(envelope.ciphertext).includes(plaintext)).toBe(false);
    expect(Buffer.from(await cipher.open(envelope, context)).toString()).toBe(plaintext.toString());
  });

  it('binds the envelope to its workspace and immutable credential ID through AAD', async () => {
    const cipher = createCipher();
    const envelope = await cipher.seal(Buffer.from('secret'), context);

    await expect(
      cipher.open(envelope, { ...context, workspaceId: 'workspace-2' })
    ).rejects.toMatchObject({ code: 'wrapped_data_key_authentication_failed' });
    await expect(
      cipher.open(envelope, { ...context, credentialId: 'credential-2' })
    ).rejects.toMatchObject({
      code: 'wrapped_data_key_authentication_failed',
    });
  });

  it('rejects modified ciphertext and authentication tags', async () => {
    const cipher = createCipher();
    const envelope = await cipher.seal(Buffer.from('secret'), context);
    const modified = { ...envelope, ciphertext: Uint8Array.from(envelope.ciphertext) };
    modified.ciphertext[0] = (modified.ciphertext[0] ?? 0) ^ 1;

    await expect(cipher.open(modified, context)).rejects.toMatchObject({
      code: 'credential_authentication_failed',
    });
  });

  it('zeroizes the provider plaintext data key after sealing', async () => {
    const key = randomBytes(32);
    const provider = {
      generateDataKey: vi.fn(async () => ({
        plaintextKey: key,
        encryptedKey: new Uint8Array(61),
        kekVersion: 'test-v1',
      })),
      decryptDataKey: vi.fn(),
    };
    await new CredentialEnvelopeCipher(provider).seal(Buffer.from('secret'), context);
    expect(key.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects empty and oversized secrets', async () => {
    const cipher = createCipher();
    await expect(cipher.seal(new Uint8Array(), context)).rejects.toMatchObject({
      code: 'credential_plaintext_size_invalid',
    });
    await expect(cipher.seal(new Uint8Array(65 * 1024), context)).rejects.toMatchObject({
      code: 'credential_plaintext_size_invalid',
    });
  });
});
