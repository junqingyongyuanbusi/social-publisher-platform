import { describe, expect, it } from 'vitest';
import { shouldRetry } from './queue-policy.js';

describe('queue retry policy', () => {
  it('never blindly retries an unknown result', () =>
    expect(shouldRetry('RESULT_UNKNOWN')).toBe(false));
  it('retries only explicit retry-waiting state', () =>
    expect(shouldRetry('RETRY_WAITING')).toBe(true));
});
