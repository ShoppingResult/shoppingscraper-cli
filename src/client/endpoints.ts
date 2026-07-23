import type { HttpClient, HttpResponse } from "./http.js";
import type {
  BuyboxInputT,
  ChannelAckInputT,
  ChannelResultsInputT,
  ChannelStatusInputT,
  ChannelSubmitInputT,
  HistoryInputT,
  InfoInputT,
  MatchInputT,
  OffersInputT,
  PageInputT,
  ReviewsInputT,
  SearchInputT,
  SubscriptionInputT,
  VariantsInputT,
} from "./schemas.js";

/**
 * One thin function per ShoppingScraper endpoint. No business logic; just
 * shape the request, hand off to HttpClient, return data + credits header.
 *
 * The API returns credits remaining in the response body (varies by
 * endpoint). When present, we surface it via the second tuple element so
 * the envelope can include it in meta.credits_remaining.
 */

export interface CallResult<T> {
  data: T;
  creditsRemaining?: number;
  creditsSpent?: number;
}

function extractCredits<T>(res: HttpResponse<T>): { remaining?: number; spent?: number } {
  const out: { remaining?: number; spent?: number } = {};
  const headerRem = res.headers["x-credits-remaining"] ?? res.headers["x-ratelimit-remaining"];
  if (headerRem && /^\d+$/.test(headerRem)) out.remaining = Number(headerRem);
  const headerSpent = res.headers["x-credits-spent"];
  if (headerSpent && /^\d+$/.test(headerSpent)) out.spent = Number(headerSpent);
  // Body fallback — many ShoppingScraper endpoints embed credits in the body.
  const body = res.data as Record<string, unknown> | undefined | null;
  if (body && typeof body === "object") {
    if (out.remaining === undefined && typeof body.credits_remaining === "number") {
      out.remaining = body.credits_remaining;
    }
    if (out.remaining === undefined && typeof body.creditsRemaining === "number") {
      out.remaining = body.creditsRemaining;
    }
  }
  return out;
}

