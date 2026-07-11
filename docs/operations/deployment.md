# Production deployment and recovery

## Build and configuration

The root Dockerfile has independent `api`, `worker`, and `web` runtime targets. All compile in a shared build stage and run as the unprivileged Node user. The optimized Keycloak image is built separately from `deploy/keycloak`. Runtime application containers are read-only with a temporary `/tmp`. Copy `deploy/.env.production.example` to `deploy/.env.production`; create `deploy/secrets/postgres_password`, `deploy/secrets/redis_password`, `deploy/secrets/keycloak_db_password`, and `deploy/secrets/keycloak_admin_password` with mode `0600`. Never commit these files. Complete the [Keycloak bootstrap](keycloak.md) before accepting users.

Export `IMAGE_TAG` as the release commit SHA in the deployment shell. Run `docker compose -f deploy/compose.production.yml config --quiet`, then `docker compose -f deploy/compose.production.yml build` and record each image digest. Start with `docker compose -f deploy/compose.production.yml up -d`; the one-shot migration job must succeed before the API starts. Deploy API and Web before Worker when performing a manual rolling rollout so no new job uses older code against a newer schema.

## Rollback

Application rollback means setting `IMAGE_TAG` to the previous release SHA and running `docker compose -f deploy/compose.production.yml up -d --no-build`. Database migrations must be backward-compatible for at least one application release. Never automatically reverse a migration containing data changes. If compatibility cannot be maintained, stop the Worker, restore the pre-deploy database snapshot, select the previous images, and then resume traffic.

## PostgreSQL backup and restore

Take encrypted managed snapshots of both the publishing and Keycloak databases before every schema or identity release. Run scheduled logical backups with `pg_dump --format=custom --no-owner --file=backup.dump "$DATABASE_URL"`. Restore into an isolated database with `pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" backup.dump`. A restore drill must compare row counts for workspaces, accounts, publications, attempts, outbox events, and credential versions, verify identity users and role assignments, and confirm that the API readiness probe and a test login succeed. Do not validate restore procedures against live databases.

## Redis recovery

Redis is transport and short-lived OAuth transaction state, not the source of truth. AOF is enabled to reduce queue loss. After Redis loss, restart the dispatcher: pending/expired PROCESSING outbox rows repopulate BullMQ with deterministic job IDs. Active OAuth browser transactions must be restarted by the user.

## Deployment gates

Required gates are migration success, API readiness, Web login, one test publication per enabled platform, zero unexplained `RESULT_UNKNOWN`, an empty overdue outbox, Prometheus target health, alert delivery, and a rollback rehearsal. Production v1 additionally requires a 72-hour staging soak.
