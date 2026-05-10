# Security Policy

## Reporting a vulnerability

Email **security@shoppingscraper.com** with:

- A clear description of the issue
- Steps to reproduce (commands, env, expected vs. actual)
- Your assessment of impact

**Please do not open public GitHub issues for security reports.** We aim to acknowledge within 48 hours and ship a fix or mitigation within 14 days for high-severity issues.

## Threat model

This CLI's job is to forward user-supplied API calls to `api.shoppingscraper.com`. The realistic risks are:

1. **API-key leakage** — keys end up in logs, screenshots, error messages, npm tarballs, or shell history.
2. **Credit-spend abuse** — a hostile or prompt-injected agent invokes high-cost endpoints (variants, deepsearch, batch) and drains credits.
3. **Supply-chain compromise** — a malicious npm package or transitive dependency.
4. **Marketplace reputation damage** — over-aggressive scraping gets the user's API key flagged by Amazon/Google/Bol/Coolblue, making credits worthless.

We have specific defenses for each.

## Defense in depth

### Key handling

- The CLI sends `api_key` as a URL query parameter (matches the deployed API contract).
- **All** outbound logs, error messages, envelope `meta`, and request IDs pass through `src/security/redact.ts`, which scrubs `api_key=<value>` patterns and bare UUID-shaped strings before anything leaves the process.
- Vitest case `redaction.test.ts` fails the build if a fake key leaks into envelope output.
- Auth resolution prefers env var > config file (mode 0600) over the `--api-key` flag (the flag lands in shell history; the help text steers users away).

### Spend-cap layers

Three layers, advisory ↗ enforced:

1. **Client-side advisory** (this CLI) — global `--max-spend-credits N` (default 100). Honest mistakes only.
2. **Client-side mandatory** (this CLI) — `ssc batch` refuses to run without an explicit `--max-spend-credits`.
3. **Server-side enforced** (your ShoppingScraper API plan) — `max_credits_per_call` and per-key daily caps return HTTP 402. **Only this layer survives a leaked key or a hostile MCP client.**

The CLI's `requiresConfirmation: true` annotation on `ssc_variants`, `ssc_match` with `deepsearch`, and bulk operations is **advisory only**. MCP hosts SHOULD prompt the user before invoking; nothing prevents a headless or malicious host from ignoring the hint. **Do not rely on `requiresConfirmation` as access control.**

### Supply-chain hygiene

- Runtime dependencies are pinned to compatible major versions and audited on every PR (`npm audit --audit-level=high` in CI).
- The release pipeline publishes with `npm publish --provenance --access public`, producing a Sigstore attestation that ties each package version to the GitHub workflow that built it.
- `release.yml` runs a tarball-content scan that **fails the release** if any UUID-shaped string or `api_key=<value>` literal appears in the published files.
- Lockfile is committed. `npm ci` (not `npm install`) in CI.

### Marketplace reputation

- Default MCP-server concurrency is **5** (the API allows 100; we cap intentionally).
- `ssc batch` adds 200–800ms randomized jitter between requests.
- These are tunable via `--concurrency` / `--no-jitter` for users with proxy infrastructure.

## Out-of-scope

- Certificate pinning (would break legitimate corporate proxies).
- HTTPS to the upstream API is mandatory; we don't accept user-supplied insecure base URLs in production guidance.
- Rotation of the user's own API key — that's done via [app.shoppingscraper.com](https://app.shoppingscraper.com).

## Pre-publish checklist (maintainers)

Before tagging a release:

- [ ] No live API keys anywhere in the repo (`grep -RE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' .` should be empty outside `tests/redaction.test.ts` fakes).
- [ ] `npm audit --audit-level=high` clean.
- [ ] `npm test` green (including `redaction.test.ts`).
- [ ] `RUN_TARBALL_TEST=1 npm test` green.
- [ ] Server-side spend caps (`max_credits_per_call`, per-key daily) confirmed live on the API.
- [ ] Signed git tag.
