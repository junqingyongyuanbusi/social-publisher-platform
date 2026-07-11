import { describe, expect, it } from 'vitest';
import { negotiateLocale } from './index.js';

describe('negotiateLocale', () => {
  it('maps Chinese language tags to zh-CN', () => {
    expect(negotiateLocale('zh-TW,zh;q=0.9')).toBe('zh-CN');
  });

  it('maps English language tags to en-US', () => {
    expect(negotiateLocale('en-GB,en;q=0.8')).toBe('en-US');
  });

  it('falls back to Chinese', () => {
    expect(negotiateLocale('fr-FR')).toBe('zh-CN');
  });
});
