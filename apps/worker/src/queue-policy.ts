import type { PublicationStatus } from '@social/domain';

export const PUBLICATION_QUEUE = 'publication.execute.v1';

export function shouldRetry(status: PublicationStatus): boolean {
  return status === 'RETRY_WAITING';
}

export const jobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: false,
};
