import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "undici";
import { SscError } from "../errors.js";
import { redact, redactString } from "../security/redact.js";
import { USER_AGENT } from "../version.js";

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  appBaseUrl: string;
  timeoutMs: number;
  retries: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Use the app.shoppingscraper.com base instead of api.shoppingscraper.com */
  appBase?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Per-call override (rare). */
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

/**
 * Thin HTTP client over undici with keep-alive pooling, exponential-backoff
 * retry on 429/5xx, query-string auth, and aggressive redaction in error
 * paths. Two pools (api / app base URLs) are kept warm.
 */
export class HttpClient {
  private readonly options: HttpClientOptions;
  private readonly pools = new Map<string, Pool>();

  constructor(options: HttpClientOptions) {
    this.options = options;
  }

  async request<T>(opts: RequestOptions): Promise<HttpResponse<T>> {
    const base = opts.appBase ? this.options.appBaseUrl : this.options.baseUrl;
    const url = this.buildUrl(base, opts.path, opts.query);
    const method = opts.method ?? "GET";
    const timeout = opts.timeoutMs ?? this.options.timeoutMs;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      try {
        return await this.attempt<T>(base, url, method, opts.body, timeout);
      } catch (err) {
        lastErr = err;
        if (!shouldRetry(err) || attempt === this.options.retries) {
          throw err;
        }
        const backoff = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 200);
        await sleep(backoff);
      }
    }
    throw lastErr;
  }

  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((p) => p.close()));
    this.pools.clear();
  }

  private async attempt<T>(
    base: string,
    url: string,
    method: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<HttpResponse<T>> {
    const pool = this.poolFor(base);
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "application/json",
    };
    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const path = url.slice(base.length);
      const res = await pool.request({
        method: method as Parameters<Pool["request"]>[0]["method"],
        path,
        headers,
        body: payload,
        signal: ac.signal,
      });
      const text = await res.body.text();
      const data = parseJson<T>(text);
      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") responseHeaders[k] = v;
        else if (Array.isArray(v) && v[0] !== undefined) responseHeaders[k] = v[0];
      }
      if (res.statusCode >= 400) {
        throw httpError(res.statusCode, data, redactString(url));
      }
      return { status: res.statusCode, data, headers: responseHeaders };
    } catch (err) {
      if (err instanceof SscError) throw err;
      const aborted = (err as { name?: string }).name === "AbortError";
      throw new SscError(
        aborted ? "NETWORK_ERROR" : "NETWORK_ERROR",
        aborted
          ? `request to ${redactString(url)} timed out after ${timeoutMs}ms`
          : `network error contacting ${redactString(url)}: ${(err as Error).message}`,
        { retryable: true, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private poolFor(base: string): Pool {
    let pool = this.pools.get(base);
    if (!pool) {
      pool = new Pool(base, {
        connections: 32,
        pipelining: 1,
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 600_000,
      });
      this.pools.set(base, pool);
    }
    return pool;
  }

  private buildUrl(
    base: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const u = new URL(path, base.endsWith("/") ? base : `${base}/`);
    // ShoppingScraper API key is sent as a query-string parameter to match
    // the deployed API contract and existing customer integrations.
    u.searchParams.set("api_key", this.options.apiKey);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }
}

function parseJson<T>(text: string): T {
  if (text === "") return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SscError("INVALID_RESPONSE", `upstream returned non-JSON body (${text.length} bytes)`);
  }
}

function httpError(status: number, body: unknown, redactedUrl: string): SscError {
  // Upstream payloads can echo back our request URL (with `api_key=...`) or
  // other secrets. Always redact before composing error messages.
  const rawMessage = extractMessage(body) ?? `upstream returned HTTP ${status}`;
  const message = redactString(rawMessage);
  const safeDetails =
    typeof body === "object" && body !== null
      ? (redact(body) as Record<string, unknown>)
      : undefined;

  if (status === 401 || status === 403) {
    return new SscError("AUTH_INVALID", `auth rejected by ${redactedUrl}: ${message}`, {
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 404) {
    return new SscError("NOT_FOUND", `not found at ${redactedUrl}: ${message}`, {
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 402) {
    return new SscError("SPEND_CAP_EXCEEDED", `payment required: ${message}`, {
      httpStatus: status,
      retryable: false,
      details: safeDetails,
    });
  }
  if (status === 429) {
    return new SscError(
      "RATE_LIMITED",
      `rate limited by upstream (concurrent connection cap): ${message}`,
      { httpStatus: status, retryable: true },
    );
  }
  if (status >= 500) {
    return new SscError("UPSTREAM_ERROR", `upstream ${status}: ${message}`, {
      httpStatus: status,
      retryable: true,
    });
  }
  return new SscError("UPSTREAM_ERROR", `${status}: ${message}`, {
    httpStatus: status,
    retryable: false,
  });
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  if (typeof b.detail === "string") return b.detail;
  return undefined;
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof SscError) return err.retryable;
  return true;
}
