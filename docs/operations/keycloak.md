# Bundled Keycloak identity service

The repository includes an optimized Keycloak image, a PostgreSQL service dedicated to identity data, and an imported `social-publisher` realm. The realm defines the `social-publisher-web` PKCE client, the `social-publisher-api` audience, and the `viewer`, `operator`, `admin`, and `owner` roles.

## Local login

Start PostgreSQL, Redis, and Keycloak, apply the application migration, and run the apps:

```bash
cp .env.example .env
docker compose up -d postgres redis keycloak-postgres keycloak
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Before starting Compose, replace `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, and `KEYCLOAK_OWNER_PASSWORD` in `.env`. Start `keycloak-bootstrap` once after Keycloak is healthy; it creates or updates the local `owner` user idempotently and marks the supplied password temporary:

```bash
docker compose up keycloak-bootstrap
```

Open `http://localhost:3000/zh-CN` and log in as `owner` with the password set in `KEYCLOAK_OWNER_PASSWORD`. Keycloak requires a replacement on first login. The Keycloak administration console is at `http://localhost:8080/admin`; its username is `admin` and its password comes from `KEYCLOAK_ADMIN_PASSWORD`.

No development password or application user is stored in the Realm JSON or container image. The bootstrap script receives passwords only at runtime.

## Production bootstrap

Before the first production start:

1. Replace every `publisher.example.com` and `identity.example.com` value in the environment and realm redirect configuration with the real HTTPS origins.
2. Generate `deploy/secrets/keycloak_db_password` and `deploy/secrets/keycloak_admin_password` as independent random values with file mode `0600`.
3. Generate the browser session encryption key referenced by `BROWSER_SESSION_KEYS_JSON`.
4. Route the public identity hostname to Keycloak port 8080 through the TLS reverse proxy. Do not expose management port 9000 publicly.
5. Start the stack and sign in to the Keycloak administration console with `KC_BOOTSTRAP_ADMIN_USERNAME` and the admin password secret.
6. Create the first application user in the `social-publisher` realm and assign exactly one of the workspace roles. Assign `owner` to the initial administrator.

The application API maps a Keycloak realm role to the UUID in `OIDC_DEFAULT_WORKSPACE_ID`. The database migration creates that initial workspace idempotently. If a token contains the native multi-tenant `social_workspaces` claim, the explicit memberships take precedence over this bundled single-workspace mapping.

Realm startup import creates a realm only when it does not already exist. Later realm changes must be applied deliberately through the Admin Console/Admin API or during a controlled offline import; the JSON file is not a live configuration reconciler.

## Backup and recovery

Back up the Keycloak PostgreSQL database independently from the publishing database. The realm JSON is bootstrap configuration, not a backup: it does not contain later users, credentials, sessions, role assignments, or administrative changes. Test identity database restoration alongside the application restore drill.
