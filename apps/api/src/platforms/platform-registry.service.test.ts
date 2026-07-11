import { describe, expect, it } from 'vitest';
import { PlatformRegistry } from './platform-registry.service.js';

describe('PlatformRegistry', () => {
  it('registers exactly the initial three isolated adapters', () => {
    expect(
      new PlatformRegistry()
        .list()
        .map(({ platform }) => platform)
        .sort()
    ).toEqual(['facebook', 'instagram', 'x']);
  });
});