async function call<T>(
  client: HttpClient,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<CallResult<T>> {
  const res = await client.request<T>({ path, query });
  const credits = extractCredits(res);
  return {
    data: res.data,
    ...(credits.remaining !== undefined ? { creditsRemaining: credits.remaining } : {}),
    ...(credits.spent !== undefined ? { creditsSpent: credits.spent } : {}),
  };
}

async function callApp<T>(
  client: HttpClient,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<CallResult<T>> {
  const res = await client.request<T>({ path, query, appBase: true });
  const credits = extractCredits(res);
  return {
    data: res.data,
    ...(credits.remaining !== undefined ? { creditsRemaining: credits.remaining } : {}),
    ...(credits.spent !== undefined ? { creditsSpent: credits.spent } : {}),
  };
}

export function offers(client: HttpClient, input: OffersInputT): Promise<CallResult<unknown>> {
  return call(client, "/offers", {
    site: input.site,
    ean: input.ean,
    availability: input.availability,
  });
}

export function info(client: HttpClient, input: InfoInputT): Promise<CallResult<unknown>> {
  return call(client, "/info", { site: input.site, ean: input.ean });
}

export function buybox(client: HttpClient, input: BuyboxInputT): Promise<CallResult<unknown>> {
  return call(client, "/buybox", {
    site: input.site,
    ean: input.ean,
    gl: input.gl,
    hl: input.hl,
  });
}

export function match(client: HttpClient, input: MatchInputT): Promise<CallResult<unknown>> {
  return call(client, "/match", {
    site: input.site,
    ean: input.ean,
    deepsearch: input.deepsearch ? "true" : undefined,
  });
}

export function search(client: HttpClient, input: SearchInputT): Promise<CallResult<unknown>> {
  return call(client, `/search/googleshopping/${encodeURIComponent(input.country)}`, {
    keyword: input.keyword,
    page: input.page,
  });
}

export function page(client: HttpClient, input: PageInputT): Promise<CallResult<unknown>> {
  return call(client, "/page/", { url: input.url });
}

export function variants(client: HttpClient, input: VariantsInputT): Promise<CallResult<unknown>> {
  return call(client, "/variants", { site: input.site, sku: input.sku });
}

export function reviews(client: HttpClient, input: ReviewsInputT): Promise<CallResult<unknown>> {
  return call(client, "/reviews", { site: input.site, sku: input.sku });
}

export function subscription(
  client: HttpClient,
  _input: SubscriptionInputT = {},
): Promise<CallResult<unknown>> {
  return call(client, "/subscription", {});
}

export function subscriptionHistory(
  client: HttpClient,
  input: HistoryInputT,
): Promise<CallResult<unknown>> {
  return callApp(client, "/subscription/history", { limit: input.limit });
}

/**
 * Channel API (enterprise.shoppingscraper.com). Async pipeline:
 * submit → status → results → ack. Header auth (X-API-Key) is handled by
 * HttpClient via `channelBase: true`.
 *
 * `kind` picks the pipeline: "offers" = Google Shopping offers
 * (/v2/channel/google/*), "match" = catalog matching (/v2/channel/match/*).
 * Both paths use the same key scope, channel:google.
 */
export type ChannelKind = "offers" | "match";

function channelRoot(kind: ChannelKind): string {
  return kind === "offers" ? "/v2/channel/google" : "/v2/channel/match";
}

async function callChannel<T>(
  client: HttpClient,
  method: "GET" | "POST",
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  body?: unknown,
): Promise<CallResult<T>> {
  const res = await client.request<T>({ method, path, query, body, channelBase: true });
  const credits = extractCredits(res);
  return {
    data: res.data,
    ...(credits.remaining !== undefined ? { creditsRemaining: credits.remaining } : {}),
    ...(credits.spent !== undefined ? { creditsSpent: credits.spent } : {}),
  };
}

export interface ChannelSubmitResponse {
  accepted: number;
  deduplicated?: number;
  rejected: { ean: string; reason: string }[];
}

export interface ChannelStatusResponse {
  queued: number;
  claimed: number;
  done: number;
  failed: number;
}

export interface ChannelResultEntry {
  ean: string;
  country: string;
  status: "done" | "failed";
  [k: string]: unknown;
}

export interface ChannelResultsResponse {
  results: ChannelResultEntry[];
  page_token?: string;
  remaining_estimate?: number;
  pending?: number | boolean;
}

export function channelSubmit(
  client: HttpClient,
  kind: ChannelKind,
  input: ChannelSubmitInputT,
): Promise<CallResult<ChannelSubmitResponse>> {
  // Offers submit lives at /google/offers; match submit is the bare /match root.
  const path = kind === "offers" ? `${channelRoot(kind)}/offers` : channelRoot(kind);
  return callChannel(
    client,
    "POST",
    path,
    {},
    {
      country: input.country,
      items: input.items,
      ...(input.max_pages !== undefined ? { max_pages: input.max_pages } : {}),
      ...(input.application_id !== undefined ? { application_id: input.application_id } : {}),
    },
  );
}

export function channelStatus(
  client: HttpClient,
  kind: ChannelKind,
  input: ChannelStatusInputT = {},
): Promise<CallResult<ChannelStatusResponse>> {
  return callChannel(client, "GET", `${channelRoot(kind)}/status`, {
    application_id: input.application_id,
  });
}

export function channelResults(
  client: HttpClient,
  kind: ChannelKind,
  input: ChannelResultsInputT,
): Promise<CallResult<ChannelResultsResponse>> {
  return callChannel(client, "GET", `${channelRoot(kind)}/results`, {
    limit: input.limit,
    application_id: input.application_id,
  });
}

export function channelAck(
  client: HttpClient,
  kind: ChannelKind,
  input: ChannelAckInputT,
): Promise<CallResult<{ acked: number }>> {
  return callChannel(
    client,
    "POST",
    `${channelRoot(kind)}/ack`,
    {},
    {
      page_token: input.page_token,
    },
  );
}
