---
"@shoppingscraper/cli": minor
---

Migrate `ssc offers` and `ssc match` to the ShoppingScraper channel API.

Google Shopping now runs through the async channel pipeline on
enterprise.shoppingscraper.com (X-API-Key header auth): use
`--country <cc>` for the blocking submit→poll→drain→ack run, or the new
`submit` / `status` / `results` / `ack` subcommands (also exposed as MCP
tools) to drive the loop yourself. Up to 50,000 EANs per submit, 1 credit
per EAN, results must be collected within ~6 hours.

BREAKING: the legacy synchronous `/offers` and `/match` endpoints are now
restricted to `amazon.*` and `bol.com`. Coolblue, Idealo, `global`, and
`shopping.google.*` site values are no longer accepted by these two
commands (Google moved to `--country`; the other sites were dropped).
Other commands (`info`, `buybox`, `variants`, `reviews`, `search`, `page`)
are unchanged.
