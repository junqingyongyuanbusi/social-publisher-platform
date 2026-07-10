import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { credentialAad, CredentialVaultError } from './context.js';
import type {
  CredentialContext,
  GeneratedDataKey,
  KeyEncryptionKeyProvider,
  WrappedDataKey,
} from './types.js';

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const WRAPPED_KEY_BYTES = 1 + NONCE_BYTES + TAG_BYTES + KEY_BYTES;
const WRAP_DOMAIN = Buffer.from('social-publisher/dek-wrap/v1\0', 'utf8');

/** Development/test provider. Production must use an external KMS/HSM implementation. */
export class LocalAesKekProvider implements KeyEncryptionKeyProvider {
  private readonly kek: Buffer;

  constructor(
    keyBase64: string,
    private readonly keyVersion: string
  ) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new CredentialVaultError(
        'local_kek_forbidden',
        'Local KEK provider is disabled in production'
      );
    }
    this.kek = Buffer.from(keyBase64, 'base64');
    if (this.kek.byteLength !== KEY_BYTES || keyVersion.length === 0) {
      this.kek.fill(0);
      throw new CredentialVaultError(
        'local_kek_configuration_invalid',
        'Local KEK must be a 32-byte base64 key with a version'
      );
    }
  }

  async generateDataKey(context: CredentialContext): Promise<GeneratedDataKey> {
    const plaintextKey = randomBytes(KEY_BYTES);
    try {
      return {
        plaintextKey,
        encryptedKey: this.wrap(plaintextKey, context),
        kekVersion: this.keyVersion,
      };
    } catch (error) {
      plaintextKey.fill(0);
      throw error;
    }
  }

  async decryptDataKey(wrapped: WrappedDataKey, context: CredentialContext): Promise<Uint8Array> {
    if (wrapped.kekVersion !== this.keyVersion) {
      throw new CredentialVaultError(
        'kek_version_unavailable',
        'Requested KEK version is unavailable'
      );
    }
    const encoded = Buffer.from(wrapped.encryptedKey);
    if (encoded.byteLength !== WRAPPED_KEY_BYTES || encoded[0] !== FORMAT_VERSION) {
      throw new CredentialVaultError('wrapped_data_key_invalid', 'Malformed wrapped data key');
    }

    try {
      const nonce = encoded.subarray(1, 1 + NONCE_BYTES);
      const tag = encoded.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const ciphertext = encoded.subarray(1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.kek, nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(this.wrapAad(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      throw new CredentialVaultError(
        'wrapped_data_key_authentication_failed',
        'Wrapped data key could not be authenticated',
        { cause: error }
      );
    }
  }

  private wrap(plaintextKey: Uint8Array, context: CredentialContext): Uint8Array {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(this.wrapAad(context));
    const ciphertext = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return Buffer.concat([Uint8Array.of(FORMAT_VERSION), nonce, cipher.getAuthTag(), ciphertext]);
  }

  private wrapAad(context: CredentialContext): Uint8Array {
    return Buffer.concat([WRAP_DOMAIN, credentialAad(context)]);
  }
}
