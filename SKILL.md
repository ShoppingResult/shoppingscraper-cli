---
name: shoppingscraper
description: Fetch product data, prices, offers, buy-box winners, variants, and reviews from Google Shopping, Amazon, Bol.com, and Coolblue via the ShoppingScraper API. Use whenever the user asks about marketplace pricing, competitor offers, product matching, or e-commerce SERP positions for a specific EAN/SKU.
---

# ShoppingScraper

Live e-commerce price and product data via the `ssc` CLI (an MCP-friendly wrapper around the ShoppingScraper API).

## When to use this skill

The user asks about:

- Prices or offers for a specific EAN/GTIN/UPC across any marketplace
- The current buy-box winner on Amazon or Bol.com
- Product info (title, brand, images, specs) for an EAN
- Matching an EAN to a marketplace SKU/URL
- Google Shopping search results for a keyword in a country
- Variants or reviews for a Google Shopping product
- "What does this product cost on amazon.de / bol.com / coolblue.be / shopping.google.nl?"

Do **not** use for:

- Generic web scraping (use a generic scraper)
- Non-e-commerce domains (the API is e-commerce-specific)
- Anything where the user doesn't have an EAN/GTIN, SKU, or product URL — call `ssc search` first to discover one.

## Setup

```bash
# Install once (or use npx for one-off calls)
npm install -g @shoppingscraper/cli

# API key in env (the user provides theirs)
export SSC_API_KEY="<the-user's-key>"

# Verify
ssc credits
```

## Core commands (run via Bash)

Every command emits a stable JSON envelope: `{_v, ok, command, result, error, meta}`. Pipe to `jq '.result'` for the payload.

```bash
# Account
ssc credits
ssc history --limit 50

# Per-EAN price/offer/info — legacy sync (offers/match: Amazon and Bol.com ONLY)
ssc offers  --site amazon.de         --ean 0190198001281
ssc info    --site shopping.google.nl --ean 0190198001281
ssc buybox  --site bol.com           --ean 0190198001281 --gl nl --hl nl
ssc match   --site amazon.de         --ean 0190198001281

# Google Shopping offers/match — channel API (async batch, --country not --site)
ssc offers --country nl --ean 0190198001281            # blocking: submit→poll→drain→ack
ssc offers --country nl --input eans.txt --max-spend-credits 5000
ssc match  --country de --ean 5055986110651            # catalog_id + title, no offers
# Raw pipeline steps for large/cron-driven batches:
ssc offers submit --country nl --input eans.txt --max-spend-credits 50000
ssc offers status
ssc offers results --ack
ssc offers ack --page-token <token>

# Search & extract
ssc search --country nl --keyword "iphone 15 case"
ssc page   --url https://www.amazon.de/dp/B0XXXXXXXX

# By SKU (more expensive)
ssc variants --site shopping.google.nl --sku <google_sku>   # 6 credits
ssc reviews  --site shopping.google.nl --sku <google_sku>

# Bulk — REQUIRES --max-spend-credits
ssc batch offers --input eans.txt --site amazon.de --max-spend-credits 500
```

## Marketplace site values

| Marketplace | `ssc offers` / `ssc match` | Other commands (`info`, `buybox`, ...) |
|---|---|---|
| Google Shopping | `--country nl` / `de` / `us` ... (channel API, async) | `--site shopping.google.nl` / `.de` / ... |
| Amazon | `--site amazon.de`, `amazon.com`, `amazon.co.uk`, ... (legacy sync) | same |
| Bol.com | `--site bol.com` (legacy sync) | same (use `--gl nl` or `--gl be`) |
| Coolblue / Idealo / others | **not supported** (dropped in the channel migration) | `--site coolblue.be`, ... |

## Decision rules

1. **Always start with `ssc credits`** if the user hasn't yet — confirms auth + shows budget.
2. **Use `ssc match` before `ssc offers`** if you only have an EAN and need to verify the marketplace carries it. `match` is 1 credit; `offers` is 1 credit; running `offers` on an EAN the marketplace doesn't carry returns empty.
3. **Don't use `--deepsearch` by default** — it's 4 credits. Only fall back to it after a regular `ssc match` returns no result.
4. **Don't use `ssc variants` unless explicitly asked** — 6 credits per call.
5. **Use `ssc batch` for >5 EANs**. Always pass `--max-spend-credits N` (it's mandatory anyway). Calculate the cap as `EAN_count × per_call_cost × 1.1` for safety.
6. **Use `ssc page` for arbitrary product URLs** when the user gives you a URL instead of an EAN.
7. **Google offers/match are asynchronous** (channel API): the blocking form waits up to `--wait-timeout` (default 3600s). Submit is billed per EAN; results must be collected (and acked) within ~6 hours or they are pruned. For >1000 EANs prefer `submit` + later `results --ack` over holding a terminal open.
8. **Include feed titles when matching**: channel `--input` accepts NDJSON lines like `{"ean":"...","title":"..."}` — a title roughly doubles the match/offer rate.

## Reading the envelope

```json
{
  "_v": 1,
  "ok": true,
  "command": "offers",
  "result": { /* what you want */ },
  "error": null,
  "meta": { "credits_remaining": 12000, "duration_ms": 412, "request_id": "ssc_..." }
}
```

On `ok: false`, the `error.code` tells you what to do:

- `AUTH_MISSING` / `AUTH_INVALID` → ask the user for their API key
- `RATE_LIMITED` (HTTP 429) → wait, then retry (exponential backoff is built-in)
- `SPEND_CAP_EXCEEDED` → either raise `--max-spend-credits` or split the work
- `NOT_FOUND` → the EAN/SKU isn't carried; try `ssc match` or a different `--site`
- `UPSTREAM_ERROR` → transient; retry once

## Streaming bulk output

`ssc batch` and any `--input` invocation emit **NDJSON** (one envelope per line). Process with `jq -c`:

```bash
ssc batch offers --input eans.txt --site amazon.de --max-spend-credits 500 \
  | jq -c 'select(.ok) | {ean: .meta.input_line, offer_count: (.result.offers | length)}'
```

## Cost-awareness

Show the user `meta.credits_remaining` after every batch call so they can plan ahead. If the user asks for "all offers for these 500 EANs across 3 marketplaces", that's 1500 credits — confirm the spend before running.

## MCP mode

If the user is in Claude Desktop / Cursor / Claude Code and the MCP server is wired up, use the native tools (`ssc_offers`, `ssc_info`, etc.) instead of shelling out. Same input schemas, same envelope shape. The channel pipeline is exposed as raw steps: `ssc_offers_submit` / `ssc_offers_status` / `ssc_offers_results` / `ssc_offers_ack` (and the `ssc_match_*` equivalents) — drive the loop yourself and always ack collected pages.

## Don't

- **Don't** put the API key in shell command examples shown to the user — use `$SSC_API_KEY` or "your key".
- **Don't** call `ssc variants` or `ssc match --deepsearch` without warning the user about the higher credit cost.
- **Don't** strip `--max-spend-credits` from `ssc batch` — it's deliberately mandatory.
- **Don't** assume an EAN exists on every marketplace — `ssc match` first.
