# Channel API migration for `ssc offers` / `ssc match`

Source: https://app.shoppingscraper.com/migration (fetched 2026-07-23)

## Context

The CLI currently calls synchronous `GET /offers` and `GET /match` on
`api.shoppingscraper.com` with `?api_key=` query auth. The channel API replaces
these with an async batch pipeline on `https://enterprise.shoppingscraper.com`:

- Auth: `X-API-Key` header (channel host only; legacy hosts keep `?api_key=`)
- Offers: `POST /v2/channel/google/offers` → `GET .../status` → `GET .../results?limit=1000` → `POST .../ack`
- Match: same loop under `/v2/channel/match/*`
- Up to 50,000 items per submit, 10 concurrent requests per key, at-least-once
  delivery, 6h drain TTL, submit is non-idempotent
- Billing unchanged (1 EAN = 1 credit); key scopes `channel:google` / `channel:match`

## Decisions (confirmed by user 2026-07-23)

1. **Sites.** Google Shopping goes through the channel API. `amazon.*` and
   `bol.com` stay on legacy `/offers` + `/match`. All other sites (coolblue,
   idealo, ...) are dropped from `ssc offers` / `ssc match`.
2. **Command UX.** Both: `ssc offers --country nl ...` runs the blocking
   submit→poll→drain→ack loop; `ssc offers submit|status|results|ack` (and the
   same under `ssc match`) expose the raw pipeline steps. `--site amazon.de` /
   `bol.com` keeps the legacy synchronous path.
3. **Auth.** Channel host `enterprise.shoppingscraper.com` uses the
   `X-API-Key` header. Legacy hosts keep `?api_key=` query auth.

## Stage 1: Config + HTTP layer

**Goal**: Client can talk to the channel host with header auth.
**Tasks**:
- `src/config.ts`: add `channelBaseUrl` (default `https://enterprise.shoppingscraper.com`),
  resolved via `--channel-base-url` / `SSC_CHANNEL_BASE_URL` / config
  `channel_base_url`, mirroring the existing `appBaseUrl` pattern.
- `src/client/http.ts`: per-base auth in `buildUrl`/request path — channel base
  sends `X-API-Key` header and NO `api_key` query param; legacy bases unchanged.
  Verify JSON POST bodies work (content-type is already set for bodies).
**Success criteria**: unit tests prove channel requests carry the header and no
query key, legacy requests unchanged.
**Tests**: `tests/http-channel.test.ts` (mocked fetch).
**Status**: Complete

## Stage 2: Channel endpoints + schemas

**Goal**: Typed wrappers for all 8 channel endpoints.
**Tasks**:
- `src/client/endpoints.ts`: `channelSubmit`, `channelStatus`, `channelResults`,
  `channelAck` parameterized by kind (`google` offers | `match`).
- `src/client/schemas.ts`: zod schemas — submit body (`country`, `items` as
  string or `{ean, catalog_id, title}`, `max_pages` 1–50, `application_id`),
  status/results/ack responses, EAN 8/12/13/14 digits + check digit at natural
  width (channel spec overrides the global "pad to 13" convention here).
- Update `TOOL_META` credit costs (1 credit per EAN, unchanged).
**Success criteria**: schema round-trips for the documented response examples.
**Tests**: `tests/channel-endpoints.test.ts`, `tests/schemas.test.ts` additions.
**Status**: Complete

## Stage 3: Command rework (blocked on decisions 1–2)

**Goal**: `ssc offers` and `ssc match` run against the channel API only.
**Tasks**:
- `src/commands/offers.ts` / `match.ts`: implement the run loop — chunked
  submit (reconcile on `accepted`, never blind-retry a timed-out POST), poll
  status with backoff, drain results at `limit=1000`, ack every page, stream
  results as NDJSON, exit when `done + failed == accepted`.
- Respect the 10-concurrent-request cap; retry 429/503 with backoff + jitter.
- `--application-id`, `--max-pages`, `--title`/`--catalog-id` per-item support
  (file input: NDJSON objects, not just bare EANs).
- Remove legacy `offers`/`match` endpoint functions and their flags
  (`availability`, `deepsearch` — not in the channel contract).
- Update `src/commands/batch.ts`, `src/mcp/server.ts` (`ssc_offers`/`ssc_match`
  tools), `src/commands/tools.ts` accordingly. MCP tools likely map to
  submit/status/results/ack primitives plus a blocking convenience tool.
**Success criteria**: end-to-end mocked run completes a full
submit→poll→drain→ack cycle; interrupted drain resumes without data loss.
**Tests**: `tests/channel-run.test.ts` covering happy path, rejected EANs,
429 retry, ack cursoring, partial-failure exit codes.
**Status**: Complete

## Stage 4: Docs

**Goal**: README + SKILL.md match the new contract.
**Tasks**: rewrite offers/match sections, auth section (dual auth: query for
legacy, `X-API-Key` for channel), workflow guidance (drain within 6h TTL,
non-idempotent submit), key-scope requirements (`channel:google`,
`channel:match` — mint via /channelapiadmin), CHANGELOG entry.
**Status**: Complete

## Stage 5: Verify + release

**Goal**: Green build, real-key smoke test, version bump.
**Tasks**: `npm test`, biome, tsup build; smoke test against
enterprise.shoppingscraper.com with a scoped key; bump minor version (breaking
CLI flags → consider major); update memory note on auth split.
**Status**: Complete
