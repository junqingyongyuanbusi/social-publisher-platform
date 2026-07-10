# Credential vault security model

## Status

The cryptographic core is implemented. Public credential CRUD remains deliberately disabled until authenticated principals, workspace membership, and RBAC are implemented. The platform must fail closed if a production KMS provider is unavailable.

## Security properties

- Every credential version receives a unique 256-bit data-encryption key (DEK).
- Credential bytes are encrypted locally with AES-256-GCM, a 96-bit nonce, and a 128-bit authentication tag.
- Additional authenticated data binds the envelope to its immutable credential ID, workspace, platform application, and credential type.
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
2. Restrict the runtime identity to the exact KEK and required generate/decrypt operations.
3. Pass the same credential context to KMS as encryption context where supported.
4. Keep previous KEK versions decryptable until all referenced credential versions expire or are migrated.
5. Audit KMS calls and alert on denied operations, unusual decrypt volume, or cross-environment key use.

## Persistence transaction

The repository implementation must perform the following in one database transaction:

1. lock the logical `(platform_app_id, credential_type)` credential stream;
2. calculate and insert the next version number;
3. mark the prior active version as `SUPERSEDED` with `superseded_at`;
4. insert an audit event containing actor, request ID, target, and non-secret metadata.

The encrypted envelope is created before the transaction, so network KMS latency does not hold a database lock. The immutable credential UUID used by AAD is generated before encryption; the display version number does not participate in encryption.

## API rules

- Secret values are accepted only on create/rotate requests over TLS.
- Read endpoints return masked metadata and never plaintext, ciphertext, wrapped keys, nonces, or tags.
- Controllers must convert request strings to an owned byte buffer and relinquish it to `CredentialService`, which zeroizes it.
- Request/response logging must use the shared redactor before serialization.
- Support bundles must use an allowlist and must not export the credential tables.
- All mutations require an authenticated principal, workspace-bound authorization, administrator permission, CSRF protection for browser sessions, and immutable audit events.

## References

- Node.js `crypto` authenticated encryption documentation: <https://nodejs.org/api/crypto.html>
- OWASP Secrets Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
- AWS KMS envelope encryption: <https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html>
