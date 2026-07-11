# Resource and execution boundaries

## OAuth ownership

Application credentials and account authorization are separate aggregates:

- `CredentialVersion` belongs to one `PlatformApp` and stores only app-scoped secrets.
- `OAuthConnection` joins exactly one workspace-owned platform app to one workspace-owned social account.
- `OAuthTokenVersion` stores access and refresh material as one encrypted bundle. Its copied workspace and platform-app identifiers participate in a composite foreign key and in envelope AAD.
- One partial unique index permits one active token version per connection. Rotation is serialized with a PostgreSQL advisory transaction lock.

Browser and generic credential APIs never accept account access or refresh tokens. A provider callback exchanges the authorization code on the server, immediately transfers the encoded token bundle to `OAuthTokenService`, and receives only non-secret metadata.

## Tenant integrity

Workspace ownership is not only an application query convention. Composite database relationships require:

- a social account's workspace, platform app, and platform to agree;
- an OAuth connection's app and account to belong to the same workspace;
- a content version to retain its content workspace;
- a publication's content version, social account, platform, and workspace to agree;
- publication media, selected variants, assets, and publications to share one workspace.

API lookups still filter by workspace and return a uniform unavailable error. Database constraints are the second boundary against implementation mistakes and race conditions.

## Media trust boundary

Publication contracts accept media asset IDs, never arbitrary worker download URLs. `MediaAsset` records origin, verified MIME type, byte size, checksum, dimensions/duration, processing status, and object-storage identity. `MediaVariant` records an immutable derived representation and its transformation metadata.

Only `READY`, non-deleted assets may enter validation. A future delivery service will mint short-lived URLs for a selected variant after SSRF, MIME, codec, size, and ownership checks. Delivery URLs must not enter durable checkpoints or logs.

## Restart-safe execution

Adapters progress through persisted stages:

```text
PREPARE_MEDIA → UPLOAD → WAIT_PROCESSING → PUBLISH → VERIFY
```

An adapter may return `WAIT`, `PUBLISHED`, or `RESULT_UNKNOWN`. A timeout after the publish request enters verification/reconciliation; it never re-enters `PUBLISH` blindly.

Publication state changes and `OutboxEvent` creation must share one PostgreSQL transaction. The dispatcher uses the event deduplication key as the BullMQ job ID. Provider webhooks enter `WebhookInbox` only after signature verification and are deduplicated before processing.
