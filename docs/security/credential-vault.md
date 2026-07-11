# Credential vault security model

## Status

The cryptographic core, protected API, authenticated server BFF, and bilingual management UI are implemented. Credential operations require an authenticated workspace administrator and browser mutations require Origin and CSRF validation. The platform fails closed if a production KMS provider is unavailable.

The generic secret form accepts only app-scoped `app_secret`, `api_key`, and `webhook_secret` values. User and Page OAuth grants are not accepted by that API: provider callbacks must encode access and refresh material as one owned token bundle and bind each encrypted version to a specific `OAuthConnection` and social account.

## Security properties

- Every credential version receives a unique 256-bit data-encryption key (DEK).
- Credential bytes are encrypted locally with AES-256-GCM, a 96-bit nonce, and a 128-bit authentication tag.
- Additional authenticated data binds the envelope to its immutable credential ID, workspace, platform application, and credential type.
- Account authorization envelopes use the v2 AAD domain and additionally bind the ciphertext and wrapped key to the immutable OAuth connection ID. Existing app-secret v1 envelopes retain their original AAD shape for decryption compatibility.
- The DEK is wrapped by a separately managed key-encryption key (KEK). Only the wrapped DEK is stored beside the ciphertext.
- Plaintext DEKs and credential buffers are overwritten as soon as their scoped operation completes.
- Decryption is callback-scoped. The service does not expose a method that returns credential plaintext to controllers or UI code.
- List and mutation results are projected onto an explicit metadata type; encrypted envelope fields are not returned accidentally.
- A new version supersedes the previous active version; history is immutable and publication attempts continue to reference the version they used.
- Revocation prevents future decrypt operations. It does not rewrite historical publication attempts.

## Key providers

`KeyEncryptionKeyProvider` is the provider boundary for AWS KMS, Google Cloud KMS, Azure Key Vault, Vault Transit, or an HSM-backed service.

`LocalAesKekProvider` exists only for development and tests. It rejects startup when `NODE_ENV=production`. The local KEK must be a random 32-byte base64 value and must never be committed.

Production requirements:

1. Use workload identity rather than long-lived cloud access keys.
2. Restrict the runtime identity to the exact KEK and required describe/generate/decrypt operations; split encrypting API and decrypting worker roles at deployment where practical.
3. Pass the same credential context to KMS as encryption context where supported.
4. Keep previous KEK versions decryptable until all referenced credential versions expire or are migrated.
5. Audit KMS calls and alert on denied operations, unusual decrypt volume, or cross-environment key use.

The AWS provider uses `GenerateDataKey(AES_256)` for every credential version and passes the immutable credential, workspace, platform-app, and credential-type identifiers as KMS encryption context. The same exact context and stored KMS key ARN are required for `Decrypt`.

For OAuth token bundles, the non-secret binding type and OAuth connection ID are included in the KMS encryption context. API readiness uses the non-mutating `DescribeKey` operation and requires the configured key to be enabled, symmetric, and usable for encryption/decryption; readiness never generates a throwaway data key.

Encryption context is deliberately limited to non-secret identifiers because AWS records it in plaintext CloudTrail events. OAuth tokens, client secrets, usernames, post content, and other sensitive values must never be placed in encryption context.

The AWS SDK client does not accept static access keys from application configuration. Production workloads should use the default SDK credential chain with an attached workload identity, such as an EKS Pod Identity/IRSA role, restricted to `kms:DescribeKey`, `kms:GenerateDataKey`, and/or `kms:Decrypt` on the configured customer-managed key according to process responsibility.

## Persistence transaction

The repository implementation must perform the following in one database transaction:

1. lock the logical `(platform_app_id, credential_type)` credential stream;
2. calculate and insert the next version number;
3. mark the prior active version as `SUPERSEDED` with `superseded_at`;
4. insert an audit event containing actor, request ID, target, and non-secret metadata.

The encrypted envelope is created before the transaction, so network KMS latency does not hold a database lock. The immutable credential UUID used by AAD is generated before encryption; the display version number does not participate in encryption.

OAuth token rotation follows the same transaction rule but locks one `OAuthConnection` stream. Access and refresh tokens are one encrypted version, so refresh-token rotation cannot commit independently from its access token. A database partial unique index permits only one `ACTIVE` token version per connection.

## API rules

- Secret values are accepted only on create/rotate requests over TLS.
- Read endpoints return masked metadata and never plaintext, ciphertext, wrapped keys, nonces, or tags.
- Controllers must convert request strings to an owned byte buffer and relinquish it to `CredentialService`, which zeroizes it.
- JavaScript request parsers necessarily create an immutable string before conversion. Controllers replace the parsed body field immediately and zeroize all owned byte buffers, but runtimes cannot guarantee deterministic erasure of prior immutable strings. Request-body logging, heap-dump access, and crash-report capture must therefore be disabled or tightly controlled for credential endpoints.
- Request/response logging must use the shared redactor before serialization.
- Support bundles must use an allowlist and must not export the credential tables.
- All mutations require an authenticated principal, workspace-bound authorization, administrator permission, CSRF protection for browser sessions, and immutable audit events.

## References

- Node.js `crypto` authenticated encryption documentation: <https://nodejs.org/api/crypto.html>
- OWASP Secrets Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
- AWS KMS envelope encryption: <https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html>
