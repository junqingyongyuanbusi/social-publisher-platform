import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SessionCipher } from './session-cipher.js';

function fixture() {
  return new SessionCipher({
    activeKeyId: 'key-v2',
    keys: {
      'key-v1': randomBytes(32).toString('base64'),
      'key-v2': randomBytes(32).toString('base64'),
    },
  });
}

describe('SessionCipher', () => {
  it('encrypts records and binds them to type and opaque ID', () => {
    const cipher = fixture();
    const encoded = cipher.seal('session', 'session-1', { accessToken: 'never-store-plain' });
    expect(encoded).not.toContain('never-store-plain');
    expect(cipher.open('session', 'session-1', encoded)).toEqual({
      accessToken: 'never-store-plain',
    });
    expect(() => cipher.open('session', 'session-2', encoded)).toThrowError(
      expect.objectContaining({ code: 'session_record_invalid' })
    );
    expect(() => cipher.open('transaction', 'session-1', encoded)).toThrowError(
      expect.objectContaining({ code: 'session_record_invalid' })
    );
  });

  it('rejects modified records and unavailable key versions', () => {
    const cipher = fixture();
    const encoded = cipher.seal('session', 'session-1', { subject: 'user-1' });
    expect(() => cipher.open('session', 'session-1', `${encoded}x`)).toThrowError(
      expect.objectContaining({ code: 'session_record_invalid' })
    );
    const unavailable = encoded.replace('.key-v2.', '.unknown.');
    expect(() => cipher.open('session', 'session-1', unavailable)).toThrowError(
      expect.objectContaining({ code: 'session_key_unavailable' })
    );
  });
});
