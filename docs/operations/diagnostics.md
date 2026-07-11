# Diagnostics and telemetry

The operator UI correlates a publication with its social account state, immutable media metadata, PublicationAttempt rows, pinned OAuth token version metadata, outbox delivery, audit request IDs, trace IDs, provider request IDs, HTTP status, and stable error classification. It never returns token values, signed URLs, object keys, or provider response bodies.

`GET /api/v1/metrics` exposes Prometheus text metrics with bounded `platform` and `status` labels. Workspace, publication, account, request, trace, and provider IDs are deliberately excluded from metric labels to prevent cardinality growth. Those identifiers belong in traces and structured logs.

OpenTelemetry must initialize before application modules when OTLP export is enabled. HTTP, PostgreSQL, Redis, and worker spans should propagate W3C trace context; custom publication spans should attach publication, platform, stage, and attempt attributes. Secrets and post bodies must not be span attributes. The current persisted trace/request correlation remains usable when no collector is configured.
