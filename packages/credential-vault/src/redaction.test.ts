import { describe, expect, it } from 'vitest';
import { maskCredential, redactSecrets } from './redaction.js';

describe('credential redaction', () => {
  it('exposes only a short suffix for identification', () => {
    expect(maskCredential('super-secret-value')).toBe('••••alue');
    expect(maskCredential('   ')).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields without mutating safe metadata', () => {
    const input = {
      platform: 'x',
      headers: { authorization: 'Bearer secret', 'x-request-id': 'req-1' },
      response: { refresh_token: 'secret', status: 401 },
    };
    expect(redactSecrets(input)).toEqual({
      platform: 'x',
      headers: { authorization: '[REDACTED]', 'x-request-id': 'req-1' },
      response: { refresh_token: '[REDACTED]', status: 401 },
    });
    expect(input.headers.authorization).toBe('Bearer secret');
  });
});
