import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/database.module.js';
import { MetricsController } from './diagnostics.module.js';
describe('diagnostic metrics', () => {
  it('uses bounded labels and excludes tenant/publication identifiers', async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([{ platform: 'X', status: 'PUBLISHED', _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ status: 'PENDING', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ platform: 'X', status: 'ACTIVE', _count: { _all: 2 } }]);
    const prisma = {
      publication: { groupBy },
      outboxEvent: { groupBy },
      socialAccount: { groupBy },
    } as unknown as PrismaService;
    const output = await new MetricsController(prisma).metrics();
    expect(output).toContain('social_publications_total{platform="x",status="published"} 3');
    expect(output).not.toContain('workspace');
    expect(output).not.toContain('publication_id');
  });
});
