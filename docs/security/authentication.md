# Authentication and workspace authorization

## API trust boundary

The API accepts short-lived OIDC access tokens in the `Authorization: Bearer` header. It does not accept an ID token as an API credential and does not trust workspace or role headers.

The verifier requires:

- a valid asymmetric signature from the configured JWKS URI;
- an exact issuer match;
- the configured API audience;
- `sub`, `iat`, and `exp` claims;
- a bounded token age in addition to expiration;
- an allowlisted algorithm (`RS256` and `ES256` by default); and
- a strict, non-empty `social_workspaces` claim.

Production issuer and JWKS URLs must use HTTPS. The JWKS URL is explicit configuration rather than a token-controlled URL, which prevents untrusted tokens from selecting a key endpoint.

## Workspace claim

The identity provider must add this claim to the API access token:

```json
{
  "social_workspaces": [{ "workspaceId": "9dd906b6-d90f-4ab9-bf69-b592958863da", "role": "admin" }]
}
```

The API rejects absent, empty, malformed, oversized, unknown-role, and duplicate workspace entries. A duplicate is rejected rather than merged because conflicting role values are ambiguous and may represent an identity-provider mapping error.

## Roles

| Role       | Permissions                                                 |
| ---------- | ----------------------------------------------------------- |
| `viewer`   | Workspace read and diagnostics read                         |
| `operator` | Viewer permissions plus validate/create/cancel publication  |
| `admin`    | Operator permissions plus account and credential management |
| `owner`    | All permissions, including workspace administration         |

Controllers declare permissions; they do not compare role names themselves. Authorization first selects membership for the route's `:workspaceId`, then checks that role against the central policy matrix.

The API returns the same forbidden response for a missing membership and an insufficient role so callers cannot use response differences to enumerate workspace membership.

## Route defaults

Authentication is deny-by-default through a global NestJS guard. A route is anonymous only when explicitly decorated `@Public()`.

Current public routes:

- process health probes;
- static platform capability descriptions.

Swagger UI is enabled by default only outside production. A production deployment must explicitly set `ENABLE_SWAGGER=true` if documentation exposure is intended and separately protect access at the ingress.

Workspace publication validation is now located at:

```text
POST /api/v1/workspaces/{workspaceId}/publications/validate
```

Identity verification is available at:

```text
GET /api/v1/workspaces/{workspaceId}/identity/me
```

## Browser session boundary

The management UI uses Authorization Code with PKCE. Each login creates fresh state, nonce, and verifier values stored in a one-time encrypted Redis transaction with a ten-minute TTL.

After callback validation, the browser receives only a cryptographically random 256-bit opaque session ID in an `HttpOnly`, `Secure` (production), `SameSite=Lax` cookie. Access, refresh, and ID tokens are encrypted before Redis persistence and are never returned by the session endpoint or stored in `localStorage`.

Session records are bound to their opaque ID through AES-256-GCM AAD. The key ring supports a new active key while retaining previous decryption keys during rotation.

Access tokens are refreshed before expiry under a short Redis distributed lock. Refresh-token rotation is persisted atomically with the new access token; refresh failure deletes the session and fails closed.

Cookie-authenticated mutations require both:

- an exact configured Origin match; and
- a double-submit CSRF token whose digest is also bound inside the encrypted server session.

Login return paths must be local absolute paths and cannot begin with `//`, contain backslashes, or exceed the configured limit.

Browser endpoints:

```text
GET  /api/auth/login
GET  /api/auth/callback
GET  /api/auth/session
POST /api/auth/logout
```

The browser endpoints establish the session boundary. Protected credential management is enabled through the server BFF for workspace administrators. Live platform OAuth and publishing remain disabled until provider callbacks, account-scoped grants, browser end-to-end tests, and an identity-provider claim-mapping runbook are complete.

Authenticated BFF routes forward the server-held access token to `API_INTERNAL_URL`. They never return it to the browser. Credential mutations require the same Origin and CSRF checks as logout before forwarding to the API.

## References

- OpenID Connect Core: <https://openid.net/specs/openid-connect-core-1_0.html>
- OpenID Connect Discovery: <https://openid.net/specs/openid-connect-discovery-1_0.html>
- `jose` JWT verification: <https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md>
- OWASP authentication guidance: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
