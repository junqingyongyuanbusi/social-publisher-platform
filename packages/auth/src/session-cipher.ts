import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuthenticationError } from './principal.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface SessionKeyRingConfig {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, string>>;
}

export class SessionCipher {
  private readonly keys = new Map<string, Buffer>();

  constructor(private readonly config: SessionKeyRingConfig) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(config.activeKeyId)) {
      throw new AuthenticationError('session_key_config_invalid');
    }
    for (const [id, encoded] of Object.entries(config.keys)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) continue;
      const key = Buffer.from(encoded, 'base64');
      if (key.byteLength === 32) this.keys.set(id, key);
      else key.fill(0);
    }
    if (!this.keys.has(config.activeKeyId)) {
      throw new AuthenticationError('session_key_config_invalid');
    }
  }

  seal(recordType: 'transaction' | 'session', recordId: string, value: unknown): string {
    const key = this.keys.get(this.config.activeKeyId);
    if (!key) throw new AuthenticationError('session_key_unavailable');
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(recordType, recordId, this.config.activeKeyId));
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return [
        'v1',
        this.config.activeKeyId,
        nonce.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.');
    } finally {
      plaintext.fill(0);
    }
  }

  open<T>(recordType: 'transaction' | 'session', recordId: string, encoded: string): T {
    const [version, keyId, nonceValue, ciphertextValue, tagValue, extra] = encoded.split('.');
    if (version !== 'v1' || !keyId || !nonceValue || !ciphertextValue || !tagValue || extra) {
      throw new AuthenticationError('session_record_invalid');
    }
    const key = this.keys.get(keyId);
    if (!key) throw new AuthenticationError('session_key_unavailable');
    try {
      const nonce = Buffer.from(nonceValue, 'base64url');
      const ciphertext = Buffer.from(ciphertextValue, 'base64url');
      const tag = Buffer.from(tagValue, 'base64url');
      if (nonce.byteLength !== NONCE_BYTES || tag.byteLength !== TAG_BYTES) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(recordType, recordId, keyId));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      try {
        return JSON.parse(plaintext.toString('utf8')) as T;
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw new AuthenticationError('session_record_invalid', { cause: error });
    }
  }
}

function aad(recordType: string, recordId: string, keyId: string): Uint8Array {
  return Buffer.from(JSON.stringify(['social-publisher/session/v1', recordType, recordId, keyId]));
}
