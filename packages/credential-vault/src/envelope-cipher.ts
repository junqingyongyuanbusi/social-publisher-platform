import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { credentialAad, CredentialVaultError } from './context.js';
import {
  CREDENTIAL_CIPHER_SUITE,
  CREDENTIAL_ENVELOPE_VERSION,
  type CredentialContext,
  type CredentialEnvelope,
  type KeyEncryptionKeyProvider,
} from './types.js';

const DATA_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_SECRET_BYTES = 64 * 1024;

export class CredentialEnvelopeCipher {
  constructor(private readonly keyProvider: KeyEncryptionKeyProvider) {}

  async seal(plaintext: Uint8Array, context: CredentialContext): Promise<CredentialEnvelope> {
    if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_SECRET_BYTES) {
      throw new CredentialVaultError(
        'credential_plaintext_size_invalid',
        `Credential must be between 1 and ${MAX_SECRET_BYTES} bytes`
      );
    }

    const aad = credentialAad(context);
    const generated = await this.keyProvider.generateDataKey(context);
    const dataKey = Buffer.from(generated.plaintextKey);
    try {
      assertDataKey(dataKey);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dataKey, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
        cipherSuite: CREDENTIAL_CIPHER_SUITE,
        ciphertext,
        nonce,
        authTag: cipher.getAuthTag(),
        encryptedKey: generated.encryptedKey,
        kekVersion: generated.kekVersion,
      };
    } finally {
      dataKey.fill(0);
      generated.plaintextKey.fill(0);
    }
  }

  async open(envelope: CredentialEnvelope, context: CredentialContext): Promise<Uint8Array> {
    assertEnvelope(envelope);
    const aad = credentialAad(context);
    const plaintextKey = await this.keyProvider.decryptDataKey(envelope, context);
    const dataKey = Buffer.from(plaintextKey);
    try {
      assertDataKey(dataKey);
      const decipher = createDecipheriv('aes-256-gcm', dataKey, envelope.nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    } catch (error) {
      throw new CredentialVaultError(
        'credential_authentication_failed',
        'Credential envelope could not be authenticated',
        { cause: error }
      );
    } finally {
      dataKey.fill(0);
      plaintextKey.fill(0);
    }
  }
}

function assertDataKey(key: Uint8Array): void {
  if (key.byteLength !== DATA_KEY_BYTES) {
    throw new CredentialVaultError('credential_data_key_invalid', 'Expected a 256-bit data key');
  }
}

function assertEnvelope(envelope: CredentialEnvelope): void {
  if (
    envelope.envelopeVersion !== CREDENTIAL_ENVELOPE_VERSION ||
    envelope.cipherSuite !== CREDENTIAL_CIPHER_SUITE ||
    envelope.nonce.byteLength !== NONCE_BYTES ||
    envelope.authTag.byteLength !== AUTH_TAG_BYTES ||
    envelope.ciphertext.byteLength === 0 ||
    envelope.ciphertext.byteLength > MAX_SECRET_BYTES
  ) {
    throw new CredentialVaultError('credential_envelope_invalid', 'Malformed credential envelope');
  }
}
