# `ssc` — ShoppingScraper CLI

> **Price scraper CLI** for Amazon, Google Shopping, Bol.com, and Coolblue. Scrape prices, offers, buy-box winners, variants, and reviews from your terminal — or wire it into Claude Desktop / Cursor / Claude Code as a native MCP tool.

[![npm version](https://img.shields.io/npm/v/@shoppingscraper/cli.svg)](https://www.npmjs.com/package/@shoppingscraper/cli)
[![CI](https://github.com/ShoppingResult/shoppingscraper-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/ShoppingResult/shoppingscraper-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**🌐 Website:** [shoppingscraper.com](https://shoppingscraper.com) · **🔑 Get an API key:** [app.shoppingscraper.com](https://app.shoppingscraper.com) · **📖 API docs:** [apiguide](https://app.shoppingscraper.com/apiguide)

Agent-friendly command-line tool for the [ShoppingScraper API](https://app.shoppingscraper.com/apiguide) by [shoppingscraper.com](https://shoppingscraper.com). Stable JSON envelope on every command, MCP server mode for Claude Desktop / Cursor / Code, ships with a `SKILL.md` so any LLM picks it up without schema wrapping.

## Why

You're an AI agent (or a developer building one) and you need **product data — prices, offers, buy-box winners, variants, reviews — from Google Shopping, Amazon, Bol.com, or Coolblue**. Today you're hitting the raw HTTP API and writing the same retry/error/credit-tracking glue every time. `ssc` is that glue, in one binary, with a stable contract.

Use cases:

- **Price monitoring CLI** — fan out across thousands of EANs from cron / GitHub Actions / your CI.
- **E-commerce scraping** — match an EAN to a marketplace SKU, pull every offer, watch the buy-box.
- **AI agents** — give Claude/Cursor live marketplace data via the built-in MCP server.
- **Bulk price scraping** — `ssc batch` reads EANs from stdin, streams NDJSON envelopes.

## Install

```bash
# Run without installing
npx -y @shoppingscraper/cli credits

# Global install
npm install -g @shoppingscraper/cli

# Or via Homebrew (post-launch)
brew install ShoppingResult/tap/ssc
```

## Quick start

```bash
# 1. Set your API key (get one at https://app.shoppingscraper.com)
export SSC_API_KEY="<your-key>"

# 2. Verify
ssc credits
# → {"_v":1,"ok":true,"command":"credits","result":{...},"meta":{...}}

# 3. Get offers for an EAN on a marketplace
ssc offers --site amazon.de --ean 0190198001281

# 4. Pretty output for humans
ssc buybox --site bol.com --ean 0190198001281 --pretty

# 5. Pipe-friendly: get just the result payload
ssc info --site shopping.google.nl --ean 0190198001281 | jq '.result'

# 6. Bulk: 500 EANs from a file, capped at 500 credits
ssc batch offers --input eans.txt --site amazon.de --max-spend-credits 500
```

## Commands

| Command | What it does | Credits |
|---|---|---|
| `ssc credits` | Show remaining credits + plan info | 0 |
| `ssc history` | Recent API calls for this key | 0 |
| `ssc offers --country --input` | Google Shopping offers via the channel API (async batch, up to 50k EANs) | 1 per EAN |
| `ssc offers --site --ean` | All seller offers for an EAN (Amazon / Bol.com, legacy sync) | 1 |
| `ssc offers submit\|status\|results\|ack` | Raw channel-pipeline steps for script-driven collection | 1 per EAN (submit) |
| `ssc info --site --ean` | Product title, brand, images, specs | 1 |
| `ssc buybox --site --ean` | Current buy-box winner + price | 1 |
| `ssc match --country --input` | Google catalog matching via the channel API (catalog_id + title) | 1 per EAN |
| `ssc match --site --ean [--deepsearch]` | EAN → SKU/URL (Amazon / Bol.com, legacy sync) | 1 / 4 |
| `ssc match submit\|status\|results\|ack` | Raw channel-pipeline steps for matching | 1 per EAN (submit) |
| `ssc search --country --keyword` | Google Shopping search | 1 |
| `ssc page --url` | Structured data from any product URL | 1 |
| `ssc variants --site --sku` | Variants for a Google Shopping SKU ⚠ | 6 |
| `ssc reviews --site --sku` | Reviews + rating distribution | 1 |
| `ssc batch <cmd> --input` | Fan out a command (NDJSON output) | n × cost |
| `ssc tools [--json-schema]` | List every command (for agent introspection) | 0 |
| `ssc mcp serve` | MCP server over stdio | 0 |

⚠ = high-cost, gets `requiresConfirmation: true` in MCP tool annotations.

## Bulk / streaming

Every scraping command accepts `--input <file|->`. Reads one EAN/SKU per line, fans out with the configured concurrency (default 5), jitters each request 200–800ms, streams NDJSON envelopes. Lines beginning with `#` are comments.

```bash
# From a file
ssc offers --input eans.txt --site amazon.de --max-spend-credits 500

# From stdin
cat eans.txt | ssc info --site bol.com --input - --max-spend-credits 100

# `ssc batch` is sugar with a mandatory cap
ssc batch buybox --input eans.txt --site amazon.de --max-spend-credits 200
```

`ssc batch` **requires** `--max-spend-credits N` — there is no default. This is deliberate: agents bypassing this flag is the highest-blast-radius mistake an MCP-driven workflow can make.

## Channel API (Google Shopping)

Google Shopping offers and matching run through the **channel API** on `enterprise.shoppingscraper.com` — an async batch pipeline instead of one HTTP request per EAN. `ssc offers` / `ssc match` for other sites keep the legacy sync endpoints, which now serve **Amazon and Bol.com only** (Coolblue, Idealo, and the rest were dropped from these two commands).

The blocking form wraps the whole pipeline (submit → poll → drain → ack) and streams NDJSON, one envelope per product:

```bash
# Up to 50,000 EANs in one run; 1 credit per EAN
ssc offers --country nl --input eans.txt --max-spend-credits 5000

# Single EAN, catalog matching (returns catalog_id + title, no offers)
ssc match --country de --ean 5055986110651

# Input lines can also be NDJSON objects; a feed title roughly doubles match rate
# {"ean":"5055986110651","title":"Monstershop T-mech Garten Anhängewalze"}
```

For big batches or cron-driven collection, drive the raw steps yourself:

```bash
ssc offers submit --country nl --input eans.txt --max-spend-credits 50000
ssc offers status                       # {queued, claimed, done, failed}
ssc offers results --ack                # one page (max 1000), acked after printing
ssc offers ack --page-token <token>     # manual ack if you collected without --ack
```

Operational notes:

- **Billing is unchanged**: 1 EAN = 1 credit, billed at submit.
- **Delivery is at-least-once**: a page you never ack is redelivered; the blocking form acks only after writing the results to stdout.
- **Drain within ~6 hours**: completed results that are never collected are pruned. If the blocking form hits `--wait-timeout` (default 3600s), resume with `ssc offers results --ack`.
- **Submit is non-idempotent**: reconcile against the `accepted` count instead of re-posting a timed-out submit.
- **Key scopes**: offers needs `channel:google`, matching needs `channel:match`.
- `--application-id` isolates submissions/results per application on one key.

## Output format

Every command emits a stable JSON envelope on stdout (one line for batch/streaming):

```json
{
  "_v": 1,
  "ok": true,
  "command": "offers",
  "result": { /* endpoint payload */ },
  "error": null,
  "meta": {
    "credits_remaining": 12483,
    "duration_ms": 412,
    "request_id": "ssc_01a2b3c4d5e6f708"
  }
}
```

On failure: `ok: false`, `result: null`, `error.code` is one of `AUTH_MISSING | AUTH_INVALID | RATE_LIMITED | UPSTREAM_ERROR | NETWORK_ERROR | SPEND_CAP_EXCEEDED | NOT_FOUND | INVALID_RESPONSE | USER_ERROR`.

Exit codes:
- `0` ok · `1` user error · `2` auth · `3` rate-limit · `4` upstream · `5` network · `6` spend-cap exceeded.

Pass `--pretty` for a human-readable view; `--quiet` to suppress stdout (only the exit code matters).

## Authentication

Resolution order:

1. `--api-key <key>` flag (avoid — lands in shell history)
2. `SSC_API_KEY` environment variable (recommended)
3. `~/.config/ssc/config.json` with `{"api_key": "..."}` (mode 0600 recommended)

The CLI sends the key as a query-string parameter (`?api_key=...`) to the legacy hosts (`api.` / `app.shoppingscraper.com`), matching the deployed ShoppingScraper API contract. The channel API host (`enterprise.shoppingscraper.com`) authenticates with the `X-API-Key` header instead — the key never appears in channel URLs. All URLs and header values are redacted before they appear in logs, error envelopes, or `meta.request_id`.

## MCP — Model Context Protocol

```bash
ssc mcp serve
```

Run as a stdio MCP server, exposing every command as a tool (`ssc_offers`, `ssc_info`, `ssc_buybox`, …). Tool input schemas are auto-derived from the same zod schemas the CLI uses, so agents and humans see the same contract.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shoppingscraper": {
      "command": "npx",
      "args": ["-y", "@shoppingscraper/cli", "mcp", "serve"],
      "env": { "SSC_API_KEY": "<your-key>" }
    }
  }
}
```

### Cursor / Claude Code

Same shape — point any MCP-compatible host at `npx -y @shoppingscraper/cli mcp serve` with `SSC_API_KEY` in the env.

### Tool annotations

High-cost tools (`ssc_variants`, `ssc_match` with `--deepsearch`, anything bulk) carry `requiresConfirmation: true`. **This annotation is advisory** — well-behaved hosts prompt before invoking; hostile or headless clients ignore it. The real spend-cap brake is `--max-spend-credits` and the server-side cap on your ShoppingScraper API plan.

## Spend-cap defenses

Three layers, in order of strength:

1. **Server-side (strongest)** — the ShoppingScraper API enforces `max_credits_per_call` and per-key daily caps. Returns HTTP 402 with `credits_required`. Cannot be bypassed by anything.
2. **Client-side mandatory** — `ssc batch` refuses to run without `--max-spend-credits N`.
3. **Client-side advisory** — global `--max-spend-credits` (default 100) on every command; per-tool soft caps; MCP `requiresConfirmation` annotations.

To disable client-side caps for a power-user workflow:

```bash
ssc batch offers --input eans.txt --site amazon.de --max-spend-credits none
```

## Programmatic use

```ts
import { HttpClient, endpoints, resolveConfig } from "@shoppingscraper/cli";

const cfg = resolveConfig();
const client = new HttpClient({
  apiKey: cfg.apiKey,
  baseUrl: cfg.baseUrl,
  appBaseUrl: cfg.appBaseUrl,
  channelBaseUrl: cfg.channelBaseUrl,
  timeoutMs: 30_000,
  retries: 2,
});
// Legacy sync (Amazon / Bol.com)
const r = await endpoints.offers(client, { site: "amazon.de", ean: "0190198001281" });
console.log(r.creditsRemaining, r.data);

// Channel API (Google Shopping): submit → status → results → ack
const sub = await endpoints.channelSubmit(client, "offers", {
  country: "nl",
  items: ["0190198001281"],
});
console.log(sub.data.accepted, sub.data.rejected);
await client.close();
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js --help
```

## Security

See [SECURITY.md](./SECURITY.md). Found a vulnerability? Email security@shoppingscraper.com. Please do **not** open a public issue.

## About ShoppingScraper

`ssc` is built and maintained by **[ShoppingScraper](https://shoppingscraper.com)** — the e-commerce price-scraping API for Amazon, Google Shopping, Bol.com, Coolblue, and 30+ other marketplaces. EAN-precise, real-time, and built for AI agents.

- 🌐 Website: **[shoppingscraper.com](https://shoppingscraper.com)**
- 🔑 Get an API key: **[app.shoppingscraper.com](https://app.shoppingscraper.com)**
- 📖 API docs: **[app.shoppingscraper.com/apiguide](https://app.shoppingscraper.com/apiguide)**
- 📨 Contact: hello@shoppingscraper.com

## License

MIT — © [ShoppingScraper](https://shoppingscraper.com)
