import { z } from "zod";

/**
 * Single source of truth for the API surface. These schemas drive both the
 * CLI flag parsing (commander option validation) and the MCP tool input
 * schemas (via zod-to-json-schema). When the API gains a new endpoint, this
 * file gets a new schema pair and the rest follows.
 */

const SiteSchema = z
  .string()
  .min(1)
  .describe(
    "Marketplace site identifier. Examples: shopping.google.nl, amazon.de, bol.com, coolblue.be, global",
  );

const EanSchema = z
  .string()
  .regex(/^\d{8,14}$/u)
  .describe("EAN/GTIN/UPC, 8-14 digits.");

const SkuSchema = z.string().min(1).describe("Marketplace-specific SKU/catalog ID.");
const UrlSchema = z.string().url().describe("Absolute URL.");

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
