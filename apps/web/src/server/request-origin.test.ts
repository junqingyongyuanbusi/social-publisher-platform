import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationOrigin, assertSameOrigin } from './request-origin';

afterEach(() => vi.unstubAllEnvs());

describe('request origin policy', () => {
  it('accepts only the explicitly configured browser origin', () => {
    vi.stubEnv('WEB_ORIGIN', 'https://publisher.example.com');
    const allowed = new Request('https://internal.invalid/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://publisher.example.com' },
    });
    expect(() => assertSameOrigin(allowed)).not.toThrow();

    const denied = new Request('https://publisher.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    expect(() => assertSameOrigin(denied)).toThrow('csrf_origin_invalid');
  });

  it('does not trust the request host in production when WEB_ORIGIN is absent', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_ORIGIN', '');
    expect(() => applicationOrigin(new Request('https://attacker.example'))).toThrow(
      'WEB_ORIGIN is required in production'
    );
  });
});
