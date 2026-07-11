import { describe, expect, it } from 'vitest';
import { XAdapter } from './index.js';

describe('XAdapter', () => {
  const adapter = new XAdapter();

  it('rejects an empty post', () => {
    expect(
      adapter.validate({
        publicationId: 'p',
        accountId: 'a',
        text: '',
        media: [],
        settings: {},
      })
    ).toHaveLength(1);
  });

  it('exposes X media capacity', () => {
    expect(adapter.getCapabilities().image.maxCount).toBe(4);
  });
});
