export const errorClasses = [
  'VALIDATION',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'RATE_LIMIT',
  'PLATFORM_POLICY',
  'MEDIA_FETCH',
  'MEDIA_PROCESSING',
  'NETWORK',
  'PLATFORM_TRANSIENT',
  'PLATFORM_PERMANENT',
  'RESULT_UNKNOWN',
  'INTERNAL',
  'DEPENDENCY',
] as const;

export type ErrorClass = (typeof errorClasses)[number];

export type ProblemAction =
  | 'EDIT_CONTENT'
  | 'REAUTHORIZE_ACCOUNT'
  | 'WAIT_FOR_RATE_LIMIT'
  | 'CHECK_PUBLIC_MEDIA_URL'
  | 'RECONCILE_REMOTE_RESULT'
  | 'CONTACT_SUPPORT'
  | 'RETRY_SAFE';

export interface ProblemDefinition {
  readonly code: string;
  readonly errorClass: ErrorClass;
  readonly status: number;
  readonly messageKey: string;
  readonly action?: ProblemAction;
  readonly retryable: boolean;
}

export class DomainProblem extends Error {
  public constructor(
    public readonly definition: ProblemDefinition,
    public readonly args: Readonly<Record<string, string | number>> = {}
  ) {
    super(definition.code);
    this.name = 'DomainProblem';
  }
}
