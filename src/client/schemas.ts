import { z } from "zod";

/**
 * Single source of truth for the API surface. These schemas drive both the
 * CLI flag parsing (commander option validation) and the MCP tool input
 * schemas (via zod-to-json-schema). When the API gains a new endpoint, this
 * file gets a new schema pair and the rest follows.
 */

// Marketplace identifier. Either a hostname (`amazon.de`, `shopping.google.nl`)
// or the literal `global`. Restricted to letters/digits/dots/hyphens to prevent
// path-injection / query-injection through this field.
const SiteSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?:global|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i)
  .describe(
    "Marketplace site identifier. Examples: shopping.google.nl, amazon.de, bol.com, coolblue.be, global",
  );

const EanSchema = z
  .string()
  .regex(/^\d{8,14}$/u)
  .describe("EAN/GTIN/UPC, 8-14 digits.");

// SKU is provider-specific and can include hyphens, underscores, dots. We
// reject control chars, whitespace, and characters that have meaning in URLs
// or shells.
const SkuSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:\-]+$/)
  .describe("Marketplace-specific SKU/catalog ID.");

// URL must be http or https. We reject obvious abuse client-side (file://,
// javascript:, data:, internal hostnames, RFC1918 IPs, link-local) — the
// upstream API does its own validation, this is defense-in-depth.
const UrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(isPublicHttpUrl, {
    message: "url must be http(s) and resolve to a public host (no localhost / private IPs / non-http schemes)",
  })
  .describe("Absolute http(s) URL on a public host.");

function isPublicHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "" || host === "localhost") return false;
  // RFC1918 / loopback / link-local / multicast / IPv6 special ranges
  if (host === "0.0.0.0" || host === "::" || host === "::1") return false;
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false; // link-local incl. AWS/GCP/Azure metadata
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.startsWith("[")) {
    // IPv6 literal — reject loopback/ULA/link-local. Note that `URL`
    // canonicalizes IPv4-mapped IPv6 (`::ffff:127.0.0.1`) to compressed hex
    // form (`::ffff:7f00:1`), so we block the entire `::ffff:` prefix —
    // there's no public-internet use case for v4-mapped IPv6 in user-supplied
    // URLs and it's the documented SSRF bypass for prefix-only checks.
    const inner = host.slice(1, -1).toLowerCase();
    if (
      inner === "::1" ||
      inner === "::" ||
      inner.startsWith("::ffff:") ||
      inner.startsWith("fc") ||
      inner.startsWith("fd") ||
      inner.startsWith("fe8") ||
      inner.startsWith("fe9") ||
      inner.startsWith("fea") ||
      inner.startsWith("feb")
    ) {
      return false;
    }
  }
  // Cloud-metadata hostnames
  if (host === "metadata.google.internal" || host === "metadata") return false;
  return true;
}

export const OffersInput = z.object({
  site: SiteSchema,
  ean: EanSchema,
  availability: z.boolean().optional().describe("Filter to in-stock offers only."),
});
export type OffersInputT = z.infer<typeof OffersInput>;

export const InfoInput = z.object({
  site: SiteSchema,
  ean: EanSchema,
});
export type InfoInputT = z.infer<typeof InfoInput>;

export const BuyboxInput = z.object({
  site: SiteSchema,
  ean: EanSchema,
  gl: z.string().length(2).optional().describe("Country code (e.g. nl, be)."),
  hl: z.string().length(2).optional().describe("Language code (e.g. nl, fr, en)."),
});
export type BuyboxInputT = z.infer<typeof BuyboxInput>;

export const MatchInput = z.object({
  site: SiteSchema,
  ean: EanSchema,
  deepsearch: z
    .boolean()
    .optional()
    .describe(
      "Run a more thorough match (4 credits instead of 1). Use when the standard match returns no result.",
    ),
});
export type MatchInputT = z.infer<typeof MatchInput>;

export const SearchInput = z.object({
  country: z
    .string()
    .min(2)
    .max(2)
    .describe("Country code: nl, de, fr, uk, us."),
  keyword: z.string().min(1),
  page: z.number().int().min(1).default(1),
});
export type SearchInputT = z.infer<typeof SearchInput>;

export const PageInput = z.object({
  url: UrlSchema,
});
export type PageInputT = z.infer<typeof PageInput>;

export const VariantsInput = z.object({
  site: SiteSchema,
  sku: SkuSchema,
});
export type VariantsInputT = z.infer<typeof VariantsInput>;

export const ReviewsInput = z.object({
  site: SiteSchema,
  sku: SkuSchema,
});
export type ReviewsInputT = z.infer<typeof ReviewsInput>;

export const HistoryInput = z.object({
  limit: z.number().int().min(1).max(500).default(50),
});
export type HistoryInputT = z.infer<typeof HistoryInput>;

/**
 * Subscription endpoint (account / credits). No input.
 */
export const SubscriptionInput = z.object({});
export type SubscriptionInputT = z.infer<typeof SubscriptionInput>;

/**
 * Per-tool credit cost + safety annotations. The MCP server reads this to
 * decorate tool descriptions and to refuse high-cost ops without an explicit
 * spend cap.
 */
export interface ToolMeta {
  credits: number;
  requiresConfirmation: boolean;
  description: string;
}

export type ToolName =
  | "offers"
  | "info"
  | "buybox"
  | "match"
  | "search"
  | "page"
  | "variants"
  | "reviews"
  | "credits"
  | "history";

export const TOOL_META: Record<ToolName, ToolMeta> = {
  offers: {
    credits: 1,
    requiresConfirmation: false,
    description: "List all seller offers for an EAN on a marketplace.",
  },
  info: {
    credits: 1,
    requiresConfirmation: false,
    description: "Fetch product info (title, brand, images, specs) for an EAN.",
  },
  buybox: {
    credits: 1,
    requiresConfirmation: false,
    description: "Get the current buy-box winner and price for an EAN.",
  },
  match: {
    credits: 1,
    requiresConfirmation: false,
    description:
      "Match an EAN to a marketplace SKU/URL. Use --deepsearch (4 credits) only as fallback.",
  },
  search: {
    credits: 1,
    requiresConfirmation: false,
    description: "Search Google Shopping by keyword in a country, paginated.",
  },
  page: {
    credits: 1,
    requiresConfirmation: false,
    description: "Extract structured product data from any product URL.",
  },
  variants: {
    credits: 6,
    requiresConfirmation: true,
    description: "List variants (color/size/storage) for a Google Shopping SKU. Costs 6 credits.",
  },
  reviews: {
    credits: 1,
    requiresConfirmation: false,
    description: "Fetch reviews and rating distribution for a SKU.",
  },
  credits: {
    credits: 0,
    requiresConfirmation: false,
    description: "Show remaining credits and plan info.",
  },
  history: {
    credits: 0,
    requiresConfirmation: false,
    description: "Recent API call history for the current key.",
  },
};
