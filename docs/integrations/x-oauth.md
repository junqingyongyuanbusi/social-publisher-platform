# X OAuth 2.0 integration

## Implemented flow

1. An authenticated owner or administrator starts the connection from the accounts UI.
2. The API creates a 256-bit opaque state and a PKCE S256 verifier. Only a SHA-256 state key is stored in Redis, with a 10-minute maximum lifetime.
3. X redirects to the registered web callback. The BFF uses the existing server-side login session to call the API; platform tokens never enter browser storage.
4. The API atomically consumes the Redis transaction, verifies the initiating actor, exchanges the short-lived code, and calls `GET /2/users/me`.
5. The social account and OAuth connection are upserted, then the access and rotated refresh token are encrypted as one version bound to that connection.
6. Disconnect revokes the local token version and marks the account disconnected. Provider-side revocation and automatic refresh are the next M2 increments.

X platform applications must register the exact value stored in `PlatformApp.redirectUri`. Required scopes for the first publishing slice are `tweet.read`, `tweet.write`, `users.read`, and `offline.access`; configured extra scopes such as `media.write` are preserved. Web and automated applications should store an active `app_secret` credential. Public clients are also supported through PKCE without a secret.

## Operational failure codes

- `oauth_transaction_invalid`: expired, replayed, malformed, or initiated by another actor.
- `x_token_exchange_failed`: X rejected the authorization code or client authentication.
- `x_user_lookup_failed`: the grant cannot read the current X account.
- `oauth_token_not_available`: the encrypted local grant is absent or inactive.

Never log authorization codes, PKCE verifiers, access tokens, refresh tokens, client secrets, or complete provider response bodies.
