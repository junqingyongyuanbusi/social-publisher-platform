import { DomainProblem } from './problem.js';

export const platforms = ['x', 'facebook', 'instagram'] as const;
export type Platform = (typeof platforms)[number];

export const publicationStatuses = [
  'DRAFT',
  'VALIDATING',
  'VALIDATION_FAILED',
  'SCHEDULED',
  'QUEUED',
  'PUBLISHING',
  'RETRY_WAITING',
  'RESULT_UNKNOWN',
  'RECONCILING',
  'REAUTH_REQUIRED',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const;

export type PublicationStatus = (typeof publicationStatuses)[number];

const transitions: Readonly<Record<PublicationStatus, readonly PublicationStatus[]>> = {
  DRAFT: ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['VALIDATION_FAILED', 'SCHEDULED'],
  VALIDATION_FAILED: ['DRAFT', 'CANCELLED'],
  SCHEDULED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['PUBLISHING', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'RETRY_WAITING', 'RESULT_UNKNOWN', 'REAUTH_REQUIRED', 'FAILED'],
  RETRY_WAITING: ['QUEUED', 'CANCELLED'],
  RESULT_UNKNOWN: ['RECONCILING'],
  RECONCILING: ['PUBLISHED', 'FAILED', 'RESULT_UNKNOWN'],
  REAUTH_REQUIRED: ['QUEUED', 'CANCELLED'],
  PUBLISHED: [],
  FAILED: ['QUEUED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: PublicationStatus, to: PublicationStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainProblem(
      {
        code: 'PUBLICATION_INVALID_TRANSITION',
        errorClass: 'VALIDATION',
        status: 409,
        messageKey: 'errors.publication.invalidTransition',
        retryable: false,
      },
      { from, to }
    );
  }
}
