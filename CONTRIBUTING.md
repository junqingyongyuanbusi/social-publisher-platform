# Contributing

## Workflow

1. Create an issue for non-trivial changes.
2. Branch from `main` using `feat/`, `fix/`, `docs/`, or `chore/`.
3. Use Conventional Commits.
4. Add or update tests and bilingual messages.
5. Run `pnpm check && pnpm build` before opening a pull request.
6. Keep pull requests focused and document security implications.

## Commit examples

```text
feat(platform-x): add OAuth PKCE callback
fix(publications): prevent retry after unknown publish result
docs(api): document idempotency behavior
chore(ci): add dependency review
```

## Internationalization

- UI copy must use semantic message keys.
- `zh-CN` and `en-US` catalogs must contain the same keys.
- Machine error codes, log events, API fields, and trace attributes are never translated.
- UI locale must not implicitly change outbound publication content.

## Security

- Never log or commit access tokens, refresh tokens, app secrets, authorization codes, or signed URLs.
- All external requests require timeouts and structured error classification.
- A successful remote side effect must be persisted before unrelated follow-up work.
