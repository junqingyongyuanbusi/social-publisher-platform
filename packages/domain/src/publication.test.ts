import { describe, expect, it } from 'vitest';
import { canTransition } from './publication.js';

describe('publication state machine', () => {
  it('allows a scheduled publication to enter the queue', () => {
    expect(canTransition('SCHEDULED', 'QUEUED')).toBe(true);
  });

  it('does not allow an unknown result to publish without reconciliation', () => {
    expect(canTransition('RESULT_UNKNOWN', 'PUBLISHED')).toBe(false);
    expect(canTransition('RESULT_UNKNOWN', 'RECONCILING')).toBe(true);
  });

  it('does not retry an already published publication', () => {
    expect(canTransition('PUBLISHED', 'QUEUED')).toBe(false);
  });
});
