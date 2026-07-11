# Production v1 roadmap

This document defines when Social Publisher may be called a working MVP or a production v1. Passing unit tests or rendering the dashboard is not sufficient: the platform must prove remote side-effect safety, tenant isolation, diagnosability, and recovery.

## Current baseline

The integration branch currently contains:

- the Next.js, NestJS, BullMQ, Redis, PostgreSQL, and Prisma modular-monolith foundation;
- `zh-CN` and `en-US` UI infrastructure;
- OIDC access-token verification, workspace RBAC, browser Authorization Code + PKCE, encrypted server-side sessions, refresh locking, and CSRF defenses;
- versioned AES-256-GCM credential envelopes, AWS KMS data keys, masked metadata, rotation, revocation, and audit events;
- a protected credential BFF and bilingual credential-management UI;
- platform contracts, publication states, error classes, request IDs, CI, and 47 unit tests.

The baseline is not yet a three-platform publishing release. X now has a text-post vertical slice: UI/API content and publication creation, scheduling, transactional outbox dispatch, encrypted token refresh, remote publish, attempt persistence, retry classification, unknown-result quarantine, history, cancellation, and manual retry. X media and both Meta executors remain disabled.

The M1 branch work now defines account-scoped OAuth token versions, workspace-safe media ownership, publication media, an outbox/inbox persistence boundary, staged adapter execution contracts, fail-fast API configuration, and PostgreSQL/KMS readiness. These foundations remain disabled for live publishing until provider callbacks and the outbox dispatcher are connected and exercised end to end.

## Frozen internal-MVP matrix

Only capabilities with real sandbox/test-account end-to-end coverage may be advertised by the API or UI.

| Platform               | Internal MVP                                                                               | Deferred until separately verified                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| X                      | text posts; up to four images; one supported video; delete when the access tier permits it | polls, threads, long-form posts, audience controls, ads               |
| Facebook Page          | text/link feed posts; one image; one supported video                                       | multi-photo edge cases, Reels, Stories, scheduled posts owned by Meta |
| Instagram Professional | single image; carousel of 2–10 supported items; one Reel                                   | Stories, collaborators, music, shopping/product tags                  |

Platform capabilities and limits change. Adapters must expose the intersection of configured app permissions, connected-account capabilities, current platform rules, and features proven by contract tests.

## Non-negotiable model corrections

These changes precede all live `publish()` implementations:

1. Separate app-scoped secrets from account-scoped OAuth grants.
2. Add an `OAuthConnection` aggregate bound to one workspace, platform app, social account, provider subject, granted scopes, and token family.
3. Rotate access and refresh tokens as one atomic encrypted authorization version; bind envelope AAD to the account/connection identity.
4. Add a `MediaAsset` lifecycle with object storage, ownership, MIME sniffing, size/dimension/duration checks, checksum, processing status, and safe expiry.
5. Add database-level tenant consistency for platform apps, social accounts, content versions, publications, credentials, and media.
6. Add a transactional outbox between publication state changes and BullMQ dispatch.

Without these invariants, multiple accounts can supersede one another's tokens, Instagram cannot pass validation, and a process crash can lose or duplicate scheduled work.

## Delivery milestones

| Milestone | Deliverable                                                                                         | Exit criteria                                                                                                                       |          Single-engineer estimate |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------: |
| M0        | one integration branch, security cleanup, v1 matrix                                                 | one PR to `main`; CI green; previously exposed third-party values revoked                                                           |                         0.5–1 day |
| M1        | corrected tenant/OAuth/media foundations, workspace and platform-app administration, real readiness | a clean environment can be configured from UI/API; cross-tenant tests pass; DB/Redis/KMS failure makes readiness fail               |                          2–4 days |
| M2        | X and Meta OAuth connection lifecycle                                                               | three test accounts connect without pasting user tokens; refresh, permission loss, disconnect, and reauthorization are tested       |                         6–10 days |
| M3        | media ingestion and processing                                                                      | supported image/video/carousel assets reach a ready state; private-network URLs and invalid media fail safely                       |                          4–7 days |
| M4        | publication control plane                                                                           | content/version CRUD, validation, scheduling, cancellation, retry, outbox, and idempotency work with a fake adapter across restarts |                          6–9 days |
| M5        | three live platform executors                                                                       | every frozen capability publishes through a real test account and persists remote post/request identifiers                          | 12–19 person-days, parallelizable |
| M6        | retry, rate limit, webhook, and reconciliation                                                      | 401/403/429/5xx/timeouts are classified; an unknown remote result converges without blind duplicate publishing                      |                          4–7 days |
| M7        | observability and diagnostics UI                                                                    | one publication ID locates API request, queue job, worker attempt, trace, and platform request within five minutes                  |                          4–6 days |
| M8        | production delivery                                                                                 | staging E2E, failure injection, backup/restore, rollback, key rotation, alerting, and a 72-hour soak all pass                       |                         7–12 days |
| M9        | optional n8n parity                                                                                 | Notion/RSS ingestion, prompt templates, image generation, approval, deduplication, and source write-back are equivalent             |                         5–10 days |

Estimates are engineering effort, not calendar guarantees. Meta business verification/app review and X access approval can add external lead time that code cannot shorten.

## Internal MVP definition

The internal MVP is complete only when:

- all three platforms connect from UI and publish the frozen capability matrix through real test accounts;
- publication creation, scheduling, cancellation, history, and attempt details are usable in both locales;
- one idempotency key and duplicate queue delivery cannot create duplicate remote posts;
- API, worker, Redis, or PostgreSQL restarts do not silently lose scheduled publications;
- ambiguous network outcomes enter `RESULT_UNKNOWN` and reconciliation, never an automatic blind retry;
- account token refresh and reauthorization are isolated across two accounts connected through the same platform app.

## Production v1 definition

Production v1 additionally requires:

- stable machine error codes and bilingual actions for platform authentication, authorization, policy, rate-limit, transient, permanent, and unknown-result failures;
- structured redacted logs, OpenTelemetry traces, metrics, alerts, and an operator-facing attempt timeline;
- truthful liveness/readiness for PostgreSQL, Redis, queue, KMS, and required identity dependencies;
- integration and end-to-end tests for PostgreSQL, Redis/BullMQ, KMS, OIDC, browser sessions, workers, and each platform adapter;
- fault injection for timeout, 429, remote-success/local-write-failure, duplicate delivery, worker termination, and dependency recovery;
- production images/IaC/CD, migration and rollback procedures, backup restore, credential/key rotation, incident runbooks, and least-privilege workload identity;
- at least 72 hours of staging soak with no unexplained duplicate, lost, or silently failed publication.

## Safety rule

Do not implement direct platform HTTP calls before the account-scoped OAuth model, media lifecycle, transactional outbox, and attempt persistence exist. A fast adapter without those foundations recreates the least reliable properties of an automation workflow in TypeScript.
